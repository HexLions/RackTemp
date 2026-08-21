import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, FirmwareRelease } from "../../api/client";

export default function FirmwareSection() {
  const [firmware, setFirmware] = useState<FirmwareRelease | null>(null);
  const [fwVersion, setFwVersion] = useState("");
  const [fwNotes, setFwNotes] = useState("");
  const [fwBusy, setFwBusy] = useState(false);
  const [fwMsg, setFwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<FirmwareRelease>("/firmware/latest").then(setFirmware).catch(() => setFirmware(null));
  }, []);

  async function uploadFirmware(e: FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || !fwVersion.trim()) {
      setFwMsg({ ok: false, text: "Versione e file .bin sono obbligatori." });
      return;
    }

    setFwBusy(true);
    setFwMsg(null);
    try {
      const form = new FormData();
      form.append("version", fwVersion.trim());
      form.append("notes", fwNotes.trim());
      form.append("firmware", file);
      const res = await fetch("/api/firmware", { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? res.statusText);
      }
      const release = await res.json();
      setFirmware(release);
      setFwVersion("");
      setFwNotes("");
      if (fileInput.current) fileInput.current.value = "";
      setFwMsg({ ok: true, text: "Firmware caricato." });
    } catch (err) {
      setFwMsg({ ok: false, text: err instanceof ApiError ? err.message : "Errore di rete" });
    } finally {
      setFwBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={uploadFirmware}>
      <h2>Aggiornamento firmware sensori</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        Carica qui il <code>.bin</code> compilato: i sensori già collegati lo scaricano da soli entro 24h
        (o al prossimo riavvio) via OTA, senza bisogno di ricollegarli via USB. La configurazione salvata sul
        dispositivo (WiFi, server, API key) non viene toccata dall'aggiornamento.
      </p>
      {firmware && (
        <p className="hint">
          Versione attuale disponibile: <code>{firmware.version}</code>
          {firmware.notes && <> — {firmware.notes}</>}
        </p>
      )}
      <div className="form-row">
        <label>
          Versione
          <input value={fwVersion} onChange={(e) => setFwVersion(e.target.value)} placeholder="2026-08-22.1" required />
        </label>
        <label>
          Note (opzionale)
          <input value={fwNotes} onChange={(e) => setFwNotes(e.target.value)} placeholder="Fix reconnect WiFi" />
        </label>
      </div>
      <label>
        File firmware (.bin)
        <input type="file" accept=".bin" ref={fileInput} required />
      </label>
      <div className="row-actions">
        <button className="btn-primary" type="submit" disabled={fwBusy}>
          {fwBusy ? "Carico…" : "Carica firmware"}
        </button>
        {fwMsg && <span className={fwMsg.ok ? "success-text" : "error"}>{fwMsg.text}</span>}
      </div>
    </form>
  );
}
