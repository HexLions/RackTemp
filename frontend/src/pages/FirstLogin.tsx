import { FormEvent, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../api/AuthContext";
import { api } from "../api/client";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";
import CopyField from "../components/CopyField";

type Mode = "choice" | "fresh" | "restore" | "restore-done" | "show-key";

export default function FirstLogin() {
  const { username, mustChangePassword, completeFirstLogin } = useAuth();
  const [mode, setMode] = useState<Mode>("choice");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!username) return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const res = await api.post<{ username: string; recoveryKey: string }>("/auth/first-login", {
        newUsername,
        newPassword,
      });
      setRecoveryKey(res.recoveryKey);
      setMode("show-key");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Select a backup file (.sqlite)");
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
      setError(err instanceof ApiError ? err.message : "Network error");
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
            New installation
          </div>
          <p className="subtitle">
            You're using the default credentials (<code>admin</code> / <code>admin</code>). Do you want to restore
            sensors and settings from a backup, or start from scratch?
          </p>
          <div className="row-actions" style={{ flexDirection: "column", gap: 10 }}>
            <button className="btn-primary" type="button" onClick={() => setMode("fresh")} style={{ width: "100%" }}>
              Set up from scratch
            </button>
            <button className="btn-ghost" type="button" onClick={() => setMode("restore")} style={{ width: "100%" }}>
              Restore from a backup
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
            First login
          </div>
          <p className="subtitle">Choose your final username and password to continue.</p>
          <label>
            New username
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoFocus required minLength={3} />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label>
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set credentials"}
            </button>
            <button type="button" className="btn-link" onClick={() => setMode("choice")}>
              Back
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
            Restore from backup
          </div>
          <p className="subtitle">
            Upload a <code>.sqlite</code> file downloaded from Settings → Backup on another RackTemp
            installation. Username and password will be those from the backup, not admin/admin.
          </p>
          <label>
            Backup file
            <input type="file" accept=".sqlite" ref={fileInput} required />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Restoring…" : "Restore"}
            </button>
            <button type="button" className="btn-link" onClick={() => setMode("choice")}>
              Back
            </button>
          </div>
        </form>
      )}

      {mode === "show-key" && recoveryKey && (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Save your recovery key
          </div>
          <p className="subtitle">
            This key resets your password if you ever get locked out, even with no email set up. It's shown
            <strong> only this once</strong> — save it somewhere safe now. You can generate a new one later
            from Settings → Account.
          </p>
          <CopyField label="Recovery key" value={recoveryKey} />
          <button
            className="btn-primary"
            type="button"
            onClick={() => completeFirstLogin(newUsername)}
            style={{ width: "100%" }}
          >
            I've saved it, continue
          </button>
        </div>
      )}

      {mode === "restore-done" && (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Restore complete
          </div>
          <p className="subtitle">
            The server is restarting with the restored data. Reload the page in a few seconds and log in
            with the backup's credentials.
          </p>
          <button className="btn-primary" type="button" onClick={() => window.location.reload()} style={{ width: "100%" }}>
            Reload now
          </button>
        </div>
      )}

      <Footer />
    </div>
  );
}
