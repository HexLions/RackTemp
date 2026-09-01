import { useEffect, useState } from "react";
import { api, IntegrationSettings } from "../../api/client";
import CopyField from "../../components/CopyField";
import { useDashboardOrigin } from "../../hooks/useDashboardOrigin";

export default function IntegrationsSection() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [snmpEnabled, setSnmpEnabled] = useState(false);
  const [snmpPort, setSnmpPort] = useState(1161);
  const [snmpSaved, setSnmpSaved] = useState(false);
  const [snmpBusy, setSnmpBusy] = useState(false);
  const dashboardOrigin = useDashboardOrigin();

  useEffect(() => {
    api.get<IntegrationSettings>("/integrations").then((s) => {
      setSettings(s);
      setSnmpEnabled(s.snmpEnabled);
      setSnmpPort(s.snmpPort);
    });
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

  async function saveSnmp() {
    setSnmpBusy(true);
    try {
      const updated = await api.put<IntegrationSettings>("/integrations/snmp", { snmpEnabled, snmpPort });
      setSettings((prev) => (prev ? { ...prev, ...updated } : prev));
      setSnmpSaved(true);
      setTimeout(() => setSnmpSaved(false), 2000);
    } finally {
      setSnmpBusy(false);
    }
  }

  async function regenerateSnmpCommunity() {
    if (!confirm("Regenerate the SNMP community string? Update it in PRTG's device settings too, or polling will fail.")) return;
    setSnmpBusy(true);
    try {
      const res = await api.post<{ snmpCommunity: string }>("/integrations/regenerate-snmp-community");
      setSettings((prev) => (prev ? { ...prev, snmpCommunity: res.snmpCommunity } : prev));
    } finally {
      setSnmpBusy(false);
    }
  }

  if (!settings) return <div className="center-screen">Loading…</div>;

  const prtgUrl = `${dashboardOrigin}/api/prtg/all?key=${settings.prtgToken}`;
  const metricsUrl = `${dashboardOrigin}/metrics`;
  const dashboardHost = dashboardOrigin.replace(/^https?:\/\//, "");
  const dashboardHostname = dashboardHost.split(":")[0];

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
        <h2>
          SNMP (PRTG auto-discovery)
          <span className={`chip ${snmpEnabled ? "chip-ok" : "chip-offline"}`}>
            {snmpEnabled ? "Active" : "Inactive"}
          </span>
        </h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Exposes every sensor as a real SNMP table, so PRTG's own native Auto-Discovery can create
          one PRTG sensor per rack sensor automatically — add a sensor here, it shows up in PRTG on
          its own within your Auto-Discovery schedule, no manual PRTG configuration per device.
          Uses a standard, stable protocol (not PRTG's experimental push API) — no privileged port
          needed either: default 1161, not 161, since this app never runs with the elevated
          permission binding 161 would need.
        </p>
        <label className="checkbox-row">
          <input type="checkbox" checked={snmpEnabled} onChange={(e) => setSnmpEnabled(e.target.checked)} />
          Enable SNMP
        </label>
        <div className="form-row">
          <label>
            Port
            <input
              type="number"
              value={snmpPort}
              onChange={(e) => setSnmpPort(Number(e.target.value))}
              min={1}
              max={65535}
            />
          </label>
        </div>
        <div className="row-actions" style={{ marginBottom: 12 }}>
          <button type="button" className="btn-primary" onClick={saveSnmp} disabled={snmpBusy}>
            {snmpBusy ? "Saving…" : "Save"}
          </button>
          {snmpSaved && <span className="success-text">✓ saved, live now</span>}
        </div>
        {settings.snmpCommunity && (
          <>
            <CopyField label="SNMP community string" value={settings.snmpCommunity} />
            <div className="row-actions" style={{ margin: "-10px 0 16px" }}>
              <button type="button" className="btn-link" onClick={regenerateSnmpCommunity} disabled={snmpBusy}>
                Regenerate community string
              </button>
            </div>
          </>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          One-time PRTG setup: add a Device pointed at <code>{dashboardHostname}</code>, port{" "}
          <code>{snmpPort}</code>, SNMP v2c with the community string above. Add one{" "}
          <strong>SNMP Custom Table</strong> sensor for the table at OID{" "}
          <code>1.3.6.1.4.1.55555.1.1</code>, save that Device as a <strong>Device Template</strong>,
          then set its Auto-Discovery to use that template on a schedule (e.g. hourly). From then
          on, every rack sensor appears as its own PRTG sensor automatically — Temperature/Humidity/
          Online/Age as channels of that sensor.
        </p>
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
          <code>{`scrape_configs:\n  - job_name: rack-temp-monitor\n    static_configs:\n      - targets: ["${dashboardHost}"]`}</code>
        </pre>
      </div>
    </>
  );
}
