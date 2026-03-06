# Providers

[← Back to Index](./README.md)

---

## Table of Contents

 1. [Provider Architecture](#provider-architecture)
 2. [Provider Capabilities Matrix](#provider-capabilities-matrix)
 3. [OpenAI](#openai)
 4. [Anthropic](#anthropic)
 5. [Google Gemini](#google-gemini)
 6. [Ollama](#ollama)
 7. [LM Studio](#lm-studio)
 8. [OpenRouter](#openrouter)
 9. [Google Vertex AI (Anthropic)](#google-vertex-ai-anthropic)
10. [DeepSeek](#deepseek)
11. [OpenAI Embedding Provider](#openai-embedding-provider)
12. [Model Router](#model-router)
13. [Fallback Provider](#fallback-provider)
14. [Creating a Custom Provider](#creating-a-custom-provider)

---

## Provider Architecture

All providers implement the [`LLMProvider`](../src/types.ts:41) interface:

```typescript
interface LLMProvider {
  readonly name: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream?(request: LLMRequest): AsyncIterable<string>;
  supportsStructuredOutput?: boolean;  // Provider supports native JSON Schema output
}
```

When [`supportsStructuredOutput`](../src/types.ts:45) is `true`, the runtime sends the Zod schema as a `jsonSchema` field on the request, allowing providers that support native structured output (e.g., OpenAI's `response_format: { type: "json_schema" }`) to enforce output shape at the API level rather than relying solely on the retry/validation loop.

The concrete providers extend [`BaseLLMProvider`](../src/providers/base.ts:8), which handles common concerns:

- Auth headers (`Authorization: Bearer <key>`)
- HTTP request/response lifecycle via `fetch()`
- Error formatting

Subclasses implement three abstract methods:

| Method | Purpose |
|---|---|
| `defaultBaseUrl()` | Returns the default API endpoint URL |
| `buildRequestBody(request)` | Converts [`LLMRequest`](../src/types.ts:23) to the provider's native format |
| `parseResponse(json)` | Converts the provider's response to [`LLMResponse`](../src/types.ts:31) |

---

## Provider Capabilities Matrix

This table summarizes which providers support key features:

| Provider | Structured Output | Multi-Modal | Streaming | Tool Calling |
|---|---|---|---|---|
| [OpenAI](#openai) | ✅ | ✅ | ✅ | ✅ |
| [Anthropic](#anthropic) | ❌ | ✅ | ✅ | ❌ |
| [Google Gemini](#google-gemini) | ✅ | ✅ | ✅ | ❌ |
| [Ollama](#ollama) | ❌ | ❌ (text-only) | ✅ | ❌ |
| [LM Studio](#lm-studio) | ❌ | ❌ (text-only) | ✅ | ✅ |
| [OpenRouter](#openrouter) | ✅ | ✅ | ✅ | ✅ |
| [DeepSeek](#deepseek) | ✅ | ✅ | ✅ | ✅ |
| [Vertex Anthropic](#google-vertex-ai-anthropic) | ❌ | ✅ | ✅ | ✅ |

**Structured Output**: Provider sets [`supportsStructuredOutput = true`](../src/types.ts:45) and handles `jsonSchema` on [`LLMRequest`](../src/types.ts:23), enabling the API to enforce output shape natively (e.g., OpenAI's `response_format: { type: "json_schema" }`). Providers without this still work — the runtime falls back to system-prompt schema injection + Zod validation.

**Multi-Modal**: Provider accepts [`ContentBlock[]`](../src/types.ts:118) messages containing [`ImageUrlContent`](../src/types.ts:107) or [`ImageBase64Content`](../src/types.ts:112) alongside text. Non-multi-modal providers only accept plain `string` message content.

---

## OpenAI

[`OpenAIProvider`](../src/providers/openai.ts:29) works with OpenAI and any OpenAI-compatible API (Azure OpenAI, local proxies, etc.).

```typescript
import { OpenAIProvider } from "lmscript";

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | OpenAI API key |
| `baseUrl` | `https://api.openai.com/v1/chat/completions` | API endpoint |

### Features

- ✅ JSON mode via `response_format: { type: "json_object" }`
- ✅ Structured output via `response_format: { type: "json_schema" }` ([`supportsStructuredOutput = true`](../src/types.ts:45))
- ✅ Streaming via SSE (`data: [DONE]` termination)
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118))
- ✅ Tool/function calling
- ✅ Token usage reporting

### Azure OpenAI

Point `baseUrl` to your Azure endpoint:

```typescript
const provider = new OpenAIProvider({
  apiKey: process.env.AZURE_OPENAI_KEY!,
  baseUrl: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01",
});
```

---

## Anthropic

[`AnthropicProvider`](../src/providers/anthropic.ts:22) for Claude models.

```typescript
import { AnthropicProvider } from "lmscript";

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | Anthropic API key |
| `baseUrl` | `https://api.anthropic.com/v1/messages` | API endpoint |

### Features

- ✅ System message handled separately (Anthropic format)
- ✅ Streaming via SSE (`content_block_delta` events)
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118), converted with [`toAnthropicContent()`](../src/content.ts))
- ✅ Token usage reporting (`input_tokens` / `output_tokens`)
- ✅ `max_tokens` set to 4096 by default
- ❌ Structured output (no native JSON Schema support)
- ❌ Tool calling (not yet implemented in the provider)

### Authentication

Anthropic uses `x-api-key` header instead of `Authorization: Bearer`. The provider handles this automatically.

---

## Google Gemini

[`GeminiProvider`](../src/providers/gemini.ts:37) for Google's Generative Language API.

```typescript
import { GeminiProvider } from "lmscript";

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | Google API key |
| `baseUrl` | `https://generativelanguage.googleapis.com/v1beta/models` | API base URL |

### Features

- ✅ JSON mode via `responseMimeType: "application/json"`
- ✅ Structured output via `responseSchema` ([`supportsStructuredOutput = true`](../src/types.ts:45))
- ✅ Streaming via `streamGenerateContent` endpoint with SSE
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118), converted with [`toGeminiParts()`](../src/content.ts))
- ✅ System instructions as separate `systemInstruction` field
- ✅ Token usage reporting

### Differences from OpenAI/Anthropic

- API key is passed in the URL (`?key=...`), not in headers
- The endpoint URL is dynamic: `{baseUrl}/{model}:generateContent?key={apiKey}`
- Messages use `"model"` role instead of `"assistant"`
- Content is wrapped in `{ parts: [{ text: ... }] }` objects

---

## Ollama

[`OllamaProvider`](../src/providers/ollama.ts:23) for local models via Ollama.

```typescript
import { OllamaProvider } from "lmscript";

const provider = new OllamaProvider({
  apiKey: "unused",  // Ollama doesn't require API keys
  baseUrl: "http://localhost:11434/api/chat",
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required but unused) | Pass any string |
| `baseUrl` | `http://localhost:11434/api/chat` | Ollama server URL |

### Features

- ✅ JSON mode via `format: "json"`
- ✅ Streaming via newline-delimited JSON
- ✅ Token usage reporting (`eval_count` / `prompt_eval_count`)
- ✅ No authentication required
- ❌ Structured output (no native JSON Schema support)
- ❌ Multi-modal (text-only)

### Setup

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.1

# The server runs at http://localhost:11434 by default
```

---

## LM Studio

[`LMStudioProvider`](../src/providers/lmstudio.ts:42) for LM Studio's local inference server.

```typescript
import { LMStudioProvider } from "lmscript";

// Zero-config — uses defaults
const provider = new LMStudioProvider();

// Or with explicit config
const provider2 = new LMStudioProvider({
  apiKey: "lm-studio",  // optional, any string
  baseUrl: "http://localhost:1234/v1/chat/completions",
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | `"lm-studio"` | Optional (any string, not validated) |
| `baseUrl` | `http://localhost:1234/v1/chat/completions` | LM Studio server URL |

### Features

- ✅ OpenAI-compatible API format
- ✅ Streaming via SSE
- ✅ Tool/function calling
- ⚠️ Does **not** send `response_format: { type: "json_object" }` — relies on the runtime's system-prompt JSON instruction + Zod validation instead
- ❌ Structured output (no native JSON Schema support)
- ❌ Multi-modal (text-only)

### Key Difference from OpenAI

LM Studio does not support OpenAI's `response_format: { type: "json_object" }`. The [`LMStudioProvider`](../src/providers/lmstudio.ts:42) intentionally omits this field and relies entirely on the system-prompt schema injection and Zod validation loop for JSON enforcement.

---

## OpenRouter

[`OpenRouterProvider`](../src/providers/openrouter.ts:67) provides access to 200+ models from OpenAI, Anthropic, Google, Meta, Mistral, and more through [OpenRouter's](https://openrouter.ai) unified API.

```typescript
import { OpenRouterProvider } from "lmscript";

const provider = new OpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  siteUrl: "https://myapp.com",     // Optional: for OpenRouter rankings
  appName: "My Application",        // Optional: for OpenRouter rankings
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | OpenRouter API key |
| `baseUrl` | `https://openrouter.ai/api/v1/chat/completions` | API endpoint |
| `siteUrl` | (optional) | Your site URL, sent as `HTTP-Referer` for rankings |
| `appName` | (optional) | Your app name, sent as `X-Title` for rankings |

### Features

- ✅ OpenAI-compatible request/response format
- ✅ JSON mode via `response_format: { type: "json_object" }`
- ✅ Structured output via `response_format: { type: "json_schema" }` ([`supportsStructuredOutput = true`](../src/types.ts:45))
- ✅ Streaming via SSE (`data: [DONE]` termination)
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118))
- ✅ Tool/function calling
- ✅ Token usage reporting
- ✅ Access to 200+ models with unified API

### Model IDs

OpenRouter uses `provider/model` format for model IDs:

```typescript
const fn: LScriptFunction<string, typeof schema> = {
  name: "Analyze",
  model: "anthropic/claude-sonnet-4-20250514",  // Anthropic via OpenRouter
  // model: "openai/gpt-4o",                // OpenAI via OpenRouter
  // model: "google/gemini-2.0-flash",      // Google via OpenRouter
  // model: "meta-llama/llama-3.1-70b",     // Meta via OpenRouter
  // ...
};
```

---

## Google Vertex AI (Anthropic)

[`VertexAnthropicProvider`](../src/providers/vertex-anthropic.ts:78) accesses Claude models hosted on Google Cloud's Vertex AI platform.

```typescript
import { VertexAnthropicProvider } from "lmscript";

const provider = new VertexAnthropicProvider({
  apiKey: process.env.GCLOUD_ACCESS_TOKEN!,  // OAuth2 access token
  projectId: "my-gcp-project",
  region: "us-east5",
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | Google Cloud OAuth2 access token |
| `projectId` | (required) | GCP project ID |
| `region` | `"us-east5"` | GCP region where Claude is available |
| `baseUrl` | `https://{region}-aiplatform.googleapis.com` | API base URL |
| `anthropicVersion` | `"vertex-2023-10-16"` | Anthropic API version |

### Features

- ✅ Anthropic Messages API format (system message separated)
- ✅ Streaming via SSE (`content_block_delta` events)
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118), converted with [`toAnthropicContent()`](../src/content.ts))
- ✅ Tool/function calling (Anthropic tool format)
- ✅ Token usage reporting (`input_tokens` / `output_tokens`)
- ✅ Google Cloud authentication (OAuth2 Bearer tokens)
- ✅ `max_tokens` set to 4096 by default
- ❌ Structured output (no native JSON Schema support)

### Authentication

Vertex AI uses Google Cloud OAuth2 access tokens instead of Anthropic API keys:

```bash
# Get an access token via gcloud CLI
export GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token)
```

Or programmatically with Application Default Credentials:

```typescript
import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();
const token = (await client.getAccessToken()).token!;

const provider = new VertexAnthropicProvider({
  apiKey: token,
  projectId: "my-project",
});
```

### Model IDs

Vertex AI uses versioned model identifiers:

```typescript
{
  model: "claude-sonnet-4-20250514@20250514",  // Claude 3.5 Sonnet v2
  // model: "claude-3-haiku@20240307",  // Claude 3 Haiku
  // model: "claude-3-opus@20240229",   // Claude 3 Opus
}
```

### Key Differences from Direct Anthropic

- Authentication: OAuth2 bearer token vs `x-api-key`
- Endpoint: Vertex AI `rawPredict` / `streamRawPredict` endpoints
- Model IDs: Versioned format (`model@date`)
- URL structure: Model name is in the URL path, not request body

---

## DeepSeek

[`DeepSeekProvider`](../src/providers/deepseek.ts:51) for DeepSeek's API, supporting DeepSeek-V3 and DeepSeek-R1 models.

```typescript
import { DeepSeekProvider } from "lmscript";

const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | DeepSeek API key |
| `baseUrl` | `https://api.deepseek.com/chat/completions` | API endpoint |

### Features

- ✅ OpenAI-compatible request/response format
- ✅ JSON mode via `response_format: { type: "json_object" }`
- ✅ Structured output via `response_format: { type: "json_schema" }` ([`supportsStructuredOutput = true`](../src/types.ts:45))
- ✅ Streaming via SSE (`data: [DONE]` termination)
- ✅ Multi-modal messages (images via [`ContentBlock[]`](../src/types.ts:118))
- ✅ Tool/function calling
- ✅ Token usage reporting (includes cache hit/miss token counts)

### Available Models

| Model ID | Description |
|---|---|
| `deepseek-chat` | DeepSeek-V3 — general-purpose chat model |
| `deepseek-reasoner` | DeepSeek-R1 — reasoning-focused model |

### Example

```typescript
const fn: LScriptFunction<string, typeof schema> = {
  name: "Analyze",
  model: "deepseek-chat",        // DeepSeek-V3
  // model: "deepseek-reasoner", // DeepSeek-R1
  system: "You are a helpful analyst.",
  prompt: (input) => input,
  schema: MySchema,
  temperature: 0.3,
};
```

### Cache Tokens

DeepSeek's API reports cache hit/miss tokens in the usage response (`prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`). The provider normalizes these to the standard `promptTokens` / `completionTokens` / `totalTokens` format.

---

## OpenAI Embedding Provider

[`OpenAIEmbeddingProvider`](../src/providers/openai-embeddings.ts:12) implements the [`EmbeddingProvider`](../src/embeddings.ts:4) interface for generating vector embeddings via OpenAI's embeddings API (or any compatible API).

```typescript
import { OpenAIEmbeddingProvider } from "lmscript";

const embedder = new OpenAIEmbeddingProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | (required) | OpenAI API key |
| `model` | `"text-embedding-3-small"` | Embedding model to use |
| `baseUrl` | `"https://api.openai.com/v1/embeddings"` | API endpoint |

### Usage

```typescript
// Embed one or more texts
const vectors = await embedder.embed(["Hello world", "Goodbye world"]);
// vectors[0] → number[] (e.g., 1536-dimensional for text-embedding-3-small)

// Use with MemoryVectorStore
import { MemoryVectorStore } from "lmscript";

const store = new MemoryVectorStore();
const texts = ["TypeScript is great", "Zod validates schemas"];
const embeddings = await embedder.embed(texts);

await store.add(
  texts.map((text, i) => ({
    id: `doc-${i}`,
    content: text,
    vector: embeddings[i],
  }))
);

// Search
const queryVec = (await embedder.embed(["schema validation"]))[0];
const results = await store.search(queryVec, 5);
```

### Compatible APIs

Any OpenAI-compatible embeddings API works by overriding `baseUrl`:

```typescript
// Local embedding server
const localEmbedder = new OpenAIEmbeddingProvider({
  apiKey: "unused",
  baseUrl: "http://localhost:8080/v1/embeddings",
  model: "all-MiniLM-L6-v2",
});

// Azure OpenAI
const azureEmbedder = new OpenAIEmbeddingProvider({
  apiKey: process.env.AZURE_KEY!,
  baseUrl: "https://my-resource.openai.azure.com/openai/deployments/my-embedding/embeddings?api-version=2024-02-01",
});
```

See [Embeddings & RAG](./advanced.md#embeddings--rag) in the Advanced Topics guide for full RAG pipeline integration.

---

## Model Router

[`ModelRouter`](../src/router.ts:27) routes requests to different providers based on configurable pattern-matching rules.

```typescript
import { ModelRouter } from "lmscript";

const router = new ModelRouter({
  rules: [
    { match: /^gpt-/, provider: openaiProvider },
    { match: /^claude-/, provider: anthropicProvider },
    { match: /^gemini-/, provider: geminiProvider },
  ],
  defaultProvider: ollamaProvider,
});

const runtime = new LScriptRuntime({ provider: router });
```

### Routing Rules

Each [`RoutingRule`](../src/router.ts:10) has a `match` field that determines when it applies:

| Match Type | Example | Matched Against |
|---|---|---|
| `string` | `"gpt-4o"` | Exact match on function name or model field |
| `RegExp` | `/^claude-/` | Pattern match on function name or model field |
| `function` | `(fn) => fn.temperature < 0.3` | Custom predicate receiving the full `LScriptFunction` |

Rules are evaluated in order; the first match wins. If no rules match, the `defaultProvider` is used.

### Optional Model Override

A rule can include a `modelOverride` to remap the model identifier:

```typescript
{
  match: /^gpt-4/,
  provider: azureProvider,
  modelOverride: "my-azure-deployment-name",
}
```

### Dynamic Rule Management

```typescript
router.addRule({ match: /^mistral-/, provider: ollamaProvider });
router.removeRule(/^gpt-/); // Remove by match value
```

---

## Fallback Provider

[`FallbackProvider`](../src/providers/fallback.ts:30) tries each provider in order until one succeeds:

```typescript
import { FallbackProvider } from "lmscript";

const provider = new FallbackProvider([
  openaiProvider,
  anthropicProvider,
  ollamaProvider,
]);

// If OpenAI fails → tries Anthropic → tries Ollama
```

### Configuration

```typescript
const provider = new FallbackProvider(
  [openaiProvider, anthropicProvider],
  { retryDelay: 1000 }  // Wait 1s between provider attempts
);
```

### Error Handling

If all providers fail, an [`AllProvidersFailedError`](../src/providers/fallback.ts:8) is thrown containing all collected errors:

```typescript
try {
  await runtime.execute(myFn, input);
} catch (error) {
  if (error instanceof AllProvidersFailedError) {
    for (const { provider, error: providerError } of error.errors) {
      console.error(`${provider}: ${providerError.message}`);
    }
  }
}
```

### Streaming Fallback

`FallbackProvider` also supports streaming via [`chatStream()`](../src/providers/fallback.ts:70). Providers that don't implement `chatStream` are skipped.

---

## Creating a Custom Provider

Extend [`BaseLLMProvider`](../src/providers/base.ts:8) to add support for a new LLM API:

```typescript
import { BaseLLMProvider } from "lmscript";
import type { LLMRequest, LLMResponse, LLMProviderConfig } from "lmscript";

export class MyCustomProvider extends BaseLLMProvider {
  readonly name = "my-provider";

  constructor(config: LLMProviderConfig) {
    super(config);
  }

  protected defaultBaseUrl(): string {
    return "https://api.my-provider.com/v1/chat";
  }

  protected buildRequestBody(request: LLMRequest): Record<string, unknown> {
    // Convert LLMRequest to your API's request format
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      // ... provider-specific fields
    };
  }

  protected parseResponse(json: Record<string, unknown>): LLMResponse {
    // Convert your API's response to LLMResponse
    return {
      content: (json as any).output.text,
      usage: {
        promptTokens: (json as any).usage.input,
        completionTokens: (json as any).usage.output,
        totalTokens: (json as any).usage.total,
      },
    };
  }
}
```

Or implement [`LLMProvider`](../src/types.ts:41) directly for full control:

```typescript
const myProvider: LLMProvider = {
  name: "custom",
  async chat(request) {
    // Custom implementation
    return { content: "...", usage: { ... } };
  },
  async *chatStream(request) {
    // Optional streaming
    yield "partial ";
    yield "response";
  },
};
```

---

## Next Steps

- [User Guide](./user-guide.md) — Core concepts and features
- [Middleware & Pipelines](./middleware-and-pipelines.md) — Lifecycle hooks and chaining
- [Advanced Topics](./advanced.md) — Cost tracking, caching, budgets
