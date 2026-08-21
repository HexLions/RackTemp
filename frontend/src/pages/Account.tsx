import { FormEvent, useState } from "react";
import { api, ApiError } from "../api/client";

export default function Account() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Le password non coincidono");
      return;
    }

    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di rete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-sub">Cambia la password di accesso.</p>
        </div>
      </div>

      <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <h2>Cambia password</h2>
        <label>
          Password attuale
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Nuova password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        <label>
          Conferma nuova password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Salvataggio…" : "Cambia password"}
          </button>
          {saved && <span className="success-text">✓ password aggiornata</span>}
        </div>
      </form>
    </div>
  );
}
