import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";

interface AnthropicContent {
  type: "text";
  text: string;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicResponseBody {
  content: AnthropicContent[];
  usage?: AnthropicUsage;
}

/**
 * Provider for Anthropic's Messages API.
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name = "anthropic";

  constructor(config: LLMProviderConfig) {
    super(config);
  }

  protected defaultBaseUrl(): string {
    return "https://api.anthropic.com/v1/messages";
  }

  protected authHeader(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    // Anthropic separates system from messages
    const systemMessage = request.messages.find((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter(
      (m) => m.role !== "system"
    );

    return {
      model: request.model,
      max_tokens: 4096,
      temperature: request.temperature,
      system: systemMessage?.content ?? "",
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    const body = json as unknown as AnthropicResponseBody;

    if (!body.content?.[0]?.text) {
      throw new Error("[anthropic] Empty or malformed response from API");
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
        `[anthropic] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[anthropic] No response body for streaming");
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
