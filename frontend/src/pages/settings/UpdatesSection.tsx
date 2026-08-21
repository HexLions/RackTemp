import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, IntegrationSettings, UpdateCheck } from "../../api/client";

export default function UpdatesSection() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState(false);

  useEffect(() => {
    api.get<IntegrationSettings>("/integrations").then((s) => {
      setSettings(s);
      setWebhookUrl(s.portainerWebhookUrl ?? "");
    });
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

  if (!settings) return <div className="center-screen">Caricamento…</div>;

  const isNative = updateCheck?.platform === "windows" || updateCheck?.platform === "linux";

  return (
    <div className="card">
      <h2>Aggiornamento controller</h2>
      {isNative ? (
        <p className="hint" style={{ marginTop: -4 }}>
          Installazione {updateCheck!.platform === "windows" ? "Windows" : "Linux"} nativa: qui vedi se c'è una
          release più recente di quella installata, con link per scaricarla. L'aggiornamento resta manuale — scarica
          {updateCheck!.platform === "windows" ? " ed esegui il nuovo installer" : " ed esegui di nuovo install.sh"},
          i dati non vengono toccati.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: -4 }}>
          Se lo stack include Watchtower (di default in <code>docker-compose.portainer.yml</code>), il controller
          si aggiorna da solo entro poche ore da ogni nuova release, senza fare nulla qui. Questa sezione serve per
          vedere a che versione sei e, se vuoi saltare l'attesa, per forzare subito un redeploy tramite un webhook
          Portainer opzionale. I dati (letture, sensori, soglie, login) vivono nel volume Docker e non vengono
          toccati dall'aggiornamento.
        </p>
      )}

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

      {isNative ? (
        updateCheck!.updateAvailable && (
          <div className="row-actions" style={{ marginTop: 12 }}>
            {updateCheck!.downloadUrl ? (
              <a href={updateCheck!.downloadUrl} className="btn-primary" style={{ textDecoration: "none" }}>
                Scarica {updateCheck!.platform === "windows" ? "installer" : "pacchetto"} v{updateCheck!.latestVersion}
              </a>
            ) : (
              <a href={updateCheck!.releaseUrl} target="_blank" rel="noreferrer" className="btn-primary" style={{ textDecoration: "none" }}>
                Apri la release su GitHub
              </a>
            )}
          </div>
        )
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
