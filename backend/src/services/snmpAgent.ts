import * as snmp from "net-snmp";
import { prisma } from "../db";

// Exposes every rack sensor as one row of a real SNMP table
// (rackTempSensorTable), so PRTG's own native Auto-Discovery (SNMP Custom
// Table sensor + a Device Template, both stable/core PRTG functionality,
// not the experimental API v2 that was tried and abandoned first — see
// this session's history) can auto-create one PRTG sensor per rack sensor
// with zero manual PRTG-side work once the template is saved. See
// Settings > Integrations for the one-time PRTG setup steps.
//
// Library: `net-snmp` (real npm package - github.com/markabrahams/node-net-snmp).
// Its Agent/Mib classes aren't typed by @types/net-snmp (createAgent
// returns `any`), only the enums (MaxAccess/MibProviderType/ObjectType)
// are - everything Agent/Mib-shaped below is written against the
// library's own README examples, verified by actually walking the table
// with net-snmp's own client Session in this repo's dev environment
// (no real PRTG available here to verify Auto-Discovery itself against -
// that part stays genuinely untested until the admin's own PRTG does it).
//
// Not IANA-registered: 55555 below is a placeholder Private Enterprise
// Number, not a real one. Doesn't affect function - this MIB is only ever
// polled by the admin's own PRTG, never published/shared, so there's no
// real collision risk. Register a real one (free, self-service, IANA's
// own site) if you'd rather this not be a placeholder.
const BASE_OID = "1.3.6.1.4.1.55555.1";
const TABLE_OID = `${BASE_OID}.1`; // rackTempSensorTable
const ENTRY_OID = `${BASE_OID}.1.1`; // rackTempSensorEntry

const TABLE_NAME = "rackTempSensorTable";

let agent: any = null;
let agentStartedAt = 0;

// PRTG's Auto-Discovery only considers a device "really SNMP" - and so
// only tries any SNMP sensor types on it, including SNMP Custom Table -
// after a validation check against three standard MIB-II System group
// OIDs (sysDescr, sysName, sysLocation) succeeds. Confirmed via a real
// Paessler support article after this exact symptom (Auto-Discovery only
// finding Ping, never the custom table sensor) showed up against a real
// PRTG instance - this agent originally only registered the custom
// table, nothing at the standard System group OIDs, so that check always
// failed. sysObjectID/sysUpTime added too since most SNMP tooling's own
// "is this alive/what is it" probes read those as well, not just PRTG.
//
// registerProvider() alone does NOT create a queryable instance for a
// Scalar - confirmed the hard way (real client GET returned NoSuchInstance
// until this was added), by reading net-snmp's own Mib.prototype.registerProvider
// source: it only auto-creates the instance via setScalarValue() when
// options.addScalarDefaultsOnRegistration + provider.defVal are both set,
// neither of which this agent uses - so setScalarValue() has to be called
// explicitly for every scalar, right after registering it, or it 404s
// forever regardless of what the handler would have returned.
function registerSystemGroup(mib: any) {
  const scalar = (
    number: number,
    name: string,
    scalarType: number,
    initialValue: string | number,
    handler: (req: any) => void
  ) => {
    // No trailing ".0" here - that's the instance suffix a client actually
    // queries at, added by the library itself; the provider registers at
    // the bare object OID (matches net-snmp's own README example for
    // sysDescr, which registers at "1.3.6.1.2.1.1.1", not "...1.1.0").
    mib.registerProvider({
      name,
      type: snmp.MibProviderType.Scalar,
      oid: `1.3.6.1.2.1.1.${number}`,
      scalarType,
      maxAccess: snmp.MaxAccess["read-only"],
      handler,
    });
    mib.setScalarValue(name, initialValue);
  };

  scalar(1, "sysDescr", snmp.ObjectType.OctetString, "RackTemp SNMP Agent", (req: any) => {
    req.instanceNode.value = "RackTemp SNMP Agent";
    req.done();
  });
  scalar(2, "sysObjectID", snmp.ObjectType.OID, BASE_OID, (req: any) => {
    req.instanceNode.value = BASE_OID; // this agent's own placeholder enterprise OID
    req.done();
  });
  scalar(3, "sysUpTime", snmp.ObjectType.TimeTicks, 0, (req: any) => {
    req.instanceNode.value = Math.round((Date.now() - agentStartedAt) / 10); // hundredths of a second
    req.done();
  });
  scalar(5, "sysName", snmp.ObjectType.OctetString, "RackTemp", (req: any) => {
    req.instanceNode.value = "RackTemp";
    req.done();
  });
  scalar(6, "sysLocation", snmp.ObjectType.OctetString, "", (req: any) => {
    req.instanceNode.value = "";
    req.done();
  });
}

// -1 is used for "no value yet" (never seen a reading, or no humidity
// sensor) - Integer32 has no null, and PRTG's own numeric channels treat
// a negative value as a distinct, filterable case rather than colliding
// with a real reading (temperature/age are never negative in practice
// here; a value of -1 unambiguously means "not available").
function computeRow(sensor: {
  snmpIndex: number | null;
  name: string;
  lastSeenAt: Date | null;
  reading: { temperature: number; humidity: number | null; createdAt: Date } | null;
  maxOfflineMin: number;
}): (number | string)[] {
  const online =
    !!sensor.lastSeenAt && Date.now() - sensor.lastSeenAt.getTime() <= sensor.maxOfflineMin * 60_000 ? 1 : 0;
  const ageMinutes = sensor.reading ? Math.round((Date.now() - sensor.reading.createdAt.getTime()) / 60_000) : -1;
  return [
    sensor.snmpIndex!,
    sensor.name,
    sensor.reading ? Math.round(sensor.reading.temperature * 10) : -1,
    sensor.reading?.humidity != null ? Math.round(sensor.reading.humidity * 10) : -1,
    online,
    ageMinutes,
  ];
}

