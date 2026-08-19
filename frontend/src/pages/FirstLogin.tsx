import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../api/AuthContext";
import { api } from "../api/client";
import Logo from "../components/Logo";

export default function FirstLogin() {
  const { username, mustChangePassword, completeFirstLogin } = useAuth();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!username) return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Le password non coincidono");
      return;
    }

    setBusy(true);
    try {
      const res = await api.post<{ username: string }>("/auth/first-login", { newUsername, newPassword });
      completeFirstLogin(res.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di rete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="logo-mark">
            <Logo size={20} />
          </span>
          Primo accesso
        </div>
        <p className="subtitle">
          Stai usando le credenziali di default (<code>admin</code> / <code>admin</code>). Scegli username e
          password definitivi per continuare.
        </p>
        <label>
          Nuovo username
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoFocus required minLength={3} />
        </label>
        <label>
          Nuova password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          Conferma password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Salvataggio…" : "Imposta credenziali"}
        </button>
      </form>
    </div>
  );
}
