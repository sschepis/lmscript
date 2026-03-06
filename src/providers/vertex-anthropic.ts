import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";
import { extractText, toAnthropicContent } from "../content.js";

interface VertexAnthropicContent {
  type: "text";
  text: string;
}

interface VertexAnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface VertexAnthropicResponseBody {
  content: VertexAnthropicContent[];
  usage?: VertexAnthropicUsage;
}

/**
 * Configuration for the Google Vertex AI Anthropic provider.
 *
 * Vertex AI hosts Claude models via Google Cloud and uses Google Cloud
 * authentication (OAuth2 access tokens) instead of Anthropic API keys.
 *
 * To obtain an access token, run:
 * ```bash
 * gcloud auth print-access-token
 * ```
 *
 * Or use Application Default Credentials programmatically.
 */
export interface VertexAnthropicProviderConfig extends LLMProviderConfig {
  /**
   * Google Cloud project ID.
   * Required to construct the Vertex AI endpoint URL.
   */
  projectId: string;

  /**
   * Google Cloud region where Claude models are deployed.
   * Common regions: "us-east5", "europe-west1".
   * @default "us-east5"
   */
  region?: string;

  /**
   * Anthropic API version to use.
   * @default "vertex-2023-10-16"
   */
  anthropicVersion?: string;
}

/**
 * Provider for Anthropic Claude models hosted on Google Vertex AI.
 *
 * Google Vertex AI provides access to Claude models through the
 * Anthropic Messages API format, but with Google Cloud authentication
 * (OAuth2 bearer tokens) instead of Anthropic API keys.
 *
 * The `apiKey` field should contain a Google Cloud OAuth2 access token,
 * obtainable via `gcloud auth print-access-token`.
 *
 * @example
 * ```typescript
 * const provider = new VertexAnthropicProvider({
 *   apiKey: process.env.GCLOUD_ACCESS_TOKEN!,  // OAuth2 access token
 *   projectId: "my-gcp-project",
 *   region: "us-east5",
 * });
 *
 * const runtime = new LScriptRuntime({ provider });
 * const fn: LScriptFunction<string, typeof schema> = {
 *   name: "Analyze",
 *   model: "claude-sonnet-4-20250514@20250514",  // Vertex AI model ID
 *   // ...
 * };
 * ```
 */
export class VertexAnthropicProvider extends BaseLLMProvider {
  readonly name = "vertex-anthropic";

  private projectId: string;
  private region: string;
  private anthropicVersion: string;

  constructor(config: VertexAnthropicProviderConfig) {
    super(config);
    this.projectId = config.projectId;
    this.region = config.region ?? "us-east5";
    this.anthropicVersion = config.anthropicVersion ?? "vertex-2023-10-16";
  }

  protected defaultBaseUrl(): string {
    // Constructed dynamically per-request since it depends on region and project
    return `https://${this.region}-aiplatform.googleapis.com`;
  }

  /**
   * Vertex AI uses Google Cloud OAuth2 Bearer tokens.
   */
  protected authHeader(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Build the full endpoint URL for the Vertex AI Anthropic Messages API.
   * The model is embedded in the URL path.
   */
  private buildEndpointForModel(model: string): string {
    return (
      `${this.baseUrl}/v1/projects/${this.projectId}` +
      `/locations/${this.region}` +
      `/publishers/anthropic/models/${model}:rawPredict`
    );
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    // Anthropic separates system from messages
    const systemMessage = request.messages.find((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter(
      (m) => m.role !== "system"
    );

    const body: Record<string, unknown> = {
      anthropic_version: this.anthropicVersion,
      model: request.model,
      max_tokens: 4096,
      temperature: request.temperature,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: toAnthropicContent(m.content),
      })),
    };

    if (systemMessage?.content) {
      body.system = extractText(systemMessage.content);
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return body;
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    const body = json as unknown as VertexAnthropicResponseBody;

    if (!body.content?.[0]?.text) {
      throw new Error("[vertex-anthropic] Empty or malformed response from API");
    }

    const totalTokens =
      (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0);

    return {
      content: body.content[0].text,
      usage: body.usage
        ? {
            promptTokens: body.usage.input_tokens,
            completionTokens: body.usage.output_tokens,
            totalTokens,
          }
        : undefined,
    };
  }

  /**
   * Override `chat()` because the Vertex AI endpoint URL includes the model name.
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request);
    const url = this.buildEndpointForModel(request.model);

    const response = await fetch(url, {
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
        `[vertex-anthropic] API error ${response.status}: ${errorText}`
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    return this.parseResponse(json);
  }

  /**
   * Streaming via Vertex AI Anthropic's SSE endpoint.
   *
   * Vertex AI uses the `streamRawPredict` action for streaming, with
   * the same SSE event format as the native Anthropic API.
   */
  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const url =
      `${this.baseUrl}/v1/projects/${this.projectId}` +
      `/locations/${this.region}` +
      `/publishers/anthropic/models/${request.model}:streamRawPredict`;

    const response = await fetch(url, {
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
        `[vertex-anthropic] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[vertex-anthropic] No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
            };

            if (parsed.type === "message_stop") return;

            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.text
            ) {
              yield parsed.delta.text;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
