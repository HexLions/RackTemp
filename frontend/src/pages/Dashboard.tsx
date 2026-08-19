import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Sensor } from "../api/client";
import Sparkline from "../components/Sparkline";

type Status = "ok" | "warn" | "crit" | "offline" | "pending";

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s fa`;
  if (sec < 3600) return `${Math.round(sec / 60)}m fa`;
  return `${Math.round(sec / 3600)}h fa`;
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
  }
  return "ok";
}

const STATUS_LABEL: Record<Status, string> = {
  ok: "OK",
  warn: "Attenzione",
  crit: "Allarme",
  offline: "Offline",
  pending: "In attesa",
};

const STATUS_COLOR: Record<Status, string> = {
  ok: "#34d399",
  warn: "#f5a524",
  crit: "#fb4864",
  offline: "#5b6577",
  pending: "#5b6577",
};

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
        <div>
          <h1>Sensori</h1>
          <p className="page-sub">
            {sensors.length === 0
              ? "Nessun sensore configurato"
              : sensors.length === 1
                ? "1 sensore configurato"
                : `${sensors.length} sensori configurati`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd((v) => !v)}>
          + Nuovo sensore
        </button>
      </div>

      {showAdd && (
        <form className="card" onSubmit={addSensor} style={{ marginBottom: 20 }}>
          <h2>Nuovo sensore</h2>
          <div className="form-row">
            <label>
              Nome
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Rack A - top" autoFocus />
            </label>
            <label>
              Posizione (opzionale)
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sala server 1" />
            </label>
          </div>
          <button className="btn-primary" type="submit">
            Crea sensore
          </button>
        </form>
      )}

      {sensors.length === 0 && (
        <div className="empty-state">
          <h3>Ancora nessun sensore</h3>
          <p>
            Crea un sensore per ottenere la sua API key e l'URL a cui inviare le letture. L'ESP32 non viene
            rilevato in automatico: comparirà qui non appena riceve la prima lettura con quella chiave.
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
                <span className={`led led-${status === "pending" ? "offline" : status}`} />
                <strong>{s.name}</strong>
                <span className={`chip chip-${status === "pending" ? "offline" : status}`}>{STATUS_LABEL[status]}</span>
              </div>
              {s.location && <div className="sensor-location">{s.location}</div>}

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
                <span>{ago ?? "nessun dato"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
