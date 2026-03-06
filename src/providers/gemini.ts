import type { LLMRequest, LLMResponse, LLMProviderConfig } from "../types.js";
import { BaseLLMProvider } from "./base.js";
import { toGeminiParts, extractText } from "../content.js";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiContent {
  parts: GeminiPart[];
  role: string;
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
  };
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiResponseBody {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

/**
 * Provider for Google's Gemini (Generative Language) API.
 *
 * The Gemini API uses a URL-based API key and a different message format
 * from OpenAI/Anthropic, so this provider overrides `chat()` to construct
 * the endpoint dynamically based on the request's model field.
 */
export class GeminiProvider extends BaseLLMProvider {
  readonly name = "gemini";
  readonly supportsStructuredOutput = true;

  constructor(config: LLMProviderConfig) {
    super(config);
  }

  protected defaultBaseUrl(): string {
    return "https://generativelanguage.googleapis.com/v1beta/models";
  }

  /**
   * Gemini puts the API key in the URL, so no auth header is needed.
   */
  protected authHeader(): Record<string, string> {
    return {};
  }

  /**
   * Default endpoint — not used directly since `chat()` constructs the URL
   * dynamically per-request based on the model.
   */
  protected endpoint(): string {
    return this.baseUrl;
  }

  /**
   * Construct the Gemini endpoint for a given model and action.
   */
  private buildEndpoint(model: string, action: string = "generateContent"): string {
    return `${this.baseUrl}/${model}:${action}?key=${this.apiKey}`;
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const contents: GeminiContent[] = [];
    let systemInstruction: { parts: GeminiPart[] } | undefined;

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: extractText(msg.content) }] };
      } else {
        contents.push({
          parts: toGeminiParts(msg.content) as GeminiPart[],
          role: msg.role === "assistant" ? "model" : "user",
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (request.jsonSchema) {
      (body.generationConfig as Record<string, unknown>).responseMimeType =
        "application/json";
      (body.generationConfig as Record<string, unknown>).responseSchema =
        request.jsonSchema.schema;
    } else if (request.jsonMode) {
      (body.generationConfig as Record<string, unknown>).responseMimeType =
        "application/json";
    }

    return body;
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    const body = json as unknown as GeminiResponseBody;

    if (!body.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error("[gemini] Empty or malformed response from API");
    }

    const text = body.candidates[0].content.parts[0].text;

    return {
      content: text,
      usage: body.usageMetadata
        ? {
            promptTokens: body.usageMetadata.promptTokenCount,
            completionTokens: body.usageMetadata.candidatesTokenCount,
            totalTokens: body.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  /**
   * Override `chat()` because Gemini's endpoint URL depends on the model
   * from the request (unlike OpenAI/Anthropic which have a fixed endpoint).
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request);
    const url = this.buildEndpoint(request.model);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[gemini] API error ${response.status}: ${errorText}`
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    return this.parseResponse(json);
  }

  /**
   * Streaming via Gemini's `streamGenerateContent` endpoint with SSE.
   */
  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const body = this.buildRequestBody(request);
    const url = `${this.baseUrl}/${request.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[gemini] API error ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("[gemini] No response body for streaming");
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
            const parsed = JSON.parse(data) as GeminiResponseBody;
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
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
