import { FormEvent, useEffect, useState } from "react";
import { api, NotificationConfig, NotificationLogEntry, ApiError } from "../api/client";

function timeAgo(iso: string) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s fa`;
  if (sec < 3600) return `${Math.round(sec / 60)}m fa`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h fa`;
  return `${Math.round(sec / 86400)}g fa`;
}

const TYPE_LABEL: Record<string, string> = {
  high_temp: "Temp. alta",
  low_temp: "Temp. bassa",
  high_humidity: "Umidità alta",
  low_humidity: "Umidità bassa",
  offline: "Offline",
  recovered: "Rientrato",
  recovered_temp: "Rientrato",
  recovered_humidity: "Rientrato",
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

export default function NotificationSettings() {
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
      setTestMsg({ channel, ok: true, text: "Messaggio di test inviato." });
    } catch (err) {
      setTestMsg({ channel, ok: false, text: err instanceof ApiError ? err.message : "Errore" });
    }
  }

  if (!cfg) return <div className="center-screen">Caricamento…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Notifiche</h1>
          <p className="page-sub">Soglie superate, sensori offline e ripristini vengono inviati qui.</p>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <h2>
          Email (SMTP)
          <span className={`chip ${cfg.smtpEnabled ? "chip-ok" : "chip-offline"}`}>
            {cfg.smtpEnabled ? "Attivo" : "Disattivo"}
          </span>
        </h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={cfg.smtpEnabled}
            onChange={(e) => setCfg({ ...cfg, smtpEnabled: e.target.checked })}
          />
          Attiva notifiche via email
        </label>
        <div className="form-row">
          <label>
            Host SMTP
            <input value={cfg.smtpHost ?? ""} onChange={(e) => setCfg({ ...cfg, smtpHost: e.target.value })} placeholder="smtp.gmail.com" />
          </label>
          <label>
            Porta
            <input
              type="number"
              value={cfg.smtpPort ?? ""}
              onChange={(e) => setCfg({ ...cfg, smtpPort: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="587"
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={cfg.smtpSecure} onChange={(e) => setCfg({ ...cfg, smtpSecure: e.target.checked })} />
            TLS/SSL
          </label>
        </div>
        <div className="form-row">
          <label>
            Utente
            <input value={cfg.smtpUser ?? ""} onChange={(e) => setCfg({ ...cfg, smtpUser: e.target.value })} />
          </label>
          <label>
            Password / App password
            <input
              type="password"
              value={cfg.smtpPass ?? ""}
              onChange={(e) => setCfg({ ...cfg, smtpPass: e.target.value })}
              placeholder="lascia vuoto per non modificare"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Mittente
            <input value={cfg.smtpFrom ?? ""} onChange={(e) => setCfg({ ...cfg, smtpFrom: e.target.value })} placeholder="rack@tuodominio.it" />
          </label>
          <label>
            Destinatario
            <input value={cfg.smtpTo ?? ""} onChange={(e) => setCfg({ ...cfg, smtpTo: e.target.value })} placeholder="allarmi@tuodominio.it" />
          </label>
        </div>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Salva
          </button>
          <button type="button" className="btn-link" onClick={() => test("smtp")}>
            Invia test
          </button>
        </div>
        {saved && <span className="success-text"> ✓ salvato</span>}
        {testMsg?.channel === "smtp" && <div className={testMsg.ok ? "success-text" : "error"}>{testMsg.text}</div>}
      </form>

      <form className="card" onSubmit={save}>
        <h2>
          Telegram
          <span className={`chip ${cfg.telegramEnabled ? "chip-ok" : "chip-offline"}`}>
            {cfg.telegramEnabled ? "Attivo" : "Disattivo"}
          </span>
        </h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={cfg.telegramEnabled}
            onChange={(e) => setCfg({ ...cfg, telegramEnabled: e.target.checked })}
          />
          Attiva notifiche via Telegram
        </label>
        <div className="form-row">
          <label>
            Bot token
            <input
              value={cfg.telegramToken ?? ""}
              onChange={(e) => setCfg({ ...cfg, telegramToken: e.target.value })}
              placeholder="123456:ABC-DEF... (da @BotFather)"
            />
          </label>
          <label>
            Chat ID
            <input
              value={cfg.telegramChatId ?? ""}
              onChange={(e) => setCfg({ ...cfg, telegramChatId: e.target.value })}
              placeholder="es. -1001234567890"
            />
          </label>
        </div>
        <p className="muted small">
          Crea un bot con @BotFather su Telegram, ottieni il token, aggiungi il bot alla chat/gruppo e recupera
          il Chat ID (es. con @userinfobot o l'API <code>getUpdates</code>).
        </p>
        <div className="row-actions">
          <button className="btn-primary" type="submit">
            Salva
          </button>
          <button type="button" className="btn-link" onClick={() => test("telegram")}>
            Invia test
          </button>
        </div>
        {testMsg?.channel === "telegram" && <div className={testMsg.ok ? "success-text" : "error"}>{testMsg.text}</div>}
      </form>

      <div className="card">
        <h2>Storico avvisi</h2>
        {!log ? (
          <p className="muted">Caricamento…</p>
        ) : log.length === 0 ? (
          <p className="muted">Nessun avviso inviato finora.</p>
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
    </div>
  );
}
