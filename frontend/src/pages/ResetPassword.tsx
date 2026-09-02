import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword });
      setDone(true);
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
      <div className="card login-card">
        <div className="brand">
          <span className="logo-mark">
            <Logo size={20} />
          </span>
          Reset password
        </div>

        {done ? (
          <>
            <p className="subtitle">Password updated. You can log in now.</p>
            <Link to="/login" className="btn-primary" style={{ width: "100%", textAlign: "center" }}>
              Go to login
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="subtitle">
              Paste the code from the reset email below (it's prefilled if you opened this via the emailed
              link).
            </p>
            <label>
              Reset code
              <input value={token} onChange={(e) => setToken(e.target.value)} autoFocus required />
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
            <button className="btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}

        <Link to="/login" className="btn-link" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
          Back to login
        </Link>
      </div>
      <Footer />
    </div>
  );
}
