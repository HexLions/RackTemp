import { useEffect, useState } from "react";
import { api, IntegrationSettings } from "../../api/client";
import CopyField from "../../components/CopyField";

export default function IntegrationsSection() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<IntegrationSettings>("/integrations").then(setSettings);
  }, []);

  async function regenerate() {
    if (!confirm("Regenerate the PRTG token? The existing aggregated PRTG sensor will stop working until you update the URL.")) return;
    setBusy(true);
    try {
      const updated = await api.post<IntegrationSettings>("/integrations/regenerate-prtg-token");
      setSettings(updated);
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <div className="center-screen">Loading…</div>;

  const origin = window.location.origin;
  const prtgUrl = `${origin}/api/prtg/all?key=${settings.prtgToken}`;
  const metricsUrl = `${origin}/metrics`;

  return (
    <>
      <div className="card">
        <h2>PRTG</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Create a single <strong>"HTTP Data Advanced"</strong> sensor (or "REST Custom") in PRTG pointed at
          this URL: every configured rack sensor shows up as a Temperature/Humidity/Age channel pair, with no
          need to create one per device.
        </p>
        <CopyField label="Aggregated PRTG sensor URL" value={prtgUrl} />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={regenerate} disabled={busy}>
            Regenerate token
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Prometheus, Grafana, Zabbix, Uptime Kuma</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Standard Prometheus-format endpoint: add it as a scrape target and every sensor shows up on its own
          at the first data point, with no per-sensor configuration in the monitoring tool.
        </p>
        <CopyField label="Metrics endpoint" value={metricsUrl} />
        <p className="hint" style={{ marginBottom: 6 }}>
          Example <code>prometheus.yml</code>:
        </p>
        <pre className="code-block">
          <code>{`scrape_configs:\n  - job_name: rack-temp-monitor\n    static_configs:\n      - targets: ["${window.location.host}"]`}</code>
        </pre>
      </div>
    </>
  );
}
