import { useEffect, useState } from "react";
import { api, ApiError, HttpsSettings } from "../../api/client";

export default function NetworkSection() {
  const [settings, setSettings] = useState<HttpsSettings | null>(null);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    api.get<HttpsSettings>("/system/https-settings").then(setSettings);
  }

  useEffect(load, []);

  async function save(next: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const updated = await api.put<HttpsSettings>("/system/https-settings", { httpsEnabled: next });
      setSettings(updated);
      setPendingValue(null);
      setMsg({
        ok: true,
        text: `Saved. Restart the app for this to take effect (currently still serving over ${
          next ? "HTTP" : "HTTPS"
        }).`,
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function regenerateCert() {
    setRegenerating(true);
    setMsg(null);
    try {
      await api.post("/system/https-settings/regenerate-cert");
      load();
      setMsg({ ok: true, text: "New certificate generated. Restart the app to start serving it." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setRegenerating(false);
    }
  }

  if (!settings) return <p className="muted">Loading…</p>;

  const shown = pendingValue ?? settings.httpsEnabled;

  return (
    <div className="card">
      <h2>HTTPS</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Serves the app over HTTPS using a self-signed certificate the app generates and manages on its
        own — no domain or external certificate authority needed. Browsers will still show a "not
        secure" / self-signed warning the first time you connect (expected: accept/continue past it, or
        import the certificate as trusted if you'd rather not see it again). Takes effect on the next
        restart, not immediately.
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={shown}
          disabled={saving}
          onChange={(e) => {
            setPendingValue(e.target.checked);
            save(e.target.checked);
          }}
        />
        Serve over HTTPS (restart required)
      </label>

      {settings.cert.exists && (
        <p className="hint" style={{ marginTop: 12 }}>
          Certificate generated {new Date(settings.cert.generatedAt!).toLocaleString("it-IT")}.
          <br />
          <span className="mono small">{settings.cert.fingerprint}</span>
        </p>
      )}

      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn-ghost" onClick={regenerateCert} disabled={regenerating}>
          {regenerating ? "Generating…" : "Regenerate certificate"}
        </button>
        {msg && <span className={msg.ok ? "success-text" : "error"}>{msg.text}</span>}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Regenerate if the device's LAN IP changed since the certificate was created (its address list
        won't match anymore) — also needs a restart to actually be served.
      </p>
    </div>
  );
}
