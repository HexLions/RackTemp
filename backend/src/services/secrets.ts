import { timingSafeEqual } from "crypto";

// `a !== b` on secrets (API keys, integration tokens) leaks timing
// information proportional to how many leading bytes match — not
// exploitable over a noisy LAN in one shot, but it's a real class of bug
// and free to close. timingSafeEqual requires equal-length buffers, so a
// length mismatch is checked (and rejected) before the constant-time
// comparison; the length itself leaking is accepted, same tradeoff every
// standard timing-safe-compare helper makes.
export function secretEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
