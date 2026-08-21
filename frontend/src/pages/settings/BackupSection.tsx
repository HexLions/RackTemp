export default function BackupSection() {
  return (
    <div className="card">
      <h2>Backup</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        I dati sopravvivono automaticamente a un aggiornamento del container/servizio (vivono in un volume/cartella
        dati separata, non nell'immagine o nella cartella del programma). Questo è solo un promemoria per un
        backup manuale prima di modifiche importanti.
      </p>
      <a href="/api/system/backup" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
        Scarica backup database
      </a>
    </div>
  );
}
