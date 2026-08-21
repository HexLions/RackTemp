import { FormEvent, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../api/AuthContext";
import { api } from "../api/client";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";

type Mode = "choice" | "fresh" | "restore" | "restore-done";

export default function FirstLogin() {
  const { username, mustChangePassword, completeFirstLogin } = useAuth();
  const [mode, setMode] = useState<Mode>("choice");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function onRestore(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Seleziona un file di backup (.sqlite)");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("backup", file);
      const res = await fetch("/api/auth/restore-backup", { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText);
      }
      setMode("restore-done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di rete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="theme-toggle-float">
        <ThemeToggle />
      </div>

      {mode === "choice" && (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Nuova installazione
          </div>
          <p className="subtitle">
            Stai usando le credenziali di default (<code>admin</code> / <code>admin</code>). Vuoi ripristinare
            sensori e impostazioni da un backup, o partire da zero?
          </p>
          <div className="row-actions" style={{ flexDirection: "column", gap: 10 }}>
            <button className="btn-primary" type="button" onClick={() => setMode("fresh")} style={{ width: "100%" }}>
              Configura da zero
            </button>
            <button className="btn-ghost" type="button" onClick={() => setMode("restore")} style={{ width: "100%" }}>
              Ripristina da un backup
            </button>
          </div>
        </div>
      )}

      {mode === "fresh" && (
        <form className="card login-card" onSubmit={onSubmit}>
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Primo accesso
          </div>
          <p className="subtitle">Scegli username e password definitivi per continuare.</p>
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
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Salvataggio…" : "Imposta credenziali"}
            </button>
            <button type="button" className="btn-link" onClick={() => setMode("choice")}>
              Indietro
            </button>
          </div>
        </form>
      )}

      {mode === "restore" && (
        <form className="card login-card" onSubmit={onRestore}>
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Ripristina da backup
          </div>
          <p className="subtitle">
            Carica un file <code>.sqlite</code> scaricato da Impostazioni → Backup di un'altra installazione
            RackTemp. Username e password saranno quelli del backup, non admin/admin.
          </p>
          <label>
            File di backup
            <input type="file" accept=".sqlite" ref={fileInput} required />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Ripristino…" : "Ripristina"}
            </button>
            <button type="button" className="btn-link" onClick={() => setMode("choice")}>
              Indietro
            </button>
          </div>
        </form>
      )}

      {mode === "restore-done" && (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Ripristino completato
          </div>
          <p className="subtitle">
            Il server si sta riavviando con i dati ripristinati. Ricarica la pagina tra qualche secondo e accedi
            con le credenziali del backup.
          </p>
          <button className="btn-primary" type="button" onClick={() => window.location.reload()} style={{ width: "100%" }}>
            Ricarica ora
          </button>
        </div>
      )}

      <Footer />
    </div>
  );
}
