import { sleep } from "./io.mjs";

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export class RequestPacer {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs ?? 3000;
    this.baseBackoffMs = options.baseBackoffMs ?? 60_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleep;
    this.nextRequestAt = 0;
    this.rateLimitCount = 0;
  }

  async wait() {
    const delayMs = Math.max(0, this.nextRequestAt - this.now());
    if (delayMs > 0) await this.sleep(delayMs);
    this.nextRequestAt = this.now() + this.intervalMs;
  }

  backoff(retryAfter = null) {
    this.rateLimitCount += 1;
    const exponentialDelay = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * (2 ** (this.rateLimitCount - 1))
    );
    const delayMs = Math.max(
      exponentialDelay,
      parseRetryAfter(retryAfter, this.now()) ?? 0
    );
    this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + delayMs);
    return delayMs;
  }

  succeeded() {
    this.rateLimitCount = 0;
  }
}
