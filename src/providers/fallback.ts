import type { LLMProvider, LLMRequest, LLMResponse } from "../types.js";

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

// ── Fallback Provider ───────────────────────────────────────────────

/**
 * Tries each provider in order until one succeeds.
 *
 * If a provider throws (API error, rate limit, network failure),
 * the error is caught and the next provider is tried. If all fail,
 * an `AllProvidersFailedError` is thrown with all collected errors.
 */
export class FallbackProvider implements LLMProvider {
  readonly name = "fallback";

  private providers: LLMProvider[];
  private retryDelay?: number;

  constructor(
    providers: LLMProvider[],
    options?: { retryDelay?: number }
  ) {
    if (providers.length === 0) {
      throw new Error("FallbackProvider requires at least one provider");
    }
    this.providers = [...providers];
    this.retryDelay = options?.retryDelay;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const errors: Array<{ provider: string; error: Error }> = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];

      try {
        const response = await provider.chat(request);
        return response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ provider: provider.name, error });

        // Wait before trying next provider if retryDelay is configured
        if (this.retryDelay && i < this.providers.length - 1) {
          await this.delay(this.retryDelay);
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const errors: Array<{ provider: string; error: Error }> = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];

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
        return;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ provider: provider.name, error });

        if (this.retryDelay && i < this.providers.length - 1) {
          await this.delay(this.retryDelay);
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
