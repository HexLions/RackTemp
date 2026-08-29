import crypto from "crypto";

// HIBP's "Pwned Passwords" range API (https://haveibeenpwned.com/API/v3#PwnedPasswords),
// k-anonymity model: only the first 5 hex chars of the password's SHA1 hash
// ever leave this server. HIBP returns every known suffix (+ breach count)
// sharing that prefix, and the actual match is done locally against the
// full hash — the password itself, or its full hash, never crosses the
// network.
const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const res = await fetch(HIBP_RANGE_URL + prefix, {
    // Ask HIBP to pad the response with decoy suffixes - defends the (very
    // marginal) traffic-analysis angle where a passive observer on this
    // server's own outbound link could otherwise guess the response size
    // correlates with how common the prefix is. Documented HIBP behavior,
    // no downside to always sending it.
    headers: { "Add-Padding": "true" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HIBP range lookup failed: HTTP ${res.status}`);

  const body = await res.text();
  return body.split("\n").some((line) => line.trim().toUpperCase().startsWith(suffix));
}

// Opt-in only (HIBP_PASSWORD_CHECK=1 in .env) - this app is otherwise fully
// self-hosted with no required outbound internet access, so silently
// calling a third-party API on every password change would be a real
// behavior change for an install that's air-gapped or just doesn't want
// that traffic leaving the network. Default stays off; the .env.example
// comment explains the tradeoff so it's an informed opt-in, not a hidden
// default.
//
// Fails open on any network/API error: this is defense-in-depth on top of
// the length check already enforced by each route's zod schema, not the
// only thing standing between a weak password and the account - a
// third-party outage or a firewalled install should never be able to lock
// an admin out of setting a password. Logged as a warning either way so
// it's visible it didn't run, not silently skipped.
export async function checkPasswordNotPwned(password: string): Promise<{ pwned: boolean; checked: boolean }> {
  if (process.env.HIBP_PASSWORD_CHECK !== "1") return { pwned: false, checked: false };
  try {
    const pwned = await isPasswordPwned(password);
    return { pwned, checked: true };
  } catch (err) {
    console.warn("[hibp] password breach check failed, allowing the password unchecked:", err);
    return { pwned: false, checked: false };
  }
}
