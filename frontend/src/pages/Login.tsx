import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../api/AuthContext";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";

export default function Login() {
  const { username, login, viewerLogin, verifyMfa } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [asViewer, setAsViewer] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (username) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (asViewer) {
        await viewerLogin(user, pass);
      } else {
        const res = await login(user, pass);
        if (res.mfaRequired) setMfaStep(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function onMfaSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyMfa(mfaCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (mfaStep) {
    return (
      <div className="center-screen">
        <div className="theme-toggle-float">
          <ThemeToggle />
        </div>
        <form className="card login-card" onSubmit={onMfaSubmit}>
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Rack Temp Monitor
          </div>
          <p className="subtitle">Enter the 6-digit code from your authenticator app.</p>
          <label>
            Code
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              autoFocus
              required
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            className="btn-link"
            style={{ display: "block", textAlign: "center", marginTop: 12 }}
            onClick={() => {
              setMfaStep(false);
              setMfaCode("");
              setError(null);
            }}
          >
            Back
          </button>
        </form>
        <Footer />
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="theme-toggle-float">
        <ThemeToggle />
      </div>
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="logo-mark">
            <Logo size={20} />
          </span>
          Rack Temp Monitor
        </div>
        <p className="subtitle">
          {asViewer ? "Log in to view sensors and history — read-only." : "Log in to manage sensors and notifications."}
        </p>
        <label>
          Username
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <button
          type="button"
          className="btn-link"
          style={{ display: "block", textAlign: "center", marginTop: 12 }}
          onClick={() => {
            setAsViewer(!asViewer);
            setError(null);
          }}
        >
          {asViewer ? "Log in as admin instead" : "Log in as viewer (read-only)"}
        </button>
        {!asViewer && (
          <Link to="/forgot-password" className="btn-link" style={{ display: "block", textAlign: "center", marginTop: 14 }}>
            Forgot password?
          </Link>
        )}
      </form>
      <Footer />
    </div>
  );
}
