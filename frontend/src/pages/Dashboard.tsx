import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, DiscoveredDevice, Sensor } from "../api/client";
import Sparkline from "../components/Sparkline";
import ThermometerIcon from "../components/ThermometerIcon";
import WifiSignalIcon from "../components/WifiSignalIcon";

type Status = "ok" | "warn" | "crit" | "offline" | "pending";

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function statusOf(sensor: Sensor): Status {
  const reading = sensor.readings?.[0];
  if (!sensor.lastSeenAt || !reading) return "pending";

  const t = sensor.threshold;
  const offlineMin = (Date.now() - new Date(sensor.lastSeenAt).getTime()) / 60_000;
  if (t && offlineMin > t.maxOfflineMin) return "offline";
  if (t?.enabled) {
    if (t.maxTemp !== null && reading.temperature > t.maxTemp) return "crit";
    if (t.minTemp !== null && reading.temperature < t.minTemp) return "crit";
    if (reading.humidity != null) {
      if (t.maxHumidity !== null && reading.humidity > t.maxHumidity) return "crit";
      if (t.minHumidity !== null && reading.humidity < t.minHumidity) return "crit";
    }
  }
  return "ok";
}

const STATUS_LABEL: Record<Status, string> = {
  ok: "OK",
  warn: "Warning",
  crit: "Alarm",
  offline: "Offline",
  pending: "Pending",
};

const STATUS_COLOR: Record<Status, string> = {
  ok: "#4c9a2a",
  warn: "#c77700",
  crit: "#d33c2c",
  offline: "#8a93a1",
  pending: "#8a93a1",
};

