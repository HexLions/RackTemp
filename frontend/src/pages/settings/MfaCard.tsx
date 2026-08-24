import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";

export default function MfaCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/auth/mfa/status").then((r) => setEnabled(r.enabled));
  }, []);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ secret: string; qrDataUrl: string }>("/auth/mfa/setup");
      setSetup(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/mfa/enable", { code });
      setSetup(null);
      setCode("");
      setEnabled(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/mfa/disable", { currentPassword: disablePassword });
      setDisablePassword("");
      setEnabled(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h2>Two-factor authentication</h2>

      {enabled ? (
        <>
          <p className="hint">Enabled — a code from your authenticator app is required at login.</p>
          <form onSubmit={disable}>
            <label>
              Current password
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="btn-ghost" type="submit" disabled={busy}>
              {busy ? "Disabling…" : "Disable two-factor authentication"}
            </button>
          </form>
        </>
      ) : setup ? (
        <form onSubmit={confirmEnable}>
          <p className="hint">Scan this with your authenticator app (Google Authenticator, Authy, …):</p>
          <img src={setup.qrDataUrl} alt="TOTP QR code" width={180} height={180} style={{ imageRendering: "pixelated" }} />
          <p className="hint">Or enter this key manually: {setup.secret}</p>
          <label>
            Code from the app
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Confirming…" : "Confirm and enable"}
            </button>
            <button type="button" className="btn-link" onClick={() => setSetup(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="hint">
            Adds a 6-digit code from an authenticator app to every login, on top of your password.
          </p>
          {error && <div className="error">{error}</div>}
          <button className="btn-primary" type="button" onClick={startSetup} disabled={busy}>
            {busy ? "Starting…" : "Enable two-factor authentication"}
          </button>
        </>
      )}
    </div>
  );
}
