// ── Rate Limiter: Sliding-window token-bucket for RPM / TPM throttling ──

export interface RateLimitConfig {
  /** Maximum requests per minute. Default: unlimited */
  requestsPerMinute?: number;
  /** Maximum tokens per minute. Default: unlimited */
  tokensPerMinute?: number;
}

const WINDOW_MS = 60_000; // 60 seconds

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A sliding-window rate limiter that enforces RPM and TPM limits.
 *
 * - Tracks request timestamps and token counts within a 60-second window.
 * - `acquire()` blocks until the request can proceed without exceeding limits.
 * - `reportTokens()` records token usage after a request completes.
 * - Old entries are pruned automatically to prevent memory leaks.
 */
export class RateLimiter {
  private readonly rpm: number | undefined;
  private readonly tpm: number | undefined;

  /** Timestamps of requests within the sliding window */
  private requestTimestamps: number[] = [];

  /** Token entries: [timestamp, tokenCount] */
  private tokenEntries: Array<[number, number]> = [];

  constructor(config: RateLimitConfig) {
    this.rpm = config.requestsPerMinute;
    this.tpm = config.tokensPerMinute;
  }

  /**
   * Wait until a request is allowed under the configured rate limits.
   * Returns immediately if no limits are configured.
   */
  async acquire(): Promise<void> {
    // No-op if no limits configured
    if (this.rpm === undefined && this.tpm === undefined) {
      return;
    }

    while (true) {
      const now = Date.now();
      this.pruneOldEntries(now);

      const waitTime = this.computeWaitTime(now);
      if (waitTime <= 0) {
        // Record this request timestamp
        this.requestTimestamps.push(now);
        return;
      }

      await sleep(waitTime);
    }
  }

  /**
   * Report tokens used after a request completes (for TPM tracking).
   */
  reportTokens(count: number): void {
    if (count > 0 && this.tpm !== undefined) {
      this.tokenEntries.push([Date.now(), count]);
    }
  }

  /**
   * Reset all counters and timestamps.
   */
  reset(): void {
    this.requestTimestamps = [];
    this.tokenEntries = [];
  }

  /**
   * Remove entries older than the 60-second sliding window.
   */
  private pruneOldEntries(now: number): void {
    const cutoff = now - WINDOW_MS;

    // Prune request timestamps
    let rIdx = 0;
    while (rIdx < this.requestTimestamps.length && this.requestTimestamps[rIdx] <= cutoff) {
      rIdx++;
    }
    if (rIdx > 0) {
      this.requestTimestamps.splice(0, rIdx);
    }

    // Prune token entries
    let tIdx = 0;
    while (tIdx < this.tokenEntries.length && this.tokenEntries[tIdx][0] <= cutoff) {
      tIdx++;
    }
    if (tIdx > 0) {
      this.tokenEntries.splice(0, tIdx);
    }
  }

  /**
   * Compute how long to wait (in ms) before the next request can proceed.
   * Returns 0 if the request can proceed immediately.
   */
  private computeWaitTime(now: number): number {
    let maxWait = 0;

    // Check RPM limit
    if (this.rpm !== undefined && this.requestTimestamps.length >= this.rpm) {
      // The oldest request in the window determines when a slot opens
      const oldestTimestamp = this.requestTimestamps[0];
      const waitUntil = oldestTimestamp + WINDOW_MS;
      const rpmWait = waitUntil - now;
      if (rpmWait > maxWait) {
        maxWait = rpmWait;
      }
    }

    // Check TPM limit
    if (this.tpm !== undefined) {
      const currentTokens = this.tokenEntries.reduce((sum, entry) => sum + entry[1], 0);
      if (currentTokens >= this.tpm) {
        // Wait until the oldest token entry ages out
        const oldestTokenEntry = this.tokenEntries[0];
        const waitUntil = oldestTokenEntry[0] + WINDOW_MS;
        const tpmWait = waitUntil - now;
        if (tpmWait > maxWait) {
          maxWait = tpmWait;
        }
      }
    }

    return maxWait;
  }
}
