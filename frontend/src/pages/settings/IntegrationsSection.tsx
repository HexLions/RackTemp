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
    if (!confirm("Rigenerare il token PRTG? Il sensore PRTG aggregato esistente smetterà di funzionare finché non aggiorni l'URL.")) return;
    setBusy(true);
    try {
      const updated = await api.post<IntegrationSettings>("/integrations/regenerate-prtg-token");
      setSettings(updated);
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <div className="center-screen">Caricamento…</div>;

  const origin = window.location.origin;
  const prtgUrl = `${origin}/api/prtg/all?key=${settings.prtgToken}`;
  const metricsUrl = `${origin}/metrics`;

  return (
    <>
      <div className="card">
        <h2>PRTG</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Crea un solo sensore <strong>"HTTP Data Advanced"</strong> (o "REST Custom") in PRTG puntato a questo
          URL: ogni sensore rack configurato compare come coppia di canali Temperature/Humidity/Age, senza
          crearne uno per dispositivo.
        </p>
        <CopyField label="URL sensore PRTG aggregato" value={prtgUrl} />
        <div className="row-actions">
          <button type="button" className="btn-ghost" onClick={regenerate} disabled={busy}>
            Rigenera token
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Prometheus, Grafana, Zabbix, Uptime Kuma</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Endpoint standard in formato Prometheus: aggiungilo come scrape target e ogni sensore compare da solo
          al primo dato, senza configurazione per-sensore nel tool di monitoring.
        </p>
        <CopyField label="Endpoint metriche" value={metricsUrl} />
        <p className="hint" style={{ marginBottom: 6 }}>
          Esempio <code>prometheus.yml</code>:
        </p>
        <pre className="code-block">
          <code>{`scrape_configs:\n  - job_name: rack-temp-monitor\n    static_configs:\n      - targets: ["${window.location.host}"]`}</code>
        </pre>
      </div>
    </>
  );
}
