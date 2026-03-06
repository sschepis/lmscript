import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker';
import type { CircuitState } from '../src/circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial State ──────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('closed');
    });

    it('has zero failure count initially', () => {
      const cb = new CircuitBreaker();
      expect(cb.getFailureCount()).toBe(0);
    });

    it('has zero last failure time initially', () => {
      const cb = new CircuitBreaker();
      expect(cb.getLastFailureTime()).toBe(0);
    });

    it('allows requests when newly created', () => {
      const cb = new CircuitBreaker();
      expect(cb.isAllowed()).toBe(true);
    });
  });

  // ── CLOSED State ───────────────────────────────────────────────────

  describe('CLOSED state', () => {
    it('allows all requests through', () => {
      const cb = new CircuitBreaker();
      expect(cb.isAllowed()).toBe(true);
      expect(cb.isAllowed()).toBe(true);
      expect(cb.isAllowed()).toBe(true);
    });

    it('stays closed after recording successes', () => {
      const cb = new CircuitBreaker();
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('resets failure count on success', () => {
      const cb = new CircuitBreaker();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getFailureCount()).toBe(2);
      cb.recordSuccess();
      expect(cb.getFailureCount()).toBe(0);
    });

    it('stays closed when failures are below threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      expect(cb.getFailureCount()).toBe(4);
    });
  });

  // ── CLOSED → OPEN Transition ───────────────────────────────────────

  describe('CLOSED → OPEN transition', () => {
    it('opens after failureThreshold consecutive failures (default: 5)', () => {
      const cb = new CircuitBreaker();
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      expect(cb.getState()).toBe('open');
    });

    it('opens after failureThreshold = 1', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('opens after failureThreshold = 3', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('opens after failureThreshold = 10', () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });
      for (let i = 0; i < 9; i++) {
        cb.recordFailure();
      }
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('records the last failure time when opening', () => {
      vi.setSystemTime(new Date(1000));
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getLastFailureTime()).toBe(1000);
    });
  });

  // ── OPEN State ─────────────────────────────────────────────────────

  describe('OPEN state', () => {
    it('rejects requests (isAllowed returns false)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      expect(cb.isAllowed()).toBe(false);
    });

    it('stays open before resetTimeout elapses', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });
      cb.recordFailure();
      vi.advanceTimersByTime(999);
      expect(cb.getState()).toBe('open');
      expect(cb.isAllowed()).toBe(false);
    });
  });

  // ── OPEN → HALF_OPEN Transition ────────────────────────────────────

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to half-open after resetTimeout via getState()', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');
    });

    it('transitions to half-open after resetTimeout via isAllowed()', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      expect(cb.isAllowed()).toBe(false);

      vi.advanceTimersByTime(100);
      expect(cb.isAllowed()).toBe(true);
      expect(cb.getState()).toBe('half-open');
    });

    it('uses custom resetTimeout (short)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });
      cb.recordFailure();
      vi.advanceTimersByTime(49);
      expect(cb.getState()).toBe('open');
      vi.advanceTimersByTime(1);
      expect(cb.getState()).toBe('half-open');
    });

    it('uses custom resetTimeout (long)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 60_000 });
      cb.recordFailure();
      vi.advanceTimersByTime(59_999);
      expect(cb.getState()).toBe('open');
      vi.advanceTimersByTime(1);
      expect(cb.getState()).toBe('half-open');
    });
  });

  // ── HALF_OPEN → CLOSED Transition ──────────────────────────────────

  describe('HALF_OPEN → CLOSED transition', () => {
    function makeHalfOpen(cb: CircuitBreaker, threshold: number, timeout: number) {
      for (let i = 0; i < threshold; i++) {
        cb.recordFailure();
      }
      vi.advanceTimersByTime(timeout);
      // Trigger transition check
      cb.getState();
    }

    it('closes after successThreshold successes in half-open (default: 2)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      makeHalfOpen(cb, 1, 100);
      expect(cb.getState()).toBe('half-open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('half-open'); // Need 2 successes by default
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('closes after custom successThreshold = 1', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        successThreshold: 1,
      });
      makeHalfOpen(cb, 1, 100);
      expect(cb.getState()).toBe('half-open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('resets failure count after transitioning to closed', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        successThreshold: 1,
      });
      makeHalfOpen(cb, 1, 100);
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
      expect(cb.getFailureCount()).toBe(0);
    });

    it('allows requests again after transitioning to closed', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        successThreshold: 1,
      });
      makeHalfOpen(cb, 1, 100);
      cb.recordSuccess();
      expect(cb.isAllowed()).toBe(true);
    });
  });

  // ── HALF_OPEN → OPEN Transition ────────────────────────────────────

  describe('HALF_OPEN → OPEN transition', () => {
    it('returns to open on any failure in half-open state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');

      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('rejects requests after returning to open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      cb.isAllowed(); // trigger half-open

      cb.recordFailure();
      expect(cb.isAllowed()).toBe(false);
    });

    it('failure after partial successes in half-open returns to open', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 100,
        successThreshold: 3,
      });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      cb.getState(); // trigger half-open

      cb.recordSuccess();
      cb.recordSuccess();
      // One success short of closing
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });
  });

  // ── getState() ─────────────────────────────────────────────────────

  describe('getState()', () => {
    it('returns "closed" for a new circuit breaker', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('closed');
    });

    it('returns "open" after reaching failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('returns "half-open" after resetTimeout elapses from open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');
    });

    it('re-evaluates open → half-open transition on each read', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      // Before timeout
      expect(cb.getState()).toBe('open');
      // After timeout
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');
    });
  });

  // ── getFailureCount() ──────────────────────────────────────────────

  describe('getFailureCount()', () => {
    it('increments on each failure in closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });
      cb.recordFailure();
      expect(cb.getFailureCount()).toBe(1);
      cb.recordFailure();
      expect(cb.getFailureCount()).toBe(2);
      cb.recordFailure();
      expect(cb.getFailureCount()).toBe(3);
    });

    it('is reset to zero by recordSuccess in closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.getFailureCount()).toBe(0);
    });
  });

  // ── reset() ────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('resets state to closed from open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('resets state to closed from half-open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');

      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('clears failure count', () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getFailureCount()).toBe(3);

      cb.reset();
      expect(cb.getFailureCount()).toBe(0);
    });

    it('clears last failure time', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getLastFailureTime()).toBeGreaterThan(0);

      cb.reset();
      expect(cb.getLastFailureTime()).toBe(0);
    });

    it('allows requests again after reset from open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.isAllowed()).toBe(false);

      cb.reset();
      expect(cb.isAllowed()).toBe(true);
    });

    it('requires full failure threshold again after reset', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      // Trip the breaker
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      // Reset
      cb.reset();

      // Should need 3 more failures to open again
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });
  });

  // ── Mixed Success/Failure ──────────────────────────────────────────

  describe('mixed success/failure (non-consecutive failures)', () => {
    it('does not trip when successes interrupt failure streak', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess(); // resets failure count
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess(); // resets again
      expect(cb.getState()).toBe('closed');
    });

    it('single success between failures prevents tripping', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess(); // Reset failure streak
      cb.recordFailure(); // Only 1 consecutive failure now
      expect(cb.getState()).toBe('closed');
      expect(cb.getFailureCount()).toBe(1);
    });

    it('trips when consecutive failures follow mixed pattern', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure();
      cb.recordSuccess();
      // Now 3 consecutive failures
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });
  });

  // ── Custom Config ──────────────────────────────────────────────────

  describe('custom config', () => {
    it('uses default failureThreshold of 5', () => {
      const cb = new CircuitBreaker();
      for (let i = 0; i < 4; i++) {
        cb.recordFailure();
      }
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('uses default resetTimeout of 30000', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      vi.advanceTimersByTime(29_999);
      expect(cb.getState()).toBe('open');
      vi.advanceTimersByTime(1);
      expect(cb.getState()).toBe('half-open');
    });

    it('uses default successThreshold of 2', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
      cb.recordFailure();
      vi.advanceTimersByTime(100);
      cb.getState(); // trigger half-open

      cb.recordSuccess();
      expect(cb.getState()).toBe('half-open');
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('allows partial config overrides', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      // failureThreshold overridden, but resetTimeout and successThreshold are defaults
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      // Default resetTimeout = 30000
      vi.advanceTimersByTime(30_000);
      expect(cb.getState()).toBe('half-open');

      // Default successThreshold = 2
      cb.recordSuccess();
      expect(cb.getState()).toBe('half-open');
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });
  });

  // ── Full Lifecycle ─────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('completes closed → open → half-open → closed cycle', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 200,
        successThreshold: 1,
      });

      // Start closed
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);

      // Failures trip to open
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      expect(cb.isAllowed()).toBe(false);

      // Wait for timeout → half-open
      vi.advanceTimersByTime(200);
      expect(cb.getState()).toBe('half-open');
      expect(cb.isAllowed()).toBe(true);

      // Success in half-open → closed
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);
      expect(cb.getFailureCount()).toBe(0);
    });

    it('completes closed → open → half-open → open → half-open → closed cycle', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100,
        successThreshold: 1,
      });

      // Trip to open
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      // Half-open
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');

      // Fail in half-open → back to open
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      // Half-open again
      vi.advanceTimersByTime(100);
      expect(cb.getState()).toBe('half-open');

      // Succeed → closed
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });
  });
});
