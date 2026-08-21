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
      setRunMsg({ ok: true, text: email ? "Backup creato e inviato via email." : "Backup creato." });
      loadFiles();
    } catch (err) {
      setRunMsg({ ok: false, text: err instanceof ApiError ? err.message : "Errore di rete" });
    } finally {
      setRunBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Backup su richiesta</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          I dati sopravvivono automaticamente a un aggiornamento del container/servizio (vivono in un volume/cartella
          dati separata, non nell'immagine o nella cartella del programma). Questo scarica un backup completo
          (sensori, soglie, notifiche, login) al volo.
        </p>
        <a href="/api/system/backup" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Scarica backup ora
        </a>
      </div>

      {cfg && (
        <form className="card" onSubmit={save}>
          <h2>Backup automatico programmato</h2>
          <p className="hint" style={{ marginTop: -4 }}>
            Crea copie periodiche nella cartella dati del server. Puoi anche farle inviare via email (usa la
            configurazione SMTP in Notifiche).
          </p>
          <label className="checkbox-row">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
            Attiva backup automatico
          </label>
          <div className="form-row">
            <label>
              Ogni quante ore
              <input
                type="number"
                min={1}
                max={720}
                value={cfg.intervalHours}
                onChange={(e) => setCfg({ ...cfg, intervalHours: Number(e.target.value) })}
              />
            </label>
            <label>
              Quanti tenerne (i più vecchi vengono cancellati)
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
            Invia ogni backup automatico anche via email
          </label>
          {cfg.lastBackupAt && (
            <p className="hint">Ultimo backup automatico: {new Date(cfg.lastBackupAt).toLocaleString("it-IT")}</p>
          )}
          <div className="row-actions">
            <button className="btn-primary" type="submit">
              Salva
            </button>
            <button type="button" className="btn-ghost" onClick={() => runNow(cfg.emailOnBackup)} disabled={runBusy}>
              {runBusy ? "Creo…" : "Backup ora"}
            </button>
            {saved && <span className="success-text">✓ salvato</span>}
            {runMsg && <span className={runMsg.ok ? "success-text" : "error"}>{runMsg.text}</span>}
          </div>
        </form>
      )}

      <div className="card">
        <h2>Backup salvati</h2>
        {!files ? (
          <p className="muted">Caricamento…</p>
        ) : files.length === 0 ? (
          <p className="muted">Nessun backup ancora — attiva quello automatico sopra o scaricane uno manuale.</p>
        ) : (
          <div className="stack-tight">
            {files.map((f) => (
              <div key={f.name} className="row-actions" style={{ justifyContent: "space-between" }}>
                <span className="mono small">{f.name}</span>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                  {formatSize(f.size)} — {new Date(f.createdAt).toLocaleString("it-IT")}
                </span>
                <a href={`/api/system/backups/${encodeURIComponent(f.name)}/download`} className="btn-link">
                  Scarica
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
