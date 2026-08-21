import { useEffect, useState } from "react";

// Bridge esposto solo dalla finestra tray Windows (windows-tray/RackTempTray),
// via CoreWebView2.AddHostObjectToScript — non esiste in un browser normale
// né quando la pagina è aperta da remoto, quindi questa card si nasconde da
// sola ovunque tranne che dentro quella finestra specifica.
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
      <h2>Applicazione Windows</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        Il servizio RackTemp gira comunque in background indipendentemente da questa finestra. Questa opzione
        riguarda solo se la finestra/icona in tray si apre da sola all'accesso a Windows.
      </p>
      <label className="checkbox-row">
        <input type="checkbox" checked={autostart ?? false} disabled={autostart === null || busy} onChange={toggle} />
        Avvia RackTemp con Windows all'accesso
      </label>
    </div>
  );
}
