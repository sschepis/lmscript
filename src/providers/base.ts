import type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse } from "../types.js";

/**
 * Abstract base class for LLM providers.
 * Handles common concerns (auth headers, error formatting) so concrete
 * providers only need to implement `buildRequestBody` and `parseResponse`.
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;

  protected apiKey: string;
  protected baseUrl: string;

  constructor(config: LLMProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? this.defaultBaseUrl();
  }

  protected abstract defaultBaseUrl(): string;

  protected abstract buildRequestBody(request: LLMRequest): Record<string, unknown>;

  protected abstract parseResponse(json: Record<string, unknown>): LLMResponse;

  protected authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  protected endpoint(): string {
    return this.baseUrl;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request);

    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        ...this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[${this.name}] API error ${response.status}: ${errorText}`
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    return this.parseResponse(json);
  }
}
