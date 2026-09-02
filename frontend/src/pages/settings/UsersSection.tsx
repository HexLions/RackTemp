import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, ViewerUser } from "../../api/client";

export default function UsersSection() {
  const [viewers, setViewers] = useState<ViewerUser[] | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<ViewerUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<ViewerUser[]>("/auth/viewers").then(setViewers);
  }

  useEffect(load, []);

  async function createViewer(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api.post("/auth/viewers", { username: newUsername, password: newPassword });
      setNewUsername("");
      setNewPassword("");
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setCreating(false);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setBusy(true);
    try {
      await api.post(`/auth/viewers/${resetTarget.id}/reset-password`, { password: resetPassword });
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(viewer: ViewerUser) {
    if (!confirm(`Delete viewer account "${viewer.username}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/auth/viewers/${viewer.id}`);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!viewers) return <div className="center-screen">Loading…</div>;

  return (
    <>
      <div className="card">
        <h2>Viewer accounts</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          Read-only logins — see the dashboard and sensor history, nothing else (no settings, no
          editing thresholds, no sensor management, no notification/integration config). Log in
          from the login page's "Log in as viewer" link. You set the password directly here; there's
          no forced change on first login and no self-service reset — if a viewer forgets their
          password, reset it below.
        </p>

        {viewers.length === 0 ? (
          <p className="muted">No viewer accounts yet.</p>
        ) : (
          <div className="stack-tight">
            {viewers.map((v) => (
              <div key={v.id} className="row-actions" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{v.username}</strong>
                  <div className="muted small">created {new Date(v.createdAt).toLocaleString("it-IT")}</div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setResetTarget(v);
                      setResetPassword("");
                      setResetError(null);
                    }}
                  >
                    Reset password
                  </button>
                  <button type="button" className="btn-link" disabled={busy} onClick={() => remove(v)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {resetTarget && (
        <form className="card" onSubmit={submitReset}>
          <h2>Reset password — {resetTarget.username}</h2>
          <p className="hint" style={{ marginTop: -4 }}>
            Sets a new password directly and signs this viewer out of any device they're currently
            logged in on.
          </p>
          <label>
            New password
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </label>
          {resetError && <div className="error">{resetError}</div>}
          <div className="row-actions">
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </button>
            <button type="button" className="btn-link" onClick={() => setResetTarget(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form className="card" onSubmit={createViewer}>
        <h2>Add viewer account</h2>
        <div className="form-row">
          <label>
            Username
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} minLength={3} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
        </div>
        {createError && <div className="error">{createError}</div>}
        <button className="btn-primary" type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create viewer account"}
        </button>
      </form>
    </>
  );
}
