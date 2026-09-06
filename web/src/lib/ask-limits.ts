/**
 * Spend guard for `/api/ask-route` (D-75): a per-client token bucket plus a global in-flight cap, so an open endpoint
 * cannot run up the model bill. State is per process — on Vercel that is per warm function instance, so the effective
 * ceiling is `instances × RATE_PER_MINUTE`; a shared store (Upstash/KV) is a follow-up. Rejected calls never reach the
 * classifier; the browser falls back to its local matcher on 429, so a limited user still gets an answer.
 */

export const RATE_PER_MINUTE = 10;
export const MAX_IN_FLIGHT = 4;
const WINDOW_MS = 60_000;
const SWEEP_EVERY = 256;

type Bucket = { tokens: number; refilledAt: number };

export class AskLimiter {
  private buckets = new Map<string, Bucket>();
  private inFlight = 0;
  private calls = 0;

  constructor(
    private readonly perMinute = RATE_PER_MINUTE,
    private readonly maxInFlight = MAX_IN_FLIGHT,
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one token for `client`; false when the bucket is empty. */
  take(client: string): boolean {
    const t = this.now();
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(t);
    const b = this.buckets.get(client) ?? { tokens: this.perMinute, refilledAt: t };
    b.tokens = Math.min(this.perMinute, b.tokens + ((t - b.refilledAt) / WINDOW_MS) * this.perMinute);
    b.refilledAt = t;
    if (b.tokens < 1) {
      this.buckets.set(client, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(client, b);
    return true;
  }

  /** Reserve an in-flight slot; returns a release function, or null when the cap is reached. */
  acquire(): (() => void) | null {
    if (this.inFlight >= this.maxInFlight) return null;
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
    };
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.refilledAt > WINDOW_MS) this.buckets.delete(k);
  }
}

/**
 * Client id for the bucket. Forwarding headers are trusted only where the platform is known to overwrite them:
 * on Vercel (`VERCEL=1`), `x-vercel-forwarded-for` / `x-forwarded-for` are set from the connection and cannot be
 * supplied by the caller. Anywhere else (local dev, a self-hosted `next start` with no trusted proxy in front) a
 * caller could pick its own address per request, so every caller shares one bucket instead: the cap still bounds
 * spend, at the cost of one noisy client limiting the others.
 */
export function clientKey(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (!env.VERCEL) return "shared";
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "shared";
}

export const askLimiter = new AskLimiter();
