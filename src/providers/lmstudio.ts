import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";

interface OpenAIChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponseBody {
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

/**
 * Provider for LM Studio local inference server.
 *
 * LM Studio exposes an OpenAI-compatible API at
 * `http://localhost:1234/v1/chat/completions` by default.
 * No API key is required for local usage, but the config
 * still accepts one for forward-compatibility.
 *
 * @example
 * ```ts
 * const provider = new LMStudioProvider({
 *   apiKey: "lm-studio",            // any string; not validated
 *   baseUrl: "http://localhost:1234/v1/chat/completions",
 * });
 * ```
 */
export class LMStudioProvider extends BaseLLMProvider {
  readonly name = "lmstudio";

  constructor(config?: Partial<LLMProviderConfig>) {
    super({
      apiKey: config?.apiKey ?? "lm-studio",
      baseUrl: config?.baseUrl,
    });
  }

  protected defaultBaseUrl(): string {
    return "http://localhost:1234/v1/chat/completions";
  }

  /**
   * LM Studio runs locally — authentication is optional.
   * We still send a Bearer token for compatibility with proxy setups.
   */
  protected authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
    };

    if (request.jsonMode) {
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
    const body = json as unknown as OpenAIResponseBody;

    if (!body.choices?.[0]) {
      throw new Error("[lmstudio] Empty or malformed response from API");
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
        `[lmstudio] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[lmstudio] No response body for streaming");
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
