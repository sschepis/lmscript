// ── Circuit Breaker ─────────────────────────────────────────────────

/**
 * Possible states of the circuit breaker.
 *
 * - **closed** – Normal operation; requests flow through.
 * - **open** – Circuit has tripped; requests are blocked.
 * - **half-open** – Testing recovery; limited requests are allowed.
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Configuration for the {@link CircuitBreaker}.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;

  /** Time in ms to wait before transitioning from open to half-open. Default: 30000 (30s) */
  resetTimeout?: number;

  /** Number of successful requests in half-open state to close the circuit. Default: 2 */
  successThreshold?: number;
}

const DEFAULTS: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  resetTimeout: 30_000,
  successThreshold: 2,
};

/**
 * Standalone circuit breaker implementation.
 *
 * Tracks consecutive failures and temporarily disables a resource when
 * the failure threshold is reached, then gradually re-enables it after
 * a cooldown period.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private config: Required<CircuitBreakerConfig>;

  constructor(config?: CircuitBreakerConfig) {
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Check if a request is allowed through the circuit.
   *
   * - **Closed**: always returns `true`.
   * - **Open**: returns `false` unless `resetTimeout` has elapsed,
   *   in which case it transitions to half-open and returns `true`.
   * - **Half-open**: always returns `true` (testing recovery).
   */
  isAllowed(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        this.state = "half-open";
        this.successCount = 0;
        return true;
      }
      return false;
    }

    // half-open
    return true;
  }

  /** Record a successful request. */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = "closed";
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === "closed") {
      // Reset failure streak on success
      this.failureCount = 0;
    }
  }

  /** Record a failed request. */
  recordFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Any failure in half-open goes straight back to open
      this.state = "open";
      this.successCount = 0;
      return;
    }

    // closed state
    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  /** Get the current circuit state. */
  getState(): CircuitState {
    // Re-evaluate open → half-open transition on read
    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        this.state = "half-open";
        this.successCount = 0;
      }
    }
    return this.state;
  }

  /** Get the current failure count. */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Get the timestamp of the last recorded failure. */
  getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  /** Manually reset the circuit breaker to closed state. */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}
