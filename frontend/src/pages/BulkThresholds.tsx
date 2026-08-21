import { FormEvent, useEffect, useState } from "react";
import { api, Sensor } from "../api/client";

interface BulkValues {
  minTemp: number | null;
  maxTemp: number | null;
  minHumidity: number | null;
  maxHumidity: number | null;
  hysteresis: number;
  cooldownMin: number;
  maxOfflineMin: number;
  enabled: boolean;
}

const DEFAULTS: BulkValues = {
  minTemp: null,
  maxTemp: null,
  minHumidity: null,
  maxHumidity: null,
  hysteresis: 0.5,
  cooldownMin: 15,
  maxOfflineMin: 15,
  enabled: true,
};

export default function BulkThresholds() {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<BulkValues>(DEFAULTS);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.get<Sensor[]>("/sensors").then((s) => {
      setSensors(s);
      const all: Record<string, boolean> = {};
      s.forEach((sensor) => (all[sensor.id] = true));
      setSelected(all);
    });
  }, []);

  function toggleAll(checked: boolean) {
    if (!sensors) return;
    const next: Record<string, boolean> = {};
    sensors.forEach((s) => (next[s.id] = checked));
    setSelected(next);
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setApplying(true);
    setResult(null);
    try {
      await Promise.all(selectedIds.map((id) => api.put(`/sensors/${id}/threshold`, values)));
      setResult(`✓ Soglie applicate a ${selectedIds.length} sensori.`);
    } catch {
      setResult("Errore durante l'applicazione — riprova.");
    } finally {
      setApplying(false);
    }
  }

  if (!sensors) return <div className="center-screen">Caricamento…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Soglie multiple</h1>
          <p className="page-sub">
            Imposta le stesse soglie su più sensori in un colpo solo, invece di ripetere la configurazione uno
            per uno.
          </p>
        </div>
      </div>

      {sensors.length === 0 ? (
        <div className="empty-state">
          <h3>Nessun sensore configurato</h3>
          <p>Crea almeno un sensore dalla dashboard prima di usare questa pagina.</p>
        </div>
      ) : (
        <form className="card" onSubmit={apply}>
          <h2>Valori da applicare</h2>
          <div className="form-row">
            <label>
              Temp. minima (°C)
              <input
                type="number"
                step="0.1"
                value={values.minTemp ?? ""}
                onChange={(e) => setValues({ ...values, minTemp: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              Temp. massima (°C)
              <input
                type="number"
                step="0.1"
                value={values.maxTemp ?? ""}
                onChange={(e) => setValues({ ...values, maxTemp: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Umidità minima (%)
              <input
                type="number"
                step="1"
                value={values.minHumidity ?? ""}
                onChange={(e) => setValues({ ...values, minHumidity: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              Umidità massima (%)
              <input
                type="number"
                step="1"
                value={values.maxHumidity ?? ""}
                onChange={(e) => setValues({ ...values, maxHumidity: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Isteresi (°C)
              <input
                type="number"
                step="0.1"
                value={values.hysteresis}
                onChange={(e) => setValues({ ...values, hysteresis: Number(e.target.value) })}
              />
            </label>
            <label>
              Cooldown notifiche (min)
              <input
                type="number"
                value={values.cooldownMin}
                onChange={(e) => setValues({ ...values, cooldownMin: Number(e.target.value) })}
              />
            </label>
            <label>
              Offline dopo (min)
              <input
                type="number"
                value={values.maxOfflineMin}
                onChange={(e) => setValues({ ...values, maxOfflineMin: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={values.enabled}
              onChange={(e) => setValues({ ...values, enabled: e.target.checked })}
            />
            Notifiche attive
          </label>

          <h2 style={{ marginTop: 24 }}>Sensori ({selectedIds.length}/{sensors.length} selezionati)</h2>
          <div className="row-actions" style={{ marginBottom: 10 }}>
            <button type="button" className="btn-link" onClick={() => toggleAll(true)}>
              Seleziona tutti
            </button>
            <button type="button" className="btn-link" onClick={() => toggleAll(false)}>
              Deseleziona tutti
            </button>
          </div>
          <div className="stack-tight" style={{ marginBottom: 20 }}>
            {sensors.map((s) => (
              <label key={s.id} className="checkbox-row" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={selected[s.id] ?? false}
                  onChange={(e) => setSelected({ ...selected, [s.id]: e.target.checked })}
                />
                {s.name}
                {s.location && <span className="muted"> · {s.location}</span>}
              </label>
            ))}
          </div>

          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={applying || selectedIds.length === 0}>
              {applying ? "Applico…" : `Applica a ${selectedIds.length} sensori`}
            </button>
            {result && <span className={result.startsWith("✓") ? "success-text" : "error"}>{result}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
