import { FormEvent, useState } from "react";
import { api, ApiError } from "../../api/client";
import WindowsAppCard from "./WindowsAppCard";
import MfaCard from "./MfaCard";
import AuditLogCard from "./AuditLogCard";
import CopyField from "../../components/CopyField";

export default function AccountSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  async function regenerateRecoveryKey(e: FormEvent) {
    e.preventDefault();
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      const res = await api.post<{ recoveryKey: string }>("/auth/regenerate-recovery-key", {
        currentPassword: recoveryPassword,
      });
      setRecoveryKey(res.recoveryKey);
      setRecoveryPassword("");
    } catch (err) {
      setRecoveryError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("Passwords do not match");
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
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <WindowsAppCard />
      <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <h2>Change password</h2>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row-actions">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
          {saved && <span className="success-text">✓ password updated</span>}
        </div>
      </form>

      <MfaCard />

      <div className="card" style={{ maxWidth: 420 }}>
        <h2>Recovery key</h2>
        <p className="hint">
          Resets your password if you're ever locked out, without needing email. It was shown once at first
          login — if you didn't save it, generate a new one here (this invalidates the old one).
        </p>
        {recoveryKey ? (
          <CopyField label="New recovery key" value={recoveryKey} hint="Shown only now — save it somewhere safe." />
        ) : (
          <form onSubmit={regenerateRecoveryKey}>
            <label>
              Current password
              <input
                type="password"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                required
              />
            </label>
            {recoveryError && <div className="error">{recoveryError}</div>}
            <button className="btn-primary" type="submit" disabled={recoveryBusy}>
              {recoveryBusy ? "Generating…" : "Regenerate recovery key"}
            </button>
          </form>
        )}
      </div>

      <AuditLogCard />
    </>
  );
}
