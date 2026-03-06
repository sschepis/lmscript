import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";
import { toOpenAIContent } from "../content.js";

interface OpenRouterChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenRouterResponseBody {
  choices: OpenRouterChoice[];
  usage?: OpenRouterUsage;
}

/**
 * Configuration for the OpenRouter provider.
 *
 * Extends the standard config with optional fields for OpenRouter-specific
 * headers (site URL, app name) used for ranking and identification.
 */
export interface OpenRouterProviderConfig extends LLMProviderConfig {
  /** Your site URL for OpenRouter rankings (sent as HTTP-Referer). */
  siteUrl?: string;

  /** Your app name for OpenRouter rankings (sent as X-Title). */
  appName?: string;
}

/**
 * Provider for OpenRouter (https://openrouter.ai).
 *
 * OpenRouter provides a unified OpenAI-compatible API that routes to
 * 200+ models from OpenAI, Anthropic, Google, Meta, Mistral, and more.
 *
 * The API is OpenAI-compatible, so this provider uses the same request/response
 * format as OpenAI with additional OpenRouter-specific headers.
 *
 * @example
 * ```typescript
 * const provider = new OpenRouterProvider({
 *   apiKey: process.env.OPENROUTER_API_KEY!,
 *   siteUrl: "https://myapp.com",
 *   appName: "My App",
 * });
 *
 * const runtime = new LScriptRuntime({ provider });
 * // Use any model available on OpenRouter
 * const fn: LScriptFunction<string, typeof schema> = {
 *   name: "Analyze",
 *   model: "anthropic/claude-sonnet-4-20250514",  // OpenRouter model IDs
 *   // ...
 * };
 * ```
 */
export class OpenRouterProvider extends BaseLLMProvider {
  readonly name = "openrouter";
  readonly supportsStructuredOutput = true;

  private siteUrl?: string;
  private appName?: string;

  constructor(config: OpenRouterProviderConfig) {
    super(config);
    this.siteUrl = config.siteUrl;
    this.appName = config.appName;
  }

  protected defaultBaseUrl(): string {
    return "https://openrouter.ai/api/v1/chat/completions";
  }

  /**
   * OpenRouter uses Bearer auth plus optional ranking headers.
   */
  protected authHeader(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.siteUrl) {
      headers["HTTP-Referer"] = this.siteUrl;
    }

    if (this.appName) {
      headers["X-Title"] = this.appName;
    }

    return headers;
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: toOpenAIContent(m.content),
      })),
      temperature: request.temperature,
    };

    if (request.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          schema: request.jsonSchema.schema,
          strict: request.jsonSchema.strict ?? true,
        },
      };
    } else if (request.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return body;
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    const body = json as unknown as OpenRouterResponseBody;

    if (!body.choices?.[0]) {
      throw new Error("[openrouter] Empty or malformed response from API");
    }

    const choice = body.choices[0];
    const response: LLMResponse = {
      content: choice.message.content ?? "",
      usage: body.usage
        ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined,
    };

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      response.toolCalls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    return response;
  }

  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const body = this.buildRequestBody(request);
    body.stream = true;

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
        `[openrouter] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[openrouter] No response body for streaming");
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
          if (data === "[DONE]") return;

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
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
