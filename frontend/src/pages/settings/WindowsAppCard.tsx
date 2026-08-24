import { useEffect, useState } from "react";

// Bridge exposed only by the Windows tray window (windows-tray/RackTempTray),
// via CoreWebView2.AddHostObjectToScript — it doesn't exist in a normal browser
// nor when the page is opened remotely, so this card hides itself everywhere
// except inside that specific window.
interface RackTempHost {
  GetAutostart(): Promise<boolean>;
  SetAutostart(enable: boolean): Promise<void>;
}

function getHost(): RackTempHost | null {
  const w = window as unknown as { chrome?: { webview?: { hostObjects?: { racktempHost?: RackTempHost } } } };
  return w.chrome?.webview?.hostObjects?.racktempHost ?? null;
}

export default function WindowsAppCard() {
  const [host] = useState(getHost);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    host?.GetAutostart().then(setAutostart);
  }, [host]);

  if (!host) return null;

  async function toggle() {
    if (autostart === null) return;
    setBusy(true);
    try {
      await host!.SetAutostart(!autostart);
      setAutostart(!autostart);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Windows application</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        The RackTemp service keeps running in the background regardless of this window. This option only
        affects whether the window/tray icon opens on its own when you log into Windows.
      </p>
      <label className="checkbox-row">
        <input type="checkbox" checked={autostart ?? false} disabled={autostart === null || busy} onChange={toggle} />
        Start RackTemp with Windows at login
      </label>
    </div>
  );
}
