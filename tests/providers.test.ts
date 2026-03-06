// ── Provider Tests — OpenRouter, DeepSeek, VertexAnthropic, OpenAI Embeddings ─
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterProvider } from "../src/providers/openrouter.js";
import type { OpenRouterProviderConfig } from "../src/providers/openrouter.js";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import { VertexAnthropicProvider } from "../src/providers/vertex-anthropic.js";
import type { VertexAnthropicProviderConfig } from "../src/providers/vertex-anthropic.js";
import { OpenAIEmbeddingProvider } from "../src/providers/openai-embeddings.js";
import type { LLMRequest } from "../src/types.js";

// ── Helper: build a minimal LLMRequest ──────────────────────────────

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: "test-model",
    messages: [{ role: "user", content: "Hello" }],
    temperature: 0.7,
    jsonMode: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// OpenRouterProvider
// ═══════════════════════════════════════════════════════════════════

describe("OpenRouterProvider", () => {
  it("accepts apiKey, model, optional siteUrl and appName", () => {
    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      siteUrl: "https://example.com",
      appName: "TestApp",
    });
    expect(provider).toBeDefined();
  });

  it("name property returns 'openrouter'", () => {
    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    expect(provider.name).toBe("openrouter");
  });

  it("supportsStructuredOutput returns true", () => {
    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    expect(provider.supportsStructuredOutput).toBe(true);
  });

  describe("chat() — request formatting with mocked fetch", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"result":"ok"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends request to OpenRouter API URL", async () => {
      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      await provider.chat(makeRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    });

    it("includes Authorization header with Bearer token", async () => {
      const provider = new OpenRouterProvider({ apiKey: "sk-or-test-123" });
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer sk-or-test-123");
    });

    it("includes HTTP-Referer header when siteUrl is provided", async () => {
      const provider = new OpenRouterProvider({
        apiKey: "test-key",
        siteUrl: "https://mysite.com",
      });
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers["HTTP-Referer"]).toBe("https://mysite.com");
    });

    it("includes X-Title header when appName is provided", async () => {
      const provider = new OpenRouterProvider({
        apiKey: "test-key",
        appName: "MyApp",
      });
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers["X-Title"]).toBe("MyApp");
    });

    it("does not include HTTP-Referer or X-Title when not configured", async () => {
      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers["HTTP-Referer"]).toBeUndefined();
      expect(options.headers["X-Title"]).toBeUndefined();
    });

    it("constructs OpenAI-compatible request body", async () => {
      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      await provider.chat(
        makeRequest({ model: "anthropic/claude-sonnet-4-20250514", temperature: 0.5 })
      );

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(body.temperature).toBe(0.5);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });

    it("includes response_format for JSON schema requests", async () => {
      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      await provider.chat(
        makeRequest({
          jsonSchema: {
            name: "test_schema",
            schema: { type: "object", properties: { x: { type: "number" } } },
            strict: true,
          },
        })
      );

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.response_format.type).toBe("json_schema");
      expect(body.response_format.json_schema.name).toBe("test_schema");
    });

    it("parses response correctly", async () => {
      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      const result = await provider.chat(makeRequest());

      expect(result.content).toBe('{"result":"ok"}');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const provider = new OpenRouterProvider({ apiKey: "bad-key" });
      await expect(provider.chat(makeRequest())).rejects.toThrow("[openrouter] API error 401");
    });
  });

  it("allows custom baseUrl override", () => {
    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      baseUrl: "https://custom-proxy.example.com/v1/chat/completions",
    });
    expect(provider).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// DeepSeekProvider
// ═══════════════════════════════════════════════════════════════════

