import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, FirmwareRelease, Reading, Sensor, Threshold } from "../api/client";
import CopyField from "../components/CopyField";
import WifiSignalIcon from "../components/WifiSignalIcon";

export default function SensorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [threshold, setThreshold] = useState<Threshold | null>(null);
  const [saved, setSaved] = useState(false);
  const [rangeHours, setRangeHours] = useState(24);

  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStaticIp, setEditStaticIp] = useState("");
  const [infoSaved, setInfoSaved] = useState(false);
  const [latestFirmware, setLatestFirmware] = useState<FirmwareRelease | null>(null);

  async function load() {
    if (!id) return;
    const [s, r] = await Promise.all([
      api.get<Sensor>(`/sensors/${id}`),
      api.get<Reading[]>(`/sensors/${id}/readings?hours=${rangeHours}`),
    ]);
    setSensor(s);
    setThreshold(s.threshold);
    setReadings(r);
    setEditName(s.name);
    setEditLocation(s.location ?? "");
    setEditStaticIp(s.staticIp ?? "");
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, [id, rangeHours]);

  useEffect(() => {
    api.get<FirmwareRelease>("/firmware/latest").then(setLatestFirmware).catch(() => setLatestFirmware(null));
  }, []);

  async function muteFor(hours: number) {
    if (!id) return;
    const until = new Date(Date.now() + hours * 3600_000).toISOString();
    const updated = await api.put<Threshold>(`/sensors/${id}/threshold`, { mutedUntil: until });
    setThreshold(updated);
  }

  async function unmute() {
    if (!id) return;
    const updated = await api.put<Threshold>(`/sensors/${id}/threshold`, { mutedUntil: null });
    setThreshold(updated);
  }

  async function saveInfo(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const updated = await api.put<Sensor>(`/sensors/${id}`, {
      name: editName,
      location: editLocation || null,
      staticIp: editStaticIp || null,
    });
    setSensor((prev) => (prev ? { ...prev, ...updated } : updated));
    setInfoSaved(true);
    setTimeout(() => setInfoSaved(false), 2000);
  }

  async function saveThreshold(e: FormEvent) {
    e.preventDefault();
    if (!id || !threshold) return;
    const updated = await api.put<Threshold>(`/sensors/${id}/threshold`, {
      minTemp: threshold.minTemp,
      maxTemp: threshold.maxTemp,
      minHumidity: threshold.minHumidity,
      maxHumidity: threshold.maxHumidity,
      maxOfflineMin: threshold.maxOfflineMin,
      hysteresis: threshold.hysteresis,
      cooldownMin: threshold.cooldownMin,
      enabled: threshold.enabled,
    });
    setThreshold(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function regenerateKey() {
    if (!id) return;
    if (!confirm("Regenerate the API key? The old ESP32 will stop working until you update its firmware.")) return;
    const updated = await api.post<Sensor>(`/sensors/${id}/regenerate-key`);
    setSensor(updated);
  }

  async function rebootSensor() {
    if (!id) return;
    if (!confirm("Reboot this sensor? It has no open connection, so this takes effect on its next check-in (up to ~1 minute).")) return;
    const updated = await api.post<Sensor>(`/sensors/${id}/reboot`);
    setSensor(updated);
  }

  async function deleteSensor() {
    if (!id) return;
    if (!confirm("Permanently delete this sensor and all its history?")) return;
    await api.delete(`/sensors/${id}`);
    navigate("/");
  }

  if (!sensor || !threshold) return <div className="center-screen">Loading…</div>;

  const chartData = readings.map((r) => ({
    time:
      rangeHours <= 24
        ? new Date(r.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
        : new Date(r.createdAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    temperature: r.temperature,
    humidity: r.humidity,
  }));
  const hasHumidity = readings.some((r) => r.humidity != null);

  const ingestUrl = `${window.location.origin}/api/ingest`;
  const prtgUrl = `${window.location.origin}/api/prtg/${sensor.id}?key=${sensor.apiKey}`;
  const statusUrl = `${window.location.origin}/api/status/${sensor.id}?key=${sensor.apiKey}`;
  const hasData = readings.length > 0;

  const connectionPanel = (
    <div className={`card${hasData ? "" : " setup-panel"}`}>
      <h2>Sensor connection</h2>
      {!hasData && (
        <p className="hint" style={{ marginTop: -4 }}>
          No data received yet. Configure these values in the sensor's setup portal and it will show up here
          on the first reading.
        </p>
      )}
      <CopyField label="Ingest endpoint (POST JSON, X-Api-Key header)" value={ingestUrl} />
      <CopyField label="Sensor API key" value={sensor.apiKey} />
      <div className="row-actions" style={{ margin: "-10px 0 16px" }}>
        <button type="button" className="btn-link" onClick={regenerateKey}>
          Regenerate API key
        </button>
      </div>
      {sensor.firmwareVersion && (
        <p className="hint" style={{ marginBottom: 16 }}>
          Firmware on the device: <code>{sensor.firmwareVersion}</code>
          {latestFirmware && latestFirmware.version !== sensor.firmwareVersion && (
            <>
              {" "}
              <span className="chip chip-warn">Update available: {latestFirmware.version}</span>
            </>
          )}
        </p>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>
        Expected POST body: <code>{`{"temperature": 23.4, "humidity": 45.0}`}</code>. For one aggregated
        integration covering every sensor at once (PRTG, Prometheus), see the{" "}
        <Link to="/impostazioni/integrazioni" className="btn-link" style={{ display: "inline" }}>
          Integrations
        </Link>{" "}
        page instead.
      </p>
    </div>
  );

  const perDevicePanel = (
    <div className="card">
      <h2>This sensor as its own device</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        Want this sensor to show up as a separate device/host in your monitoring tool, instead of a
        channel inside one big aggregated sensor? Use one of these — each returns just this sensor's
        data, so they work with per-device auto-discovery-style setups.
      </p>
      <CopyField
        label="PRTG — HTTP Data Advanced sensor URL"
        value={prtgUrl}
        hint="Create a Device for this sensor in PRTG, then add an HTTP Data Advanced sensor with this URL."
      />
      <CopyField
        label="Generic JSON status (Zabbix, Uptime Kuma, Home Assistant, …)"
        value={statusUrl}
        hint="Plain JSON: temperature, humidity, rssi, online, lastSeenAt — for any tool that can GET and parse JSON."
      />
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{sensor.name}</h1>
          {sensor.location && <p className="page-sub">{sensor.location}</p>}
          {sensor.readings?.[0]?.rssi != null && (
            <p className="page-sub row-actions" style={{ gap: 5, marginTop: 4 }}>
              <WifiSignalIcon rssi={sensor.readings[0].rssi} />
              WiFi: {sensor.readings[0].rssi} dBm
            </p>
          )}
        </div>
        <div className="row-actions">
          <button className="btn-ghost" onClick={rebootSensor} disabled={sensor.rebootRequested}>
            {sensor.rebootRequested ? "Reboot pending…" : "Reboot sensor"}
          </button>
          <button className="btn-danger" onClick={deleteSensor}>
            Delete sensor
          </button>
        </div>
      </div>

      {!hasData && connectionPanel}

      <div className="card">
        <div className="row-actions" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Trend</h2>
          <span className="row-actions" style={{ gap: 6 }}>
            {[
              { label: "24h", hours: 24 },
              { label: "7d", hours: 24 * 7 },
              { label: "30d", hours: 24 * 30 },
            ].map((opt) => (
              <button
                key={opt.hours}
                type="button"
                className="btn-ghost"
                disabled={rangeHours === opt.hours}
                style={rangeHours === opt.hours ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
                onClick={() => setRangeHours(opt.hours)}
              >
                {opt.label}
              </button>
            ))}
            <a
              href={`/api/sensors/${id}/readings.csv?hours=${rangeHours}`}
              className="btn-ghost"
              style={{ textDecoration: "none", display: "inline-block" }}
            >
              Export CSV
            </a>
          </span>
        </div>
        {chartData.length === 0 ? (
          <p className="muted">No readings yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#dfe2e5" vertical={false} />
              <XAxis
                dataKey="time"
                minTickGap={30}
                stroke="#98a1b0"
                fontSize={11}
                fontFamily="ui-monospace, monospace"
                tickLine={false}
                axisLine={{ stroke: "#dfe2e5" }}
              />
              <YAxis
                yAxisId="temp"
                unit="°C"
                domain={["auto", "auto"]}
                stroke="#3d7dd3"
                fontSize={11}
                fontFamily="ui-monospace, monospace"
                tickLine={false}
                axisLine={false}
                width={48}
              />
              {hasHumidity && (
                <YAxis
                  yAxisId="humidity"
                  orientation="right"
                  unit="%"
                  domain={[0, 100]}
                  stroke="#4c9a2a"
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
              )}
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #dfe2e5",
                  borderRadius: 10,
                  fontSize: 13,
                  boxShadow: "0 8px 20px rgba(32,36,42,0.12)",
                }}
                labelStyle={{ color: "#667085" }}
              />
              {hasHumidity && <Legend wrapperStyle={{ fontSize: 12 }} />}
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name="Temperature (°C)"
                stroke="#3d7dd3"
                dot={false}
                strokeWidth={2}
              />
              {hasHumidity && (
                <Line
                  yAxisId="humidity"
                  type="monotone"
                  dataKey="humidity"
                  name="Humidity (%)"
                  stroke="#4c9a2a"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <form className="card" onSubmit={saveThreshold}>
        <h2>Thresholds and notifications</h2>
        <div className="form-row">
          <label>
            Min temp. (°C)
            <input
              type="number"
              step="0.1"
              value={threshold.minTemp ?? ""}
              onChange={(e) => setThreshold({ ...threshold, minTemp: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            Max temp. (°C)
            <input
              type="number"
              step="0.1"
              value={threshold.maxTemp ?? ""}
              onChange={(e) => setThreshold({ ...threshold, maxTemp: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Min humidity (%)
            <input
              type="number"
              step="1"
              value={threshold.minHumidity ?? ""}
              onChange={(e) => setThreshold({ ...threshold, minHumidity: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            Max humidity (%)
            <input
              type="number"
              step="1"
              value={threshold.maxHumidity ?? ""}
              onChange={(e) => setThreshold({ ...threshold, maxHumidity: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Hysteresis (°C)
            <input
              type="number"
              step="0.1"
              value={threshold.hysteresis}
              onChange={(e) => setThreshold({ ...threshold, hysteresis: Number(e.target.value) })}
            />
          </label>
          <label>
            Notification cooldown (min)
            <input
              type="number"
              value={threshold.cooldownMin}
              onChange={(e) => setThreshold({ ...threshold, cooldownMin: Number(e.target.value) })}
            />
          </label>
          <label>
            Offline after (min)
            <input
              type="number"
              value={threshold.maxOfflineMin}
              onChange={(e) => setThreshold({ ...threshold, maxOfflineMin: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={threshold.enabled}
            onChange={(e) => setThreshold({ ...threshold, enabled: e.target.checked })}
          />
          Notifications active for this sensor
        </label>

        {threshold.mutedUntil && new Date(threshold.mutedUntil).getTime() > Date.now() ? (
          <p className="hint" style={{ color: "var(--warn)" }}>
            🔇 Notifications muted until{" "}
            {new Date(threshold.mutedUntil).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            .{" "}
            <button type="button" className="btn-link" onClick={unmute}>
              Unmute now
            </button>
          </p>
        ) : (
          <div className="row-actions" style={{ marginBottom: 16 }}>
            <span className="muted small">Mute temporarily:</span>
            <button type="button" className="btn-ghost" onClick={() => muteFor(1)}>
              1h
            </button>
            <button type="button" className="btn-ghost" onClick={() => muteFor(24)}>
              24h
            </button>
          </div>
        )}

        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Save thresholds
          </button>
          {saved && <span className="success-text">✓ saved</span>}
        </div>
      </form>

      {hasData && connectionPanel}
      {hasData && perDevicePanel}

      <form className="card" onSubmit={saveInfo}>
        <h2>Sensor info</h2>
        <div className="form-row">
          <label>
            Name
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </label>
          <label>
            Location (optional)
            <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="Server room 1" />
          </label>
          <label>
            Static IP (optional)
            <input value={editStaticIp} onChange={(e) => setEditStaticIp(e.target.value)} placeholder="192.168.1.50" />
          </label>
        </div>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Save info
          </button>
          {infoSaved && <span className="success-text">✓ saved</span>}
        </div>
      </form>
    </div>
  );
}
