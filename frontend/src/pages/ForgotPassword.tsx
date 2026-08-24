import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";
import Footer from "../components/Footer";
import CopyField from "../components/CopyField";

type Tab = "email" | "key";

export default function ForgotPassword() {
  const [tab, setTab] = useState<Tab>("email");

  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);

  async function sendEmail() {
    setEmailError(null);
    setEmailBusy(true);
    try {
      await api.post("/auth/forgot-password");
      setEmailSent(true);
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setEmailBusy(false);
    }
  }

  async function onKeySubmit(e: FormEvent) {
    e.preventDefault();
    setKeyError(null);
    if (newPassword !== confirm) {
      setKeyError("Passwords do not match");
      return;
    }
    setKeyBusy(true);
    try {
      const res = await api.post<{ newRecoveryKey: string }>("/auth/reset-password-with-key", {
        recoveryKey: recoveryKey.trim(),
        newPassword,
      });
      setNewRecoveryKey(res.newRecoveryKey);
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setKeyBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="theme-toggle-float">
        <ThemeToggle />
      </div>

      {newRecoveryKey ? (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Password reset
          </div>
          <p className="subtitle">
            Your password was changed. The recovery key you used is now void — here's a new one, shown
            <strong> only this once</strong>. Save it somewhere safe.
          </p>
          <CopyField label="New recovery key" value={newRecoveryKey} />
          <Link to="/login" className="btn-primary" style={{ width: "100%", textAlign: "center" }}>
            Go to login
          </Link>
        </div>
      ) : (
        <div className="card login-card">
          <div className="brand">
            <span className="logo-mark">
              <Logo size={20} />
            </span>
            Reset password
          </div>
          <div className="row-actions" style={{ gap: 0 }}>
            <button
              type="button"
              className={tab === "email" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1 }}
              onClick={() => setTab("email")}
            >
              Email link
            </button>
            <button
              type="button"
              className={tab === "key" ? "btn-primary" : "btn-ghost"}
              style={{ flex: 1 }}
              onClick={() => setTab("key")}
            >
              Recovery key
            </button>
          </div>

          {tab === "email" &&
            (emailSent ? (
              <p className="subtitle">
                If email notifications are configured, a reset code was emailed to you — it expires in 30
                minutes. Enter it on the <Link to="/reset-password">reset password</Link> page.
              </p>
            ) : (
              <>
                <p className="subtitle">
                  Sends a reset link to the address configured in Settings → Notifications. Requires SMTP to
                  be set up already.
                </p>
                {emailError && <div className="error">{emailError}</div>}
                <button className="btn-primary" type="button" onClick={sendEmail} disabled={emailBusy} style={{ width: "100%" }}>
                  {emailBusy ? "Sending…" : "Send reset link"}
                </button>
              </>
            ))}

          {tab === "key" && (
            <form onSubmit={onKeySubmit}>
              <p className="subtitle">
                Use the recovery key you saved at first login (or from Settings → Account) to set a new
                password directly, no email needed.
              </p>
              <label>
                Recovery key
                <input
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  placeholder="XXXXX-XXXXX-XXXXX-…"
                  autoFocus
                  required
                />
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
              {keyError && <div className="error">{keyError}</div>}
              <button className="btn-primary" type="submit" disabled={keyBusy} style={{ width: "100%" }}>
                {keyBusy ? "Resetting…" : "Reset password"}
              </button>
            </form>
          )}

          <Link to="/login" className="btn-link" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
            Back to login
          </Link>
        </div>
      )}

      <Footer />
    </div>
  );
}
