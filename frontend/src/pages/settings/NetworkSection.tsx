import { useEffect, useState } from "react";
import { api, ApiError, HttpsSettings } from "../../api/client";

export default function NetworkSection() {
  const [settings, setSettings] = useState<HttpsSettings | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    api.get<HttpsSettings>("/system/https-settings").then(setSettings);
  }

  useEffect(load, []);

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

  return (
    <div className="card">
      <h2>HTTPS</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        The app is always served over HTTPS, using a self-signed certificate it generates and
        manages on its own — no domain or external certificate authority needed, no toggle to set.
        Browsers show a "not secure" / self-signed warning the first time you connect (expected:
        accept/continue past it, or import the certificate as trusted if you'd rather not see it
        again). This also applies to sensors, PRTG/Prometheus/Zabbix integrations, and anything
        else pointed at this server — see the README if you're updating an existing setup that
        was on plain HTTP before.
      </p>

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
        won't match anymore) — needs a restart to actually be served, and any sensor with a pinned
        fingerprint (setup portal) needs it updated too, or it'll refuse to send data.
      </p>
    </div>
  );
}
