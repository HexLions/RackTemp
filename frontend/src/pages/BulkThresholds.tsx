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
      setResult(`✓ Thresholds applied to ${selectedIds.length} sensors.`);
    } catch {
      setResult("Error while applying — try again.");
    } finally {
      setApplying(false);
    }
  }

  if (!sensors) return <div className="center-screen">Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Multiple thresholds</h1>
          <p className="page-sub">
            Set the same thresholds on multiple sensors at once, instead of repeating the configuration one
            by one.
          </p>
        </div>
      </div>

      {sensors.length === 0 ? (
        <div className="empty-state">
          <h3>No sensors configured</h3>
          <p>Create at least one sensor from the dashboard before using this page.</p>
        </div>
      ) : (
        <form className="card" onSubmit={apply}>
          <h2>Values to apply</h2>
          <div className="form-row">
            <label>
              Min temp. (°C)
              <input
                type="number"
                step="0.1"
                value={values.minTemp ?? ""}
                onChange={(e) => setValues({ ...values, minTemp: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              Max temp. (°C)
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
              Min humidity (%)
              <input
                type="number"
                step="1"
                value={values.minHumidity ?? ""}
                onChange={(e) => setValues({ ...values, minHumidity: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </label>
            <label>
              Max humidity (%)
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
              Hysteresis (°C)
              <input
                type="number"
                step="0.1"
                value={values.hysteresis}
                onChange={(e) => setValues({ ...values, hysteresis: Number(e.target.value) })}
              />
            </label>
            <label>
              Notification cooldown (min)
              <input
                type="number"
                value={values.cooldownMin}
                onChange={(e) => setValues({ ...values, cooldownMin: Number(e.target.value) })}
              />
            </label>
            <label>
              Offline after (min)
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
            Notifications active
          </label>

          <h2 style={{ marginTop: 24 }}>Sensors ({selectedIds.length}/{sensors.length} selected)</h2>
          <div className="row-actions" style={{ marginBottom: 10 }}>
            <button type="button" className="btn-link" onClick={() => toggleAll(true)}>
              Select all
            </button>
            <button type="button" className="btn-link" onClick={() => toggleAll(false)}>
              Deselect all
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
              {applying ? "Applying…" : `Apply to ${selectedIds.length} sensors`}
            </button>
            {result && <span className={result.startsWith("✓") ? "success-text" : "error"}>{result}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
