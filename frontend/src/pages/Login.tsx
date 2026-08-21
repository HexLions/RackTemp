import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../api/AuthContext";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";

export default function Login() {
  const { username, login } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (username) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(user, pass);
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
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="logo-mark">
            <Logo size={20} />
          </span>
          Rack Temp Monitor
        </div>
        <p className="subtitle">Accedi per gestire sensori e notifiche.</p>
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
          {busy ? "Accesso…" : "Accedi"}
        </button>
      </form>
      <Footer />
    </div>
  );
}
