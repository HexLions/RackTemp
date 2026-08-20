import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, Reading, Sensor, Threshold } from "../api/client";
import CopyField from "../components/CopyField";

export default function SensorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [threshold, setThreshold] = useState<Threshold | null>(null);
  const [saved, setSaved] = useState(false);

  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStaticIp, setEditStaticIp] = useState("");
  const [infoSaved, setInfoSaved] = useState(false);

  async function load() {
    if (!id) return;
    const [s, r] = await Promise.all([
      api.get<Sensor>(`/sensors/${id}`),
      api.get<Reading[]>(`/sensors/${id}/readings?hours=24`),
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
  }, [id]);

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
    if (!confirm("Rigenerare la API key? Il vecchio ESP32 smetterà di funzionare finché non aggiorni il firmware.")) return;
    const updated = await api.post<Sensor>(`/sensors/${id}/regenerate-key`);
    setSensor(updated);
  }

  async function deleteSensor() {
    if (!id) return;
    if (!confirm("Eliminare definitivamente questo sensore e tutto lo storico?")) return;
    await api.delete(`/sensors/${id}`);
    navigate("/");
  }

  if (!sensor || !threshold) return <div className="center-screen">Caricamento…</div>;

  const chartData = readings.map((r) => ({
    time: new Date(r.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    temperature: r.temperature,
  }));

  const ingestUrl = `${window.location.origin}/api/ingest`;
  const hasData = readings.length > 0;

  const connectionPanel = (
    <div className={`card${hasData ? "" : " setup-panel"}`}>
      <h2>Collegamento sensore</h2>
      {!hasData && (
        <p className="hint" style={{ marginTop: -4 }}>
          Nessun dato ricevuto. Flasha questi valori nel firmware dell'ESP32-S2 (<code>config.h</code>) e
          comparirà qui alla prima lettura.
        </p>
      )}
      <CopyField label="Endpoint ingest (POST JSON, header X-Api-Key)" value={ingestUrl} />
      <CopyField label="API key sensore" value={sensor.apiKey} />
      <div className="row-actions" style={{ margin: "-10px 0 16px" }}>
        <button type="button" className="btn-link" onClick={regenerateKey}>
          Rigenera API key
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Body POST atteso: <code>{`{"temperature": 23.4, "humidity": 45.0}`}</code>. Per collegare questo
        sensore a PRTG, Prometheus o altri strumenti di monitoring vedi la pagina{" "}
        <Link to="/integrazioni" className="btn-link" style={{ display: "inline" }}>
          Integrazioni
        </Link>{" "}
        — è configurata una volta sola per tutti i sensori, non per singolo dispositivo.
      </p>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{sensor.name}</h1>
          {sensor.location && <p className="page-sub">{sensor.location}</p>}
        </div>
        <button className="btn-danger" onClick={deleteSensor}>
          Elimina sensore
        </button>
      </div>

      {!hasData && connectionPanel}

      <div className="card">
        <h2>Andamento (24h)</h2>
        {chartData.length === 0 ? (
          <p className="muted">Ancora nessuna lettura.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#e2e5ea" vertical={false} />
              <XAxis
                dataKey="time"
                minTickGap={30}
                stroke="#8a93a1"
                fontSize={11}
                fontFamily="ui-monospace, monospace"
                tickLine={false}
                axisLine={{ stroke: "#e2e5ea" }}
              />
              <YAxis
                unit="°C"
                domain={["auto", "auto"]}
                stroke="#8a93a1"
                fontSize={11}
                fontFamily="ui-monospace, monospace"
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e2e5ea",
                  borderRadius: 8,
                  fontSize: 13,
                  boxShadow: "0 4px 16px rgba(27,36,48,0.1)",
                }}
                labelStyle={{ color: "#5b6472" }}
              />
              <Line type="monotone" dataKey="temperature" stroke="#2455c7" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <form className="card" onSubmit={saveThreshold}>
        <h2>Soglie e notifiche</h2>
        <div className="form-row">
          <label>
            Temp. minima (°C)
            <input
              type="number"
              step="0.1"
              value={threshold.minTemp ?? ""}
              onChange={(e) => setThreshold({ ...threshold, minTemp: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            Temp. massima (°C)
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
            Isteresi (°C)
            <input
              type="number"
              step="0.1"
              value={threshold.hysteresis}
              onChange={(e) => setThreshold({ ...threshold, hysteresis: Number(e.target.value) })}
            />
          </label>
          <label>
            Cooldown notifiche (min)
            <input
              type="number"
              value={threshold.cooldownMin}
              onChange={(e) => setThreshold({ ...threshold, cooldownMin: Number(e.target.value) })}
            />
          </label>
          <label>
            Offline dopo (min)
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
          Notifiche attive per questo sensore
        </label>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Salva soglie
          </button>
          {saved && <span className="success-text">✓ salvato</span>}
        </div>
      </form>

      {hasData && connectionPanel}

      <form className="card" onSubmit={saveInfo}>
        <h2>Info sensore</h2>
        <div className="form-row">
          <label>
            Nome
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
          </label>
          <label>
            Posizione (opzionale)
            <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="Sala server 1" />
          </label>
          <label>
            IP statico (opzionale)
            <input value={editStaticIp} onChange={(e) => setEditStaticIp(e.target.value)} placeholder="192.168.1.50" />
          </label>
        </div>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Salva info
          </button>
          {infoSaved && <span className="success-text">✓ salvato</span>}
        </div>
      </form>
    </div>
  );
}
