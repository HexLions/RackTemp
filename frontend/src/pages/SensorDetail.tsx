import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, Reading, Sensor, Threshold } from "../api/client";

export default function SensorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [threshold, setThreshold] = useState<Threshold | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    if (!id) return;
    const [s, r] = await Promise.all([
      api.get<Sensor>(`/sensors/${id}`),
      api.get<Reading[]>(`/sensors/${id}/readings?hours=24`),
    ]);
    setSensor(s);
    setThreshold(s.threshold);
    setReadings(r);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, [id]);

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
  const prtgUrl = `${window.location.origin}/api/prtg/${sensor.id}?key=${sensor.apiKey}`;

  return (
    <div>
      <div className="page-header">
        <h1>{sensor.name}</h1>
        <button className="btn-danger" onClick={deleteSensor}>
          Elimina sensore
        </button>
      </div>

      <div className="card">
        <h2>Andamento (24h)</h2>
        {chartData.length === 0 ? (
          <p className="muted">Ancora nessuna lettura.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="time" minTickGap={30} />
              <YAxis unit="°C" domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="temperature" stroke="#4f9dff" dot={false} strokeWidth={2} />
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
        <button className="btn-primary" type="submit">
          Salva soglie
        </button>
        {saved && <span className="muted"> ✓ salvato</span>}
      </form>

      <div className="card">
        <h2>Integrazione ESP32 / PRTG</h2>
        <label>
          <span>
            Endpoint ingest (POST JSON, header <code>X-Api-Key</code>)
          </span>
          <input readOnly value={ingestUrl} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          API key sensore
          <div className="key-row">
            <input readOnly value={sensor.apiKey} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-link" onClick={regenerateKey}>
              Rigenera
            </button>
          </div>
        </label>
        <label>
          URL sensore PRTG (HTTP Data Advanced / REST Custom)
          <input readOnly value={prtgUrl} onFocus={(e) => e.target.select()} />
        </label>
        <p className="muted small">
          Body POST atteso: <code>{`{"temperature": 23.4, "humidity": 45.0}`}</code>
        </p>
      </div>
    </div>
  );
}
