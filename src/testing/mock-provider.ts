import type { LLMProvider, LLMRequest, LLMResponse } from "../types.js";

// ── Mock Provider Configuration ─────────────────────────────────────

export interface MockProviderConfig {
  /** Default response content for any request */
  defaultResponse?: string;
  /** Map of responses keyed by a matcher (function name or regex on prompt) */
  responses?: Map<string | RegExp, string>;
  /** If true, record all requests for later assertion */
  recordRequests?: boolean;
  /** Simulated latency in ms */
  latency?: number;
  /** Simulated failure rate (0-1). When triggered, throws an error */
  failureRate?: number;
}

// ── Mock Provider ───────────────────────────────────────────────────

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  private config: Required<
    Pick<MockProviderConfig, "defaultResponse" | "recordRequests">
  > &
    MockProviderConfig;
  private recordedRequests: LLMRequest[] = [];

  constructor(config: MockProviderConfig = {}) {
    this.config = {
      defaultResponse: config.defaultResponse ?? '{}',
      recordRequests: config.recordRequests ?? true,
      responses: config.responses,
      latency: config.latency,
      failureRate: config.failureRate,
    };
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Record the request if configured
    if (this.config.recordRequests) {
      this.recordedRequests.push(request);
    }

    // Simulate failure
    if (
      this.config.failureRate !== undefined &&
      this.config.failureRate > 0 &&
      Math.random() < this.config.failureRate
    ) {
      throw new Error("[MockProvider] Simulated failure");
    }

    // Simulate latency
    if (this.config.latency !== undefined && this.config.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latency));
    }

    // Find matching response
    const content = this.findMatchingResponse(request);

    return {
      content,
      usage: {
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: 20,
      },
    };
  }

  /**
   * Match request against the responses map.
   * Checks all message content against string and RegExp matchers.
   */
  private findMatchingResponse(request: LLMRequest): string {
    if (!this.config.responses) {
      return this.config.defaultResponse;
    }

    // Concatenate all message content for matching
    const fullContent = request.messages.map((m) => m.content).join("\n");

    for (const [matcher, response] of this.config.responses) {
      if (typeof matcher === "string") {
        if (fullContent.includes(matcher)) {
          return response;
        }
      } else if (matcher instanceof RegExp) {
        if (matcher.test(fullContent)) {
          return response;
        }
      }
    }

    return this.config.defaultResponse;
  }

  /** Get all recorded requests */
  getRecordedRequests(): LLMRequest[] {
    return [...this.recordedRequests];
  }

  /** Get the number of recorded requests */
  getRequestCount(): number {
    return this.recordedRequests.length;
  }

  /** Clear recorded requests */
  reset(): void {
    this.recordedRequests = [];
  }

  /** Assert a request matching the pattern was made */
  assertCalledWith(matcher: string | RegExp): void {
    const found = this.recordedRequests.some((req) => {
      const fullContent = req.messages.map((m) => m.content).join("\n");
      if (typeof matcher === "string") {
        return fullContent.includes(matcher);
      }
      return matcher.test(fullContent);
    });

    if (!found) {
      throw new Error(
        `[MockProvider] Expected a request matching ${String(matcher)}, but none was found. ` +
          `Recorded ${this.recordedRequests.length} request(s).`
      );
    }
  }

  /** Assert the exact number of calls made */
  assertCallCount(expected: number): void {
    if (this.recordedRequests.length !== expected) {
      throw new Error(
        `[MockProvider] Expected ${expected} call(s), but got ${this.recordedRequests.length}.`
      );
    }
  }
}

// ── Factory Function ────────────────────────────────────────────────

/**
 * Convenience factory for creating a MockProvider.
 */
export function createMockProvider(
  config?: MockProviderConfig
): MockProvider {
  return new MockProvider(config);
}
