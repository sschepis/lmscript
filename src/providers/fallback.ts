import type { LLMProvider, LLMRequest, LLMResponse } from "../types.js";
import {
  CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from "../circuit-breaker.js";

// ── Custom Error ────────────────────────────────────────────────────

/**
 * Error thrown when all providers in the fallback chain have failed.
 */
export class AllProvidersFailedError extends Error {
  readonly errors: Array<{ provider: string; error: Error }>;

  constructor(errors: Array<{ provider: string; error: Error }>) {
    const summary = errors
      .map((e) => `[${e.provider}]: ${e.error.message}`)
      .join("; ");
    super(`All providers failed: ${summary}`);
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

// ── Configuration ───────────────────────────────────────────────────

/**
 * Configuration for the {@link FallbackProvider}.
 */
export interface FallbackProviderConfig {
  /** Delay between provider attempts in ms */
  retryDelay?: number;

  /** Circuit breaker configuration. When enabled, failing providers are temporarily disabled. */
  circuitBreaker?: CircuitBreakerConfig;
}

// ── Fallback Provider ───────────────────────────────────────────────

/**
 * Tries each provider in order until one succeeds.
 *
 * If a provider throws (API error, rate limit, network failure),
 * the error is caught and the next provider is tried. If all fail,
 * an `AllProvidersFailedError` is thrown with all collected errors.
 *
 * When `circuitBreaker` config is provided, each provider is tracked
 * with an independent circuit breaker. Providers whose circuits are
 * open are skipped. If ALL circuits are open, the provider whose
 * circuit has been open the longest is tried as a safety fallback.
 */
export class FallbackProvider implements LLMProvider {
  readonly name = "fallback";

  private providers: LLMProvider[];
  private retryDelay?: number;
  private breakers: Map<string, CircuitBreaker> | null = null;

  constructor(
    providers: LLMProvider[],
    options?: FallbackProviderConfig | { retryDelay?: number }
  ) {
    if (providers.length === 0) {
      throw new Error("FallbackProvider requires at least one provider");
    }
    this.providers = [...providers];
    this.retryDelay = options?.retryDelay;

    // Only create circuit breakers when explicitly configured
    const cbConfig = (options as FallbackProviderConfig)?.circuitBreaker;
    if (cbConfig) {
      this.breakers = new Map();
      for (const p of this.providers) {
        this.breakers.set(p.name, new CircuitBreaker(cbConfig));
      }
    }
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const errors: Array<{ provider: string; error: Error }> = [];
    const skippedAll = this.breakers !== null;
    let anyAllowed = false;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const breaker = this.breakers?.get(provider.name);

      // Check circuit breaker if present
      if (breaker && !breaker.isAllowed()) {
        errors.push({
          provider: provider.name,
          error: new Error("Circuit breaker open"),
        });
        continue;
      }

      anyAllowed = true;

      try {
        const response = await provider.chat(request);
        breaker?.recordSuccess();
        return response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ provider: provider.name, error });
        breaker?.recordFailure();

        // Wait before trying next provider if retryDelay is configured
        if (this.retryDelay && i < this.providers.length - 1) {
          await this.delay(this.retryDelay);
        }
      }
    }

    // Safety fallback: if all circuits were open, try the one open longest
    if (skippedAll && !anyAllowed) {
      const fallbackProvider = this.findLongestOpenProvider();
      if (fallbackProvider) {
        try {
          const response = await fallbackProvider.chat(request);
          this.breakers!.get(fallbackProvider.name)?.recordSuccess();
          return response;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push({ provider: fallbackProvider.name, error });
          this.breakers!.get(fallbackProvider.name)?.recordFailure();
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const errors: Array<{ provider: string; error: Error }> = [];
    const skippedAll = this.breakers !== null;
    let anyAllowed = false;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const breaker = this.breakers?.get(provider.name);

      // Check circuit breaker if present
      if (breaker && !breaker.isAllowed()) {
        errors.push({
          provider: provider.name,
          error: new Error("Circuit breaker open"),
        });
        continue;
      }

      anyAllowed = true;

      // Skip providers that don't support chatStream
      if (!provider.chatStream) {
        errors.push({
          provider: provider.name,
          error: new Error("Provider does not support streaming"),
        });

        if (this.retryDelay && i < this.providers.length - 1) {
          await this.delay(this.retryDelay);
        }
        continue;
      }

      try {
        yield* provider.chatStream(request);
        breaker?.recordSuccess();
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ provider: provider.name, error });
        breaker?.recordFailure();

        if (this.retryDelay && i < this.providers.length - 1) {
          await this.delay(this.retryDelay);
        }
      }
    }

    // Safety fallback: if all circuits were open, try the one open longest
    if (skippedAll && !anyAllowed) {
      const fallbackProvider = this.findLongestOpenProvider();
      if (fallbackProvider) {
        if (!fallbackProvider.chatStream) {
          errors.push({
            provider: fallbackProvider.name,
            error: new Error("Provider does not support streaming"),
          });
        } else {
          try {
            yield* fallbackProvider.chatStream(request);
            this.breakers!.get(fallbackProvider.name)?.recordSuccess();
            return;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            errors.push({ provider: fallbackProvider.name, error });
            this.breakers!.get(fallbackProvider.name)?.recordFailure();
          }
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  /**
   * Returns the health status of each provider's circuit breaker.
   * If circuit breakers are not enabled, all providers report as "closed"
   * with zero failures.
   */
  getProviderHealth(): Array<{
    name: string;
    state: CircuitState;
    failureCount: number;
  }> {
    return this.providers.map((p) => {
      const breaker = this.breakers?.get(p.name);
      return {
        name: p.name,
        state: breaker?.getState() ?? ("closed" as CircuitState),
        failureCount: breaker?.getFailureCount() ?? 0,
      };
    });
  }

  /**
   * Find the provider whose circuit has been open the longest
   * (i.e. the one most likely to have recovered).
   */
  private findLongestOpenProvider(): LLMProvider | null {
    if (!this.breakers) return null;

    let oldest: LLMProvider | null = null;
    let oldestTime = Infinity;

    for (const provider of this.providers) {
      const breaker = this.breakers.get(provider.name);
      if (breaker) {
        const failureTime = breaker.getLastFailureTime();
        if (failureTime < oldestTime) {
          oldestTime = failureTime;
          oldest = provider;
        }
      }
    }

    return oldest;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
