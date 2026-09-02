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
  // Which fields the admin actually edited - only these get sent per
  // sensor. Without this, every field (including ones left at their
  // default/blank, e.g. minTemp/maxTemp) got applied to every selected
  // sensor on every submit, silently wiping out thresholds the admin
  // never meant to touch (e.g. opening this page just to set humidity
  // limits used to null out every sensor's existing temp thresholds).
  const [touched, setTouched] = useState<Partial<Record<keyof BulkValues, boolean>>>({});
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function setField<K extends keyof BulkValues>(key: K, value: BulkValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => ({ ...t, [key]: true }));
  }

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
    const touchedKeys = Object.keys(touched).filter((k) => touched[k as keyof BulkValues]);
    if (touchedKeys.length === 0) {
      setResult("Edit at least one field before applying — nothing was changed.");
      return;
    }
    const payload = Object.fromEntries(touchedKeys.map((k) => [k, values[k as keyof BulkValues]]));
    setApplying(true);
    setResult(null);
    try {
      await Promise.all(selectedIds.map((id) => api.put(`/sensors/${id}/threshold`, payload)));
      setResult(`✓ Applied to ${selectedIds.length} sensors: ${touchedKeys.join(", ")}. Other fields left untouched.`);
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
            by one. Only fields you actually edit below get applied — anything left untouched keeps its
            existing value on each sensor.
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
                onChange={(e) => setField("minTemp", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label>
              Max temp. (°C)
              <input
                type="number"
                step="0.1"
                value={values.maxTemp ?? ""}
                onChange={(e) => setField("maxTemp", e.target.value === "" ? null : Number(e.target.value))}
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
                onChange={(e) => setField("minHumidity", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label>
              Max humidity (%)
              <input
                type="number"
                step="1"
                value={values.maxHumidity ?? ""}
                onChange={(e) => setField("maxHumidity", e.target.value === "" ? null : Number(e.target.value))}
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
                onChange={(e) => setField("hysteresis", Number(e.target.value))}
              />
            </label>
            <label>
              Notification cooldown (min)
              <input
                type="number"
                value={values.cooldownMin}
                onChange={(e) => setField("cooldownMin", Number(e.target.value))}
              />
            </label>
            <label>
              Offline after (min)
              <input
                type="number"
                value={values.maxOfflineMin}
                onChange={(e) => setField("maxOfflineMin", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={values.enabled}
              onChange={(e) => setField("enabled", e.target.checked)}
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
