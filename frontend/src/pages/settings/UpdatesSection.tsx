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
      setWebhookMsg({ ok: true, text: "Webhook saved." });
    } catch (err) {
      setWebhookMsg({ ok: false, text: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setWebhookBusy(false);
    }
  }

  async function triggerUpdate() {
    if (!confirm("The controller will be restarted with the latest image. Readings and settings are not touched (they live in the data volume). Proceed?")) return;
    setUpdateBusy(true);
    setUpdateMsg(null);
    try {
      await api.post("/system/trigger-update");
      setUpdateMsg({ ok: true, text: "Update started. The container will restart shortly." });
    } catch (err) {
      setUpdateMsg({ ok: false, text: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setUpdateBusy(false);
    }
  }

  if (!settings) return <div className="center-screen">Loading…</div>;

  const isNative = updateCheck?.platform === "windows" || updateCheck?.platform === "linux";

  return (
    <div className="card">
      <h2>Controller update</h2>
      {isNative ? (
        <p className="hint" style={{ marginTop: -4 }}>
          Native {updateCheck!.platform === "windows" ? "Windows" : "Linux"} installation: here you can see if
          there's a release newer than the one installed, with a link to download it. The update stays manual —
          download
          {updateCheck!.platform === "windows" ? " and run the new installer" : " and run install.sh again"},
          the data is not touched.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: -4 }}>
          If the stack includes Watchtower (default in <code>docker-compose.portainer.yml</code>), the controller
          updates itself within a few hours of every new release, with nothing to do here. This section is for
          seeing which version you're on and, if you want to skip the wait, for forcing an immediate redeploy via
          an optional Portainer webhook. The data (readings, sensors, thresholds, login) lives in the Docker
          volume and is not touched by the update.
        </p>
      )}

      {updateCheckError && <p className="hint">Unable to check releases on GitHub right now.</p>}
      {updateCheck && (
        <p className="hint">
          Running version: <code>{updateCheck.currentVersion}</code> — latest release:{" "}
          <a href={updateCheck.releaseUrl} target="_blank" rel="noreferrer">
            <code>{updateCheck.latestVersion}</code>
          </a>
          {updateCheck.updateAvailable ? (
            <span className="chip chip-warn" style={{ marginLeft: 8 }}>
              Update available
            </span>
          ) : (
            <span className="chip chip-ok" style={{ marginLeft: 8 }}>
              Up to date
            </span>
          )}
        </p>
      )}

      {isNative ? (
        updateCheck!.updateAvailable && (
          <div className="row-actions" style={{ marginTop: 12 }}>
            {updateCheck!.downloadUrl ? (
              <a href={updateCheck!.downloadUrl} className="btn-primary" style={{ textDecoration: "none" }}>
                Download {updateCheck!.platform === "windows" ? "installer" : "package"} v{updateCheck!.latestVersion}
              </a>
            ) : (
              <a href={updateCheck!.releaseUrl} target="_blank" rel="noreferrer" className="btn-primary" style={{ textDecoration: "none" }}>
                Open the release on GitHub
              </a>
            )}
          </div>
        )
      ) : (
        <>
          <form onSubmit={saveWebhook} className="form-row" style={{ alignItems: "flex-end" }}>
            <label style={{ flex: 1 }}>
              <span>
                Portainer webhook (Container/Stack → Add webhook, in Portainer). Needed to restart the
                controller from here.
              </span>
              <input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://portainer.local/api/webhooks/xxxxxxxx"
              />
            </label>
            <button className="btn-ghost" type="submit" disabled={webhookBusy}>
              {webhookBusy ? "Saving…" : "Save webhook"}
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
              {updateBusy ? "Updating…" : "Update now"}
            </button>
            {!settings.portainerWebhookUrl && <span className="hint">Configure the webhook above first.</span>}
            {updateMsg && <span className={updateMsg.ok ? "success-text" : "error"}>{updateMsg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
