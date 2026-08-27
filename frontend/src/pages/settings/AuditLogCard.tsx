import { useEffect, useState } from "react";
import { api, AuditLogEntry } from "../../api/client";

const ACTION_LABEL: Record<string, string> = {
  login: "Login",
  login_failed: "Login failed",
  mfa_login: "Login (2FA)",
  mfa_login_failed: "2FA code rejected",
  logout: "Logout",
  first_login_completed: "First-time setup completed",
  password_change: "Password changed",
  password_reset_email: "Password reset (email link)",
  password_reset_email_failed: "Password reset link rejected",
  password_reset_recovery_key: "Password reset (recovery key)",
  password_reset_recovery_key_failed: "Recovery key rejected",
  mfa_enabled: "Two-factor authentication enabled",
  mfa_disabled: "Two-factor authentication disabled",
  sensor_deleted: "Sensor deleted",
  sensor_key_regenerated: "Sensor API key regenerated",
};

export default function AuditLogCard() {
  const [log, setLog] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    api.get<AuditLogEntry[]>("/system/audit-log?limit=100").then(setLog);
  }, []);

  return (
    <div className="card">
      <h2>Security log</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Login attempts and credential/config changes — kept for a year by default
        (<code>AUDIT_LOG_RETENTION_DAYS</code>), useful to check after the fact if a session was ever stolen
        or something changed you didn't expect.
      </p>
      {!log ? (
        <p className="muted">Loading…</p>
      ) : log.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <div className="stack-tight">
          {log.map((entry) => (
            <div key={entry.id} className="row-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span className={entry.action.endsWith("_failed") ? "error" : ""}>
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </span>
                {entry.detail && <div className="muted small">{entry.detail}</div>}
                {entry.ip && <div className="muted small mono">{entry.ip}</div>}
              </div>
              <span className="muted small mono" style={{ whiteSpace: "nowrap" }}>
                {new Date(entry.createdAt).toLocaleString("it-IT")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