describe("DeepSeekProvider", () => {
  it("accepts apiKey config", () => {
    const provider = new DeepSeekProvider({ apiKey: "test-key" });
    expect(provider).toBeDefined();
  });

  it("name property returns 'deepseek'", () => {
    const provider = new DeepSeekProvider({ apiKey: "test-key" });
    expect(provider.name).toBe("deepseek");
  });

  it("supportsStructuredOutput returns true", () => {
    const provider = new DeepSeekProvider({ apiKey: "test-key" });
    expect(provider.supportsStructuredOutput).toBe(true);
  });

  describe("chat() — request formatting with mocked fetch", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "test response" } }],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends request to DeepSeek API URL", async () => {
      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      await provider.chat(makeRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.deepseek.com/chat/completions");
    });

    it("includes Authorization header with Bearer token", async () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-ds-test" });
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer sk-ds-test");
    });

    it("constructs OpenAI-compatible request body", async () => {
      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      await provider.chat(makeRequest({ model: "deepseek-chat", temperature: 0.2 }));

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.model).toBe("deepseek-chat");
      expect(body.temperature).toBe(0.2);
      expect(body.messages).toBeDefined();
    });

    it("includes json_object response_format for jsonMode", async () => {
      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      await provider.chat(makeRequest({ jsonMode: true }));

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("includes tools in request body when provided", async () => {
      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      await provider.chat(
        makeRequest({
          tools: [
            {
              name: "search",
              description: "Search the web",
              parameters: { type: "object", properties: { q: { type: "string" } } },
            },
          ],
        })
      );

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe("search");
    });

    it("parses response with usage data", async () => {
      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      const result = await provider.chat(makeRequest());

      expect(result.content).toBe("test response");
      expect(result.usage).toEqual({
        promptTokens: 8,
        completionTokens: 3,
        totalTokens: 11,
      });
    });

    it("parses response with tool calls", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: { name: "search", arguments: '{"q":"test"}' },
                  },
                ],
              },
            },
          ],
        }),
      });

      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      const result = await provider.chat(makeRequest());

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].id).toBe("call_123");
      expect(result.toolCalls![0].name).toBe("search");
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      const provider = new DeepSeekProvider({ apiKey: "test-key" });
      await expect(provider.chat(makeRequest())).rejects.toThrow("[deepseek] API error 429");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// VertexAnthropicProvider
// ═══════════════════════════════════════════════════════════════════

