import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Sensor } from "../api/client";

function timeAgo(iso: string | null) {
  if (!iso) return "mai";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s fa`;
  if (sec < 3600) return `${Math.round(sec / 60)}m fa`;
  return `${Math.round(sec / 3600)}h fa`;
}

function statusOf(sensor: Sensor): "ok" | "alert" | "offline" {
  const t = sensor.threshold;
  const reading = sensor.readings?.[0];
  if (!sensor.lastSeenAt) return "offline";
  const offlineMin = (Date.now() - new Date(sensor.lastSeenAt).getTime()) / 60_000;
  if (t && offlineMin > t.maxOfflineMin) return "offline";
  if (t && reading) {
    if (t.maxTemp !== null && reading.temperature > t.maxTemp) return "alert";
    if (t.minTemp !== null && reading.temperature < t.minTemp) return "alert";
  }
  return "ok";
}

export default function Dashboard() {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  async function load() {
    setSensors(await api.get<Sensor[]>("/sensors"));
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  async function addSensor(e: FormEvent) {
    e.preventDefault();
    await api.post("/sensors", { name, location: location || undefined });
    setName("");
    setLocation("");
    setShowAdd(false);
    load();
  }

  if (!sensors) return <div className="center-screen">Caricamento…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Sensori</h1>
        <button className="btn-primary" onClick={() => setShowAdd((v) => !v)}>
          + Nuovo sensore
        </button>
      </div>

      {showAdd && (
        <form className="card" onSubmit={addSensor} style={{ marginBottom: 20 }}>
          <label>
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Rack A - top" />
          </label>
          <label>
            Posizione (opzionale)
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala server 1" />
          </label>
          <button className="btn-primary" type="submit">
            Crea
          </button>
        </form>
      )}

      {sensors.length === 0 && (
        <p className="muted">
          Nessun sensore ancora. Crea un sensore per ottenere la sua API key, poi configura l'ESP32-S2 per
          inviare le letture a <code>POST /api/ingest</code>.
        </p>
      )}

      <div className="grid">
        {sensors.map((s) => {
          const status = statusOf(s);
          const reading = s.readings?.[0];
          return (
            <Link to={`/sensors/${s.id}`} key={s.id} className={`card sensor-card status-${status}`}>
              <div className="sensor-card-top">
                <strong>{s.name}</strong>
                <span className={`badge badge-${status}`}>
                  {status === "ok" ? "OK" : status === "alert" ? "Allarme" : "Offline"}
                </span>
              </div>
              {s.location && <div className="muted">{s.location}</div>}
              <div className="temp-value">{reading ? `${reading.temperature.toFixed(1)}°C` : "—"}</div>
              {reading?.humidity != null && <div className="muted">Umidità: {reading.humidity.toFixed(0)}%</div>}
              <div className="muted small">Ultimo dato: {timeAgo(s.lastSeenAt)}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
