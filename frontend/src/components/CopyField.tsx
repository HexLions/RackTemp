import { useState } from "react";

export default function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <label>
      <span className="label-text">{label}</span>
      <div className="field-with-action">
        <input readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? "Copiato" : "Copia"}
        </button>
      </div>
      {hint && (
        <span className="hint" style={{ margin: "2px 0 0" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