export default function Dashboard() {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [staticIp, setStaticIp] = useState("");
  const [pendingChipId, setPendingChipId] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});

  async function load() {
    const [s, d] = await Promise.all([
      api.get<Sensor[]>("/sensors"),
      api.get<DiscoveredDevice[]>("/discovery"),
    ]);
    setSensors(s);
    setDiscovered(d);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  async function addSensor(e: FormEvent) {
    e.preventDefault();
    await api.post("/sensors", {
      name,
      location: location || undefined,
      staticIp: staticIp || undefined,
      chipId: pendingChipId || undefined,
    });
    setName("");
    setLocation("");
    setStaticIp("");
    setPendingChipId(null);
    setShowAdd(false);
    load();
  }

  async function dismissDiscovered(id: string) {
    await api.delete(`/discovery/${id}`);
    load();
  }

  function startFromDiscovered(device: DiscoveredDevice) {
    setName(`Sensor ${device.chipId.slice(-6)}`);
    setStaticIp(device.ip ?? "");
    setPendingChipId(device.chipId);
    setShowAdd(true);
  }

  async function linkExisting(deviceId: string) {
    const sensorId = linkTarget[deviceId];
    if (!sensorId) return;
    await api.post(`/discovery/${deviceId}/claim`, { sensorId });
    load();
  }

  if (!sensors) return <div className="center-screen">Loading…</div>;

  const counts = { ok: 0, crit: 0, offline: 0, pending: 0 };
  sensors.forEach((s) => {
    const st = statusOf(s);
    counts[st === "warn" ? "crit" : st]++;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Sensors</h1>
          <p className="page-sub">
            {sensors.length === 0
              ? "No sensors configured"
              : sensors.length === 1
                ? "1 sensor configured"
                : `${sensors.length} sensors configured`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd((v) => !v)}>
          + New sensor
        </button>
      </div>

      {sensors.length > 0 && (
        <div className="summary-stats">
          <div className="summary-stat">
            <span className="summary-stat-num" style={{ color: "var(--ok)" }}>{counts.ok}</span>
            <span className="muted small">OK</span>
          </div>
          <div className="summary-stat">
            <span className="summary-stat-num" style={{ color: "var(--crit)" }}>{counts.crit}</span>
            <span className="muted small">In alarm</span>
          </div>
          <div className="summary-stat">
            <span className="summary-stat-num" style={{ color: "var(--offline)" }}>{counts.offline}</span>
            <span className="muted small">Offline</span>
          </div>
          {counts.pending > 0 && (
            <div className="summary-stat">
              <span className="summary-stat-num" style={{ color: "var(--offline)" }}>{counts.pending}</span>
              <span className="muted small">Pending</span>
            </div>
          )}
        </div>
      )}

      {discovered.length > 0 && (
        <div className="card setup-panel" style={{ marginBottom: 20 }}>
          <h2>Sensors discovered on the network ({discovered.length})</h2>
          <p className="hint" style={{ marginTop: -4 }}>
            These devices have announced themselves but don't have an API key yet. Create a new sensor, or
            link them to an existing one: the device will pick up the key on its own at the next announcement,
            with no need to touch it again.
          </p>
          <div className="stack-tight">
            {discovered.map((d) => {
              const unlinkedSensors = sensors?.filter((s) => !s.chipId) ?? [];
              return (
                <div key={d.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                  <div className="row-actions" style={{ justifyContent: "space-between" }}>
                    <span className="mono small">
                      chip {d.chipId.slice(-8)} {d.ip && `· ${d.ip}`} · last seen {timeAgo(d.lastSeenAt)}
                    </span>
                    <span className="row-actions">
                      <button type="button" className="btn-link" onClick={() => startFromDiscovered(d)}>
                        New sensor
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => dismissDiscovered(d.id)}>
                        Ignore
                      </button>
                    </span>
                  </div>
                  {unlinkedSensors.length > 0 && (
                    <div className="row-actions" style={{ marginTop: 8 }}>
                      <select
                        value={linkTarget[d.id] ?? ""}
                        onChange={(e) => setLinkTarget({ ...linkTarget, [d.id]: e.target.value })}
                      >
                        <option value="">Link to existing sensor…</option>
                        {unlinkedSensors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!linkTarget[d.id]}
                        onClick={() => linkExisting(d.id)}
                      >
                        Link
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAdd && (
        <form className="card" onSubmit={addSensor} style={{ marginBottom: 20 }}>
          <h2>New sensor</h2>
          <div className="form-row">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Rack A - top" autoFocus />
            </label>
            <label>
              Location (optional)
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Server room 1" />
            </label>
            <label>
              Static IP (optional)
              <input value={staticIp} onChange={(e) => setStaticIp(e.target.value)} placeholder="192.168.1.50" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -8 }}>
            The IP is just a reminder for you (e.g. if you fixed it via a DHCP reservation): the sensor still
            sends data to the server, the server doesn't reach out to it.
          </p>
          <button className="btn-primary" type="submit">
            Create sensor
          </button>
        </form>
      )}

      {sensors.length === 0 && discovered.length === 0 && (
        <div className="empty-state">
          <h3>No sensors yet</h3>
          <p>
            Create a sensor to get its API key and the URL to send readings to. If the ESP32 is already
            powered on and configured with the server's address, it will show up above as "discovered on the
            network" as soon as it announces itself.
          </p>
        </div>
      )}

      <div className="grid">
        {sensors.map((s) => {
          const status = statusOf(s);
          const reading = s.readings?.[0];
          const ago = timeAgo(s.lastSeenAt);
          return (
            <Link
              to={`/sensors/${s.id}`}
              key={s.id}
              className={`sensor-card${status === "pending" ? " pending-card" : ""}`}
            >
              <div className="sensor-card-top">
                <span className={`tile-icon chip-${status === "pending" ? "offline" : status}`}>
                  <ThermometerIcon />
                </span>
                <div className="tile-title">
                  <strong>{s.name}</strong>
                  {s.location && <div className="sensor-location" style={{ margin: 0 }}>{s.location}</div>}
                </div>
                <span className={`chip chip-${status === "pending" ? "offline" : status}`}>{STATUS_LABEL[status]}</span>
              </div>

              {reading ? (
                <div className="sensor-readout">
                  <div className="temp-value">
                    {reading.temperature.toFixed(1)}
                    <span className="unit">°C</span>
                  </div>
                  <Sparkline sensorId={s.id} color={STATUS_COLOR[status]} />
                </div>
              ) : (
                <div className="sensor-readout">
                  <div className="temp-value">—.—°C</div>
                </div>
              )}

              <div className="sensor-meta">
                <span>{reading?.humidity != null ? `${reading.humidity.toFixed(0)}% RH` : ""}</span>
                <span className="row-actions" style={{ gap: 5, justifyContent: "flex-end" }}>
                  {reading?.rssi != null && <WifiSignalIcon rssi={reading.rssi} showLabel />}
                  {ago ?? "no data"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
