import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaResponseBody {
  message: {
    content: string;
  };
  eval_count?: number;
  prompt_eval_count?: number;
}

/**
 * Provider for Ollama local model server.
 *
 * Ollama runs locally and exposes an OpenAI-like chat API at
 * `http://localhost:11434/api/chat`. No authentication is required.
 */
export class OllamaProvider extends BaseLLMProvider {
  readonly name = "ollama";

  constructor(config: LLMProviderConfig) {
    super(config);
  }

  protected defaultBaseUrl(): string {
    return "http://localhost:11434/api/chat";
  }

  /**
   * Ollama runs locally — no authentication needed.
   */
  protected authHeader(): Record<string, string> {
    return {};
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const messages: OllamaMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature,
      },
    };

    if (request.jsonMode) {
      body.format = "json";
    }

    return body;
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    const body = json as unknown as OllamaResponseBody;

    if (!body.message?.content) {
      throw new Error("[ollama] Empty or malformed response from API");
    }

    const evalCount = body.eval_count ?? 0;
    const promptEvalCount = body.prompt_eval_count ?? 0;

    return {
      content: body.message.content,
      usage:
        evalCount > 0 || promptEvalCount > 0
          ? {
              promptTokens: promptEvalCount,
              completionTokens: evalCount,
              totalTokens: promptEvalCount + evalCount,
            }
          : undefined,
    };
  }

  /**
   * Streaming via Ollama's newline-delimited JSON format.
   * Each line is a JSON object with `message.content` containing partial text.
   * The stream ends when `done: true` is received.
   */
  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[ollama] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[ollama] No response body for streaming");
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
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
            };

            if (parsed.done) return;

            const content = parsed.message?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
