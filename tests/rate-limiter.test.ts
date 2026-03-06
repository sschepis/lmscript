import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ────────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts RPM-only config', () => {
      const limiter = new RateLimiter({ requestsPerMinute: 10 });
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('accepts TPM-only config', () => {
      const limiter = new RateLimiter({ tokensPerMinute: 1000 });
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('accepts both RPM and TPM config', () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        tokensPerMinute: 1000,
      });
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('accepts empty config (no limits)', () => {
      const limiter = new RateLimiter({});
      expect(limiter).toBeInstanceOf(RateLimiter);
    });
  });

  // ── acquire() ──────────────────────────────────────────────────────

  describe('acquire()', () => {
    it('resolves immediately when no limits are configured', async () => {
      const limiter = new RateLimiter({});
      // No limits → immediate return
      await limiter.acquire();
    });

    it('resolves immediately when under RPM limit', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 5 });
      // 3 requests against a limit of 5 — all should resolve instantly
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();
    });

    it('blocks when RPM limit is exceeded', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 2 });

      // Fill the RPM quota
      await limiter.acquire();
      await limiter.acquire();

      // Third acquire should block
      let thirdResolved = false;
      const thirdPromise = limiter.acquire().then(() => {
        thirdResolved = true;
      });

      // Small advance — still within the window
      await vi.advanceTimersByTimeAsync(1_000);
      expect(thirdResolved).toBe(false);

      // Advance past the 60-second sliding window
      await vi.advanceTimersByTimeAsync(60_000);
      expect(thirdResolved).toBe(true);
    });

    it('resolves immediately when under TPM limit', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(50);

      // Still under 100 TPM — should resolve instantly
      await limiter.acquire();
    });

    it('blocks when TPM limit is exceeded', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(100);

      // Next acquire should block because TPM is at the limit
      let resolved = false;
      limiter.acquire().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(resolved).toBe(false);

      // Advance past the 60-second window so the token entry falls out
      await vi.advanceTimersByTimeAsync(60_000);
      expect(resolved).toBe(true);
    });

    it('blocks when both RPM and TPM are set and RPM is exceeded', async () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 1,
        tokensPerMinute: 10_000,
      });

      await limiter.acquire();
      limiter.reportTokens(10);

      // RPM is exhausted even though TPM is fine
      let resolved = false;
      limiter.acquire().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(resolved).toBe(true);
    });
  });

  // ── reportTokens() ────────────────────────────────────────────────

  describe('reportTokens()', () => {
    it('tracks cumulative token usage for TPM enforcement', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(60);

      await limiter.acquire();
      limiter.reportTokens(40);

      // Now at 100 tokens — next acquire should block
      let resolved = false;
      limiter.acquire().then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(resolved).toBe(false);
    });

    it('ignores zero-token reports', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 10 });

      await limiter.acquire();
      limiter.reportTokens(0);

      // Zero was ignored — should still resolve
      await limiter.acquire();
    });

    it('ignores reports when TPM is not configured', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(999_999);

      // No TPM limit → reporting tokens has no effect
      await limiter.acquire();
    });
  });

  // ── Window sliding ────────────────────────────────────────────────

  describe('window sliding', () => {
    it('old requests fall out of the window, allowing new ones', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 2 });

      // Fill RPM at time T
      await limiter.acquire();
      await limiter.acquire();

      // Advance 30s — first two requests are still in the 60s window
      await vi.advanceTimersByTimeAsync(30_000);

      // Third acquire should block (the first two are only 30s old)
      let thirdResolved = false;
      limiter.acquire().then(() => {
        thirdResolved = true;
      });

      // Advance another 31s (total 61s from time T) — first two fall out
      await vi.advanceTimersByTimeAsync(31_000);
      expect(thirdResolved).toBe(true);
    });

    it('old token entries fall out of the window', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(100);

      // Advance past the 60s window so token entry ages out
      await vi.advanceTimersByTimeAsync(61_000);

      // Should succeed — old tokens no longer count
      await limiter.acquire();
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles very high RPM limits without blocking', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 1_000_000 });

      for (let i = 0; i < 100; i++) {
        await limiter.acquire();
      }
    });

    it('handles very high TPM limits without blocking', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 1_000_000 });

      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
        limiter.reportTokens(1_000);
      }
    });

    it('reset() clears all state allowing new requests', async () => {
      const limiter = new RateLimiter({ requestsPerMinute: 2 });

      // Fill up RPM
      await limiter.acquire();
      await limiter.acquire();

      // Reset — clears request timestamps and token entries
      limiter.reset();

      // Should be able to acquire again without waiting
      await limiter.acquire();
      await limiter.acquire();
    });

    it('reset() clears token state', async () => {
      const limiter = new RateLimiter({ tokensPerMinute: 100 });

      await limiter.acquire();
      limiter.reportTokens(100);

      limiter.reset();

      // After reset, token usage is cleared — acquire should succeed
      await limiter.acquire();
    });
  });
});