// Assigns snmpIndex to any sensor that doesn't have one yet (existing
// installs upgrading into this feature, or a sensor created while SNMP
// was disabled) - highest existing index + 1, starting at 1. Never reused
// even after a sensor's deleted: PRTG's own sensor-to-row identity across
// Auto-Discovery re-scans depends on the index staying stable, so reusing
// a freed index could make PRTG silently attribute an old sensor's
// history to a brand new, unrelated one.
async function ensureSnmpIndex(sensorId: string): Promise<number> {
  const existing = await prisma.sensor.findUnique({ where: { id: sensorId }, select: { snmpIndex: true } });
  if (existing?.snmpIndex != null) return existing.snmpIndex;

  const highest = await prisma.sensor.findFirst({
    where: { snmpIndex: { not: null } },
    orderBy: { snmpIndex: "desc" },
    select: { snmpIndex: true },
  });
  const nextIndex = (highest?.snmpIndex ?? 0) + 1;
  await prisma.sensor.update({ where: { id: sensorId }, data: { snmpIndex: nextIndex } });
  return nextIndex;
}

// addTableRow overwrites the row at that index rather than appending a
// duplicate - confirmed with a real net-snmp agent + a real net-snmp
// client Session walking the table over actual UDP, calling this twice
// for the same index and checking the row count stayed the same (it did,
// and the value updated) - safe to call again on every reading, not just
// once at creation.
async function refreshRow(sensorId: string) {
  if (!agent) return;
  const sensor = await prisma.sensor.findUnique({
    where: { id: sensorId },
    include: {
      readings: { orderBy: { createdAt: "desc" }, take: 1 },
      threshold: { select: { maxOfflineMin: true } },
    },
  });
  if (!sensor || sensor.snmpIndex == null) return;

  const row = computeRow({
    snmpIndex: sensor.snmpIndex,
    name: sensor.name,
    lastSeenAt: sensor.lastSeenAt,
    reading: sensor.readings[0] ?? null,
    maxOfflineMin: sensor.threshold?.maxOfflineMin ?? 15,
  });
  agent.getMib().addTableRow(TABLE_NAME, row);
}

// Called after any create/rename/delete in sensors.ts, and after every
// ingest (index.ts wires this in) so the table never goes stale between
// readings. No-ops cleanly whenever the agent isn't running (SNMP
// disabled) - every call site can call this unconditionally. Returns the
// assigned snmpIndex (or null if the agent isn't running) so a caller
// that already has a stale in-memory copy of the sensor - e.g. the POST /
// handler's response, built before this runs - can patch it in rather
// than silently responding with an outdated null.
export async function syncSensorRow(sensorId: string): Promise<number | null> {
  if (!agent) return null;
  const snmpIndex = await ensureSnmpIndex(sensorId);
  await refreshRow(sensorId);
  return snmpIndex;
}

export function removeSensorRow(snmpIndex: number | null) {
  if (!agent || snmpIndex == null) return;
  agent.getMib().deleteTableRow(TABLE_NAME, [snmpIndex]);
}

export async function startSnmpAgent(port: number, community: string) {
  if (agent) return;

  agent = snmp.createAgent({ port, disableAuthorization: false }, (error: Error | null) => {
    if (error) console.error("[snmp] agent error:", error.message);
  });
  agent.getAuthorizer().addCommunity(community);
  agentStartedAt = Date.now();

  const mib = agent.getMib();
  registerSystemGroup(mib);
  mib.registerProvider({
    name: TABLE_NAME,
    type: snmp.MibProviderType.Table,
    oid: ENTRY_OID,
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      { number: 1, name: "sensorIndex", type: snmp.ObjectType.Integer32, maxAccess: snmp.MaxAccess["read-only"] },
      { number: 2, name: "sensorName", type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess["read-only"] },
      { number: 3, name: "temperature", type: snmp.ObjectType.Integer32, maxAccess: snmp.MaxAccess["read-only"] },
      { number: 4, name: "humidity", type: snmp.ObjectType.Integer32, maxAccess: snmp.MaxAccess["read-only"] },
      { number: 5, name: "online", type: snmp.ObjectType.Integer32, maxAccess: snmp.MaxAccess["read-only"] },
      { number: 6, name: "ageMinutes", type: snmp.ObjectType.Integer32, maxAccess: snmp.MaxAccess["read-only"] },
    ],
    tableIndex: [{ columnName: "sensorIndex" }],
  });

  // Populate every existing sensor's row on boot - not just new ones from
  // here on. Sequential on purpose: this only runs once at startup, no
  // need for the extra complexity of Promise.all against a table API
  // that's mutating shared agent state.
  const sensors = await prisma.sensor.findMany({ select: { id: true } });
  for (const s of sensors) {
    await syncSensorRow(s.id);
  }

  console.log(`[snmp] agent listening on UDP ${port} - rackTempSensorTable at ${TABLE_OID}`);
}

export function stopSnmpAgent() {
  if (!agent) return;
  agent.close();
  agent = null;
}
