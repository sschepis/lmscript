import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";
import { toOpenAIContent } from "../content.js";

interface DeepSeekChoice {
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
}

interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface DeepSeekResponseBody {
  choices: DeepSeekChoice[];
  usage?: DeepSeekUsage;
}

/**
 * Provider for DeepSeek's API (https://platform.deepseek.com).
 *
 * DeepSeek provides an OpenAI-compatible API with models like
 * `deepseek-chat` (DeepSeek-V3) and `deepseek-reasoner` (DeepSeek-R1).
 *
 * The API is OpenAI-compatible, so the request/response format matches
 * OpenAI's chat completions API with DeepSeek-specific extensions
 * (e.g., cache hit/miss token tracking in usage).
 *
 * @example
 * ```typescript
 * const provider = new DeepSeekProvider({
 *   apiKey: process.env.DEEPSEEK_API_KEY!,
 * });
 *
 * const runtime = new LScriptRuntime({ provider });
 * const fn: LScriptFunction<string, typeof schema> = {
 *   name: "Analyze",
 *   model: "deepseek-chat",          // DeepSeek-V3
 *   // model: "deepseek-reasoner",   // DeepSeek-R1
 *   // ...
 * };
 * ```
 */
export class DeepSeekProvider extends BaseLLMProvider {
  readonly name = "deepseek";
  readonly supportsStructuredOutput = true;

  constructor(config: LLMProviderConfig) {
    super(config);
  }

  protected defaultBaseUrl(): string {
    return "https://api.deepseek.com/chat/completions";
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
    const body = json as unknown as DeepSeekResponseBody;

    if (!body.choices?.[0]) {
      throw new Error("[deepseek] Empty or malformed response from API");
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
        `[deepseek] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[deepseek] No response body for streaming");
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