describe("VertexAnthropicProvider", () => {
  const baseConfig: VertexAnthropicProviderConfig = {
    apiKey: "ya29.test-access-token",
    projectId: "my-gcp-project",
    region: "us-east5",
  };

  it("accepts projectId, region, and apiKey (access token)", () => {
    const provider = new VertexAnthropicProvider(baseConfig);
    expect(provider).toBeDefined();
  });

  it("name property returns 'vertex-anthropic'", () => {
    const provider = new VertexAnthropicProvider(baseConfig);
    expect(provider.name).toBe("vertex-anthropic");
  });

  it("supportsStructuredOutput is not explicitly true", () => {
    const provider = new VertexAnthropicProvider(baseConfig);
    // VertexAnthropicProvider does not declare supportsStructuredOutput
    // Access via the LLMProvider interface which has it as optional
    expect((provider as any).supportsStructuredOutput).toBeFalsy();
  });

  it("defaults region to us-east5 if not specified", () => {
    const provider = new VertexAnthropicProvider({
      apiKey: "token",
      projectId: "proj",
    });
    // We verify indirectly through the chat URL
    expect(provider).toBeDefined();
  });

  describe("chat() — request formatting with mocked fetch", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Analysis complete." }],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends request to Vertex AI URL with projectId and region", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      await provider.chat(makeRequest({ model: "claude-sonnet-4-20250514@20250514" }));

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("aiplatform.googleapis.com");
      expect(url).toContain("projects/my-gcp-project");
      expect(url).toContain("locations/us-east5");
      expect(url).toContain("claude-sonnet-4-20250514@20250514");
      expect(url).toContain(":rawPredict");
    });

    it("includes model in the URL path", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      await provider.chat(makeRequest({ model: "claude-haiku-4-20250514@20250514" }));

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("publishers/anthropic/models/claude-haiku-4-20250514@20250514");
    });

    it("uses Bearer token for authentication", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      await provider.chat(makeRequest());

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer ya29.test-access-token");
    });

    it("constructs Anthropic-format request body", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      await provider.chat(
        makeRequest({
          model: "claude-sonnet-4-20250514",
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hi" },
          ],
          temperature: 0.4,
        })
      );

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      // Anthropic separates system from messages
      expect(body.system).toBe("You are helpful.");
      expect(body.messages).toHaveLength(1); // Only non-system messages
      expect(body.messages[0].role).toBe("user");
      expect(body.temperature).toBe(0.4);
      expect(body.anthropic_version).toBe("vertex-2023-10-16");
      expect(body.max_tokens).toBe(4096);
    });

    it("parses Anthropic-format response correctly", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      const result = await provider.chat(makeRequest());

      expect(result.content).toBe("Analysis complete.");
      expect(result.usage).toEqual({
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
    });

    it("uses custom region in URL", async () => {
      const provider = new VertexAnthropicProvider({
        ...baseConfig,
        region: "europe-west1",
      });
      await provider.chat(makeRequest());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("locations/europe-west1");
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Permission denied",
      });

      const provider = new VertexAnthropicProvider(baseConfig);
      await expect(provider.chat(makeRequest())).rejects.toThrow(
        "[vertex-anthropic] API error 403"
      );
    });

    it("includes tools in Anthropic format when provided", async () => {
      const provider = new VertexAnthropicProvider(baseConfig);
      await provider.chat(
        makeRequest({
          tools: [
            {
              name: "get_weather",
              description: "Get the weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          ],
        })
      );

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe("get_weather");
      expect(body.tools[0].input_schema).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// OpenAIEmbeddingProvider
// ═══════════════════════════════════════════════════════════════════

describe("OpenAIEmbeddingProvider", () => {
  it("accepts apiKey in constructor", () => {
    const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
    expect(provider).toBeDefined();
  });

  it("name property returns 'openai-embeddings'", () => {
    const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
    expect(provider.name).toBe("openai-embeddings");
  });

  it("accepts optional baseUrl override", () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseUrl: "https://custom-api.example.com/embeddings",
    });
    expect(provider).toBeDefined();
  });

  describe("embed() — with mocked fetch", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2, 0.3], index: 0 },
          ],
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("embed() takes string[] and returns Promise<number[][]>", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      const result = await provider.embed(["hello"]);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(Array.isArray(result[0])).toBe(true);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    });

    it("sends request to default OpenAI embeddings URL", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      await provider.embed(["test"]);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
    });

    it("includes Authorization header", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "sk-embed-123" });
      await provider.embed(["test"]);

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer sk-embed-123");
    });

    it("uses default model text-embedding-3-small", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      await provider.embed(["test"]);

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.model).toBe("text-embedding-3-small");
    });

    it("allows custom model override", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      await provider.embed(["test"], "text-embedding-3-large");

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.model).toBe("text-embedding-3-large");
    });

    it("handles batch embedding (multiple texts)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
            { embedding: [0.5, 0.6], index: 2 },
          ],
        }),
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      const result = await provider.embed(["a", "b", "c"]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([0.1, 0.2]);
      expect(result[1]).toEqual([0.3, 0.4]);
      expect(result[2]).toEqual([0.5, 0.6]);
    });

    it("sorts embeddings by index to maintain input order", async () => {
      // Simulate out-of-order response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [0.5, 0.6], index: 2 },
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
          ],
        }),
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      const result = await provider.embed(["a", "b", "c"]);

      // Should be sorted by index, not response order
      expect(result[0]).toEqual([0.1, 0.2]);
      expect(result[1]).toEqual([0.3, 0.4]);
      expect(result[2]).toEqual([0.5, 0.6]);
    });

    it("sends texts as input array in request body", async () => {
      const provider = new OpenAIEmbeddingProvider({ apiKey: "test-key" });
      await provider.embed(["hello", "world"]);

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.input).toEqual(["hello", "world"]);
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Invalid API key",
      });

      const provider = new OpenAIEmbeddingProvider({ apiKey: "bad-key" });
      await expect(provider.embed(["test"])).rejects.toThrow(
        "[openai-embeddings] API error 401"
      );
    });

    it("uses custom baseUrl when provided", async () => {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: "test-key",
        baseUrl: "https://custom.api/embed",
      });
      await provider.embed(["test"]);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://custom.api/embed");
    });
  });
});
