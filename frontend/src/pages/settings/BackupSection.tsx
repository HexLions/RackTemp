import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, BackupFileInfo, BackupSettings } from "../../api/client";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupSection() {
  const [cfg, setCfg] = useState<BackupSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [files, setFiles] = useState<BackupFileInfo[] | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Now a POST (downloads the whole database — shouldn't be reachable by a
  // plain GET/navigation), so it can't be a plain <a href> anymore: fetch
  // the blob ourselves and trigger the save manually.
  async function downloadNow() {
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/system/backup", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "racktemp-backup.sqlite";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDownloadBusy(false);
    }
  }

  function loadFiles() {
    api.get<BackupFileInfo[]>("/system/backups").then(setFiles);
  }

  useEffect(() => {
    api.get<BackupSettings>("/system/backup-settings").then(setCfg);
    loadFiles();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    const updated = await api.put<BackupSettings>("/system/backup-settings", cfg);
    setCfg(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function runNow(email: boolean) {
    setRunBusy(true);
    setRunMsg(null);
    try {
      await api.post("/system/backups/run", { email });
      setRunMsg({ ok: true, text: email ? "Backup created and sent via email." : "Backup created." });
      loadFiles();
    } catch (err) {
      setRunMsg({ ok: false, text: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setRunBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>On-demand backup</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          The data automatically survives a container/service update (it lives in a separate volume/data
          folder, not in the image or the program folder). This downloads a full backup (sensors, thresholds,
          notifications, login) on the spot.
        </p>
        <button className="btn-primary" type="button" onClick={downloadNow} disabled={downloadBusy}>
          {downloadBusy ? "Preparing…" : "Download backup now"}
        </button>
        {downloadError && <div className="error">{downloadError}</div>}
      </div>

      {cfg && (
        <form className="card" onSubmit={save}>
          <h2>Scheduled automatic backup</h2>
          <p className="hint" style={{ marginTop: -4 }}>
            Creates periodic copies in the server's data folder. You can also have them sent via email (uses
            the SMTP configuration in Notifications).
          </p>
          <label className="checkbox-row">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
            Enable automatic backup
          </label>
          <div className="form-row">
            <label>
              Every how many hours
              <input
                type="number"
                min={1}
                max={720}
                value={cfg.intervalHours}
                onChange={(e) => setCfg({ ...cfg, intervalHours: Number(e.target.value) })}
              />
            </label>
            <label>
              How many to keep (oldest ones get deleted)
              <input
                type="number"
                min={1}
                max={365}
                value={cfg.retentionCount}
                onChange={(e) => setCfg({ ...cfg, retentionCount: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={cfg.emailOnBackup}
              onChange={(e) => setCfg({ ...cfg, emailOnBackup: e.target.checked })}
            />
            Also send every automatic backup via email
          </label>
          {cfg.emailOnBackup && (
            <p className="hint" style={{ marginTop: -4 }}>
              ⚠️ The backup file is <strong>not encrypted</strong>: it contains every sensor's API key, the
              admin password hash, and any SMTP/Telegram/Graph credentials configured in Notifications, in
              plain form. It's leaving this server for a third-party mailbox — usually the same one whose
              password is inside the file. Only enable this if you trust that mailbox and its own security
              as much as you trust this server.
            </p>
          )}
          {cfg.lastBackupAt && (
            <p className="hint">Last automatic backup: {new Date(cfg.lastBackupAt).toLocaleString("it-IT")}</p>
          )}
          <div className="row-actions">
            <button className="btn-primary" type="submit">
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => runNow(cfg.emailOnBackup)} disabled={runBusy}>
              {runBusy ? "Creating…" : "Backup now"}
            </button>
            {saved && <span className="success-text">✓ saved</span>}
            {runMsg && <span className={runMsg.ok ? "success-text" : "error"}>{runMsg.text}</span>}
          </div>
        </form>
      )}

      <div className="card">
        <h2>Saved backups</h2>
        {!files ? (
          <p className="muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="muted">No backups yet — enable the automatic one above or download a manual one.</p>
        ) : (
          <div className="stack-tight">
            {files.map((f) => (
              <div key={f.name} className="row-actions" style={{ justifyContent: "space-between" }}>
                <span className="mono small">{f.name}</span>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                  {formatSize(f.size)} — {new Date(f.createdAt).toLocaleString("it-IT")}
                </span>
                <a href={`/api/system/backups/${encodeURIComponent(f.name)}/download`} className="btn-link">
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
