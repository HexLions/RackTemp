import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, DiscoveredDevice, Sensor } from "../api/client";
import Sparkline from "../components/Sparkline";
import ThermometerIcon from "../components/ThermometerIcon";

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
    if (reading.humidity != null) {
      if (t.maxHumidity !== null && reading.humidity > t.maxHumidity) return "crit";
      if (t.minHumidity !== null && reading.humidity < t.minHumidity) return "crit";
    }
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
    setName(`Sensore ${device.chipId.slice(-6)}`);
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

      {discovered.length > 0 && (
        <div className="card setup-panel" style={{ marginBottom: 20 }}>
          <h2>Sensori rilevati in rete ({discovered.length})</h2>
          <p className="hint" style={{ marginTop: -4 }}>
            Questi dispositivi si sono annunciati ma non hanno ancora un'API key. Crea un sensore nuovo, oppure
            collegali a uno già esistente: il dispositivo prende la key da solo al prossimo annuncio, senza
            toccarlo di nuovo.
          </p>
          <div className="stack-tight">
            {discovered.map((d) => {
              const unlinkedSensors = sensors?.filter((s) => !s.chipId) ?? [];
              return (
                <div key={d.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                  <div className="row-actions" style={{ justifyContent: "space-between" }}>
                    <span className="mono small">
                      chip {d.chipId.slice(-8)} {d.ip && `· ${d.ip}`} · visto {timeAgo(d.lastSeenAt)}
                    </span>
                    <span className="row-actions">
                      <button type="button" className="btn-link" onClick={() => startFromDiscovered(d)}>
                        Nuovo sensore
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => dismissDiscovered(d.id)}>
                        Ignora
                      </button>
                    </span>
                  </div>
                  {unlinkedSensors.length > 0 && (
                    <div className="row-actions" style={{ marginTop: 8 }}>
                      <select
                        value={linkTarget[d.id] ?? ""}
                        onChange={(e) => setLinkTarget({ ...linkTarget, [d.id]: e.target.value })}
                      >
                        <option value="">Collega a sensore esistente…</option>
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
                        Collega
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
            <label>
              IP statico (opzionale)
              <input value={staticIp} onChange={(e) => setStaticIp(e.target.value)} placeholder="192.168.1.50" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -8 }}>
            L'IP è solo un promemoria per te (es. se l'hai fissato via DHCP reservation): il sensore comunque
            invia i dati al server, non è il server a raggiungerlo.
          </p>
          <button className="btn-primary" type="submit">
            Crea sensore
          </button>
        </form>
      )}

      {sensors.length === 0 && discovered.length === 0 && (
        <div className="empty-state">
          <h3>Ancora nessun sensore</h3>
          <p>
            Crea un sensore per ottenere la sua API key e l'URL a cui inviare le letture. Se l'ESP32 è già
            acceso e configurato con l'indirizzo del server, comparirà qui sopra come "rilevato in rete" non
            appena si annuncia.
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
                <span>{ago ?? "nessun dato"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
