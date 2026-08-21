import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, FirmwareRelease, IntegrationSettings, UpdateCheck } from "../api/client";
import CopyField from "../components/CopyField";

export default function Integrations() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [firmware, setFirmware] = useState<FirmwareRelease | null>(null);
  const [fwVersion, setFwVersion] = useState("");
  const [fwNotes, setFwNotes] = useState("");
  const [fwBusy, setFwBusy] = useState(false);
  const [fwMsg, setFwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<IntegrationSettings>("/integrations").then((s) => {
      setSettings(s);
      setWebhookUrl(s.portainerWebhookUrl ?? "");
    });
    api.get<FirmwareRelease>("/firmware/latest").then(setFirmware).catch(() => setFirmware(null));
    api
      .get<UpdateCheck>("/system/update-check")
      .then(setUpdateCheck)
      .catch(() => setUpdateCheckError(true));
  }, []);

  async function saveWebhook(e: FormEvent) {
    e.preventDefault();
    setWebhookBusy(true);
    setWebhookMsg(null);
    try {
      const updated = await api.put<IntegrationSettings>("/integrations/portainer-webhook", {
        portainerWebhookUrl: webhookUrl.trim() || null,
      });
      setSettings(updated);
      setWebhookMsg({ ok: true, text: "Webhook salvato." });
    } catch (err) {
      setWebhookMsg({ ok: false, text: err instanceof ApiError ? err.message : "Errore di rete" });
    } finally {
      setWebhookBusy(false);
    }
  }

  async function triggerUpdate() {
    if (!confirm("Il controller verrà riavviato con l'ultima immagine. Le letture e le impostazioni non vengono toccate (vivono nel volume dati). Procedere?")) return;
    setUpdateBusy(true);
    setUpdateMsg(null);
    try {
      await api.post("/system/trigger-update");
      setUpdateMsg({ ok: true, text: "Aggiornamento avviato. Il container si riavvierà a breve." });
    } catch (err) {
      setUpdateMsg({ ok: false, text: err instanceof ApiError ? err.message : "Errore di rete" });
    } finally {
      setUpdateBusy(false);
    }
  }

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

  async function uploadFirmware(e: FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || !fwVersion.trim()) {
      setFwMsg({ ok: false, text: "Versione e file .bin sono obbligatori." });
      return;
    }

    setFwBusy(true);
    setFwMsg(null);
    try {
      const form = new FormData();
      form.append("version", fwVersion.trim());
      form.append("notes", fwNotes.trim());
      form.append("firmware", file);
      const res = await fetch("/api/firmware", { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText);
      }
      const release = await res.json();
      setFirmware(release);
      setFwVersion("");
      setFwNotes("");
      if (fileInput.current) fileInput.current.value = "";
      setFwMsg({ ok: true, text: "Firmware caricato." });
    } catch (err) {
      setFwMsg({ ok: false, text: err instanceof ApiError ? err.message : "Errore di rete" });
    } finally {
      setFwBusy(false);
    }
  }

  if (!settings) return <div className="center-screen">Caricamento…</div>;

  const origin = window.location.origin;
  const prtgUrl = `${origin}/api/prtg/all?key=${settings.prtgToken}`;
  const metricsUrl = `${origin}/metrics`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Integrazioni</h1>
          <p className="page-sub">
            Configurazione a livello di controller: un endpoint per tutti i sensori, non uno per sensore.
          </p>
        </div>
      </div>

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

      <div className="card">
        <h2>Aggiornamento controller</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Controlla automaticamente le release su GitHub e permette di far ripartire il container con l'ultima
          immagine con un click. I dati (letture, sensori, soglie, login) vivono nel volume Docker e non vengono
          toccati dall'aggiornamento.
        </p>

        {updateCheckError && <p className="hint">Impossibile controllare le release su GitHub in questo momento.</p>}
        {updateCheck && (
          <p className="hint">
            Versione in esecuzione: <code>{updateCheck.currentVersion}</code> — ultima release:{" "}
            <a href={updateCheck.releaseUrl} target="_blank" rel="noreferrer">
              <code>{updateCheck.latestVersion}</code>
            </a>
            {updateCheck.updateAvailable ? (
              <span className="chip chip-warn" style={{ marginLeft: 8 }}>
                Aggiornamento disponibile
              </span>
            ) : (
              <span className="chip chip-ok" style={{ marginLeft: 8 }}>
                Aggiornato
              </span>
            )}
          </p>
        )}

        <form onSubmit={saveWebhook} className="form-row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: 1 }}>
            <span>
              Webhook Portainer (Container/Stack → Aggiungi webhook, in Portainer). Serve per far ripartire il
              controller da qui.
            </span>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://portainer.local/api/webhooks/xxxxxxxx"
            />
          </label>
          <button className="btn-ghost" type="submit" disabled={webhookBusy}>
            {webhookBusy ? "Salvo…" : "Salva webhook"}
          </button>
        </form>
        {webhookMsg && <p className={webhookMsg.ok ? "success-text" : "error"}>{webhookMsg.text}</p>}

        <div className="row-actions" style={{ marginTop: 12 }}>
          <button
            className="btn-primary"
            type="button"
            onClick={triggerUpdate}
            disabled={updateBusy || !settings.portainerWebhookUrl}
          >
            {updateBusy ? "Aggiorno…" : "Aggiorna ora"}
          </button>
          {!settings.portainerWebhookUrl && <span className="hint">Configura prima il webhook sopra.</span>}
          {updateMsg && <span className={updateMsg.ok ? "success-text" : "error"}>{updateMsg.text}</span>}
        </div>
      </div>

      <form className="card" onSubmit={uploadFirmware}>
        <h2>Aggiornamento firmware sensori</h2>
        <p className="hint" style={{ marginTop: -4 }}>
          Carica qui il <code>.bin</code> compilato: i sensori già collegati lo scaricano da soli entro 24h
          (o al prossimo riavvio) via OTA, senza bisogno di ricollegarli via USB. La configurazione salvata sul
          dispositivo (WiFi, server, API key) non viene toccata dall'aggiornamento.
        </p>
        {firmware && (
          <p className="hint">
            Versione attuale disponibile: <code>{firmware.version}</code>
            {firmware.notes && <> — {firmware.notes}</>}
          </p>
        )}
        <div className="form-row">
          <label>
            Versione
            <input value={fwVersion} onChange={(e) => setFwVersion(e.target.value)} placeholder="2026-08-22.1" required />
          </label>
          <label>
            Note (opzionale)
            <input value={fwNotes} onChange={(e) => setFwNotes(e.target.value)} placeholder="Fix reconnect WiFi" />
          </label>
        </div>
        <label>
          File firmware (.bin)
          <input type="file" accept=".bin" ref={fileInput} required />
        </label>
        <div className="row-actions">
          <button className="btn-primary" type="submit" disabled={fwBusy}>
            {fwBusy ? "Carico…" : "Carica firmware"}
          </button>
          {fwMsg && <span className={fwMsg.ok ? "success-text" : "error"}>{fwMsg.text}</span>}
        </div>
      </form>

      <div className="card">
        <h2>Backup</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          I dati sopravvivono automaticamente a un aggiornamento del container (vivono nel volume Docker, non
          nell'immagine). Questo è solo un promemoria per un backup manuale prima di modifiche importanti.
        </p>
        <a href="/api/system/backup" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Scarica backup database
        </a>
      </div>
    </div>
  );
}
