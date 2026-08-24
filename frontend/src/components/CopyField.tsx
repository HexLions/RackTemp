import { useRef, useState } from "react";

export default function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    // navigator.clipboard needs a secure context (HTTPS or localhost) — this
    // app is usually reached over plain http:// on the LAN, where it's
    // undefined and the old code just threw silently. Fall back to the
    // legacy select+execCommand approach, which works over plain HTTP.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
        document.execCommand("copy");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <label>
      <span className="label-text">{label}</span>
      <div className="field-with-action">
        <input ref={inputRef} readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
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
