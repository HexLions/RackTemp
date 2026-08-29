import { FormEvent, useEffect, useState } from "react";
import { api, NotificationConfig, NotificationLogEntry, ApiError } from "../../api/client";

function timeAgo(iso: string) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

const TYPE_LABEL: Record<string, string> = {
  high_temp: "High temp.",
  low_temp: "Low temp.",
  high_humidity: "High humidity",
  low_humidity: "Low humidity",
  offline: "Offline",
  recovered: "Recovered",
  recovered_temp: "Recovered",
  recovered_humidity: "Recovered",
};

const TYPE_CHIP: Record<string, string> = {
  high_temp: "chip-crit",
  low_temp: "chip-crit",
  high_humidity: "chip-crit",
  low_humidity: "chip-crit",
  offline: "chip-offline",
  recovered: "chip-ok",
  recovered_temp: "chip-ok",
  recovered_humidity: "chip-ok",
};

export default function NotificationsSection() {
  const [cfg, setCfg] = useState<NotificationConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState<{ channel: string; ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[] | null>(null);

  useEffect(() => {
    api.get<NotificationConfig>("/notifications/config").then(setCfg);
    api.get<NotificationLogEntry[]>("/notifications/log?limit=100").then(setLog);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    const updated = await api.put<NotificationConfig>("/notifications/config", cfg);
    setCfg(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function test(channel: "smtp" | "telegram") {
    setTestMsg(null);
    try {
      await api.post("/notifications/test", { channel });
      setTestMsg({ channel, ok: true, text: "Test message sent." });
    } catch (err) {
      setTestMsg({ channel, ok: false, text: err instanceof ApiError ? err.message : "Error" });
    }
  }

  if (!cfg) return <div className="center-screen">Loading…</div>;

  return (
    <>
      <form className="card" onSubmit={save}>
        <h2>
          Email (SMTP)
          <span className={`chip ${cfg.smtpEnabled ? "chip-ok" : "chip-offline"}`}>
            {cfg.smtpEnabled ? "Active" : "Inactive"}
          </span>
        </h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={cfg.smtpEnabled}
            onChange={(e) => setCfg({ ...cfg, smtpEnabled: e.target.checked })}
          />
          Enable email notifications
        </label>

        <label>
          Sign-in method
          <select
            value={cfg.emailProvider}
            onChange={(e) => setCfg({ ...cfg, emailProvider: e.target.value as "smtp" | "graph" })}
          >
            <option value="smtp">SMTP (username/password)</option>
            <option value="graph">Microsoft Graph (OAuth2)</option>
          </select>
        </label>
        {cfg.emailProvider === "graph" && (
          <p className="muted small">
            Use this if your mailbox is Outlook.com or Exchange Online — Microsoft is retiring SMTP basic
            auth for those at the end of 2026. Requires an Azure AD app registration with the{" "}
            <code>Mail.Send</code> application permission (admin consent granted), scoped to the sender
            mailbox below.
          </p>
        )}

        {cfg.emailProvider === "smtp" ? (
          <>
            <div className="form-row">
              <label>
                SMTP host
                <input value={cfg.smtpHost ?? ""} onChange={(e) => setCfg({ ...cfg, smtpHost: e.target.value })} placeholder="smtp.gmail.com" />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={cfg.smtpPort ?? ""}
                  onChange={(e) => setCfg({ ...cfg, smtpPort: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="587"
                />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={cfg.smtpSecure} onChange={(e) => setCfg({ ...cfg, smtpSecure: e.target.checked })} />
                TLS/SSL from the start (port 465)
              </label>
            </div>
            <p className="muted small">
              Port and this checkbox have to match, or the connection fails with an SSL error
              ("wrong version number") — <strong>port 465</strong>: check the box (TLS from the very first
              byte). <strong>Port 587 or 25</strong>: leave it unchecked (STARTTLS — still encrypted, just
              negotiated a moment after connecting instead of immediately). Most providers, including
              Gmail, support 587/unchecked.
            </p>
            <div className="form-row">
              <label>
                User
                <input value={cfg.smtpUser ?? ""} onChange={(e) => setCfg({ ...cfg, smtpUser: e.target.value })} />
              </label>
              <label>
                Password / App password
                <input
                  type="password"
                  value={cfg.smtpPass ?? ""}
                  onChange={(e) => setCfg({ ...cfg, smtpPass: e.target.value })}
                  placeholder="leave empty to keep unchanged"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                From
                <input value={cfg.smtpFrom ?? ""} onChange={(e) => setCfg({ ...cfg, smtpFrom: e.target.value })} placeholder="rack@yourdomain.com" />
              </label>
              <label>
                To
                <input value={cfg.smtpTo ?? ""} onChange={(e) => setCfg({ ...cfg, smtpTo: e.target.value })} placeholder="alerts@yourdomain.com" />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="form-row">
              <label>
                Tenant ID
                <input
                  value={cfg.graphTenantId ?? ""}
                  onChange={(e) => setCfg({ ...cfg, graphTenantId: e.target.value })}
                  placeholder="Azure AD directory (tenant) ID"
                />
              </label>
              <label>
                Client ID
                <input
                  value={cfg.graphClientId ?? ""}
                  onChange={(e) => setCfg({ ...cfg, graphClientId: e.target.value })}
                  placeholder="App registration's application (client) ID"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Client secret
                <input
                  type="password"
                  value={cfg.graphClientSecret ?? ""}
                  onChange={(e) => setCfg({ ...cfg, graphClientSecret: e.target.value })}
                  placeholder="leave empty to keep unchanged"
                />
              </label>
              <label>
                Sender mailbox
                <input
                  value={cfg.graphSenderEmail ?? ""}
                  onChange={(e) => setCfg({ ...cfg, graphSenderEmail: e.target.value })}
                  placeholder="rack@yourdomain.com"
                />
              </label>
            </div>
            <label>
              To
              <input value={cfg.smtpTo ?? ""} onChange={(e) => setCfg({ ...cfg, smtpTo: e.target.value })} placeholder="alerts@yourdomain.com" />
            </label>
          </>
        )}
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Save
          </button>
          <button type="button" className="btn-link" onClick={() => test("smtp")}>
            Send test
          </button>
        </div>
        {saved && <span className="success-text"> ✓ saved</span>}
        {testMsg?.channel === "smtp" && <div className={testMsg.ok ? "success-text" : "error"}>{testMsg.text}</div>}
      </form>

      <form className="card" onSubmit={save}>
        <h2>
          Telegram
          <span className={`chip ${cfg.telegramEnabled ? "chip-ok" : "chip-offline"}`}>
            {cfg.telegramEnabled ? "Active" : "Inactive"}
          </span>
        </h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={cfg.telegramEnabled}
            onChange={(e) => setCfg({ ...cfg, telegramEnabled: e.target.checked })}
          />
          Enable Telegram notifications
        </label>
        <div className="form-row">
          <label>
            Bot token
            <input
              value={cfg.telegramToken ?? ""}
              onChange={(e) => setCfg({ ...cfg, telegramToken: e.target.value })}
              placeholder="123456:ABC-DEF... (from @BotFather)"
            />
          </label>
          <label>
            Chat ID
            <input
              value={cfg.telegramChatId ?? ""}
              onChange={(e) => setCfg({ ...cfg, telegramChatId: e.target.value })}
              placeholder="e.g. -1001234567890"
            />
          </label>
        </div>
        <p className="muted small">
          Create a bot with @BotFather on Telegram, get the token, add the bot to the chat/group and retrieve
          the Chat ID (e.g. with @userinfobot or the <code>getUpdates</code> API).
        </p>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Save
          </button>
          <button type="button" className="btn-link" onClick={() => test("telegram")}>
            Send test
          </button>
        </div>
        {testMsg?.channel === "telegram" && <div className={testMsg.ok ? "success-text" : "error"}>{testMsg.text}</div>}
      </form>

      <div className="card">
        <h2>Alert history</h2>
        {!log ? (
          <p className="muted">Loading…</p>
        ) : log.length === 0 ? (
          <p className="muted">No alerts sent so far.</p>
        ) : (
          <div className="stack-tight">
            {log.map((entry) => (
              <div key={entry.id} className="row-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span className={`chip ${TYPE_CHIP[entry.type] ?? "chip-offline"}`}>
                    {TYPE_LABEL[entry.type] ?? entry.type}
                  </span>{" "}
                  <strong style={{ fontSize: "0.88rem" }}>{entry.sensor.name}</strong>
                  <div className="muted small">{entry.message}</div>
                </div>
                <span className="muted small mono" style={{ whiteSpace: "nowrap" }}>
                  {timeAgo(entry.sentAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
