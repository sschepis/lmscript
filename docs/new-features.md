# New Features (v2)

[← Back to Index](./README.md)

---

## Table of Contents

1. [Retry with Exponential Backoff](#1-retry-with-exponential-backoff)
2. [Request-Level Rate Limiting](#2-request-level-rate-limiting)
3. [Native Structured Output](#3-native-structured-output)
4. [Accurate Token Counting](#4-accurate-token-counting)
5. [Multi-Modal Messages](#5-multi-modal-messages)
6. [Agent Loop Framework](#6-agent-loop-framework)
7. [Circuit Breaker](#7-circuit-breaker)
8. [Prompt Versioning & A/B Testing](#8-prompt-versioning--ab-testing)
9. [DSL Enhancements](#9-dsl-enhancements)
10. [Embeddings & RAG Pipeline](#10-embeddings--rag-pipeline)
11. [OpenTelemetry Integration](#11-opentelemetry-integration)
12. [Batch Job Management](#12-batch-job-management)

---

## 1. Retry with Exponential Backoff

When an LLM call fails validation or throws a transient error, the runtime retries with exponential backoff and jitter to avoid thundering-herd problems.

**Source**: [`RetryConfig`](../src/types.ts:131) · [`computeRetryDelay()`](../src/runtime.ts:44)

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDelay` | `number` | `1000` | Base delay in milliseconds |
| `maxDelay` | `number` | `30000` | Maximum delay cap in milliseconds |
| `jitterFactor` | `number` | `0.2` | Random jitter factor (0–1) to spread retries |

The delay formula is: `min(baseDelay × 2^attempt, maxDelay) + random × jitterFactor × delay`

### Usage

```typescript
import { LScriptRuntime } from "lmscript";

// Runtime-level config (applies to all functions)
const runtime = new LScriptRuntime({
  provider: myProvider,
  retryConfig: {
    baseDelay: 500,
    maxDelay: 15_000,
    jitterFactor: 0.3,
  },
});

// Per-function override
const AnalyzeSentiment = {
  name: "AnalyzeSentiment",
  model: "gpt-4o",
  system: "Analyze sentiment.",
  prompt: (text: string) => text,
  schema: z.object({ sentiment: z.string() }),
  maxRetries: 4,
  retryConfig: {
    baseDelay: 2000,   // Longer backoff for this function
    maxDelay: 60_000,
  },
};
```

Function-level `retryConfig` takes precedence over runtime-level, which takes precedence over the built-in defaults.

---

## 2. Request-Level Rate Limiting

[`RateLimiter`](../src/rate-limiter.ts:24) enforces requests-per-minute (RPM) and tokens-per-minute (TPM) limits using a sliding-window algorithm. It prevents exceeding provider quotas.

**Source**: [`RateLimiter`](../src/rate-limiter.ts:24) · [`RateLimitConfig`](../src/rate-limiter.ts:3)

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `requestsPerMinute` | `number` | unlimited | Maximum requests in a 60-second window |
| `tokensPerMinute` | `number` | unlimited | Maximum tokens in a 60-second window |

### Usage

```typescript
import { RateLimiter, LScriptRuntime } from "lmscript";

const rateLimiter = new RateLimiter({
  requestsPerMinute: 60,
  tokensPerMinute: 100_000,
});

const runtime = new LScriptRuntime({
  provider: myProvider,
  rateLimiter,
});

// The runtime automatically calls rateLimiter.acquire() before each API call
// and rateLimiter.reportTokens() after each response.
```

### How It Works

1. Before each LLM API call, [`acquire()`](../src/rate-limiter.ts:43) blocks until a slot is available.
2. After each call, [`reportTokens()`](../src/rate-limiter.ts:67) records the token count for TPM tracking.
3. Old entries outside the 60-second window are automatically pruned.
4. To reset all counters: `rateLimiter.reset()`.

---

## 3. Native Structured Output

Providers that support native JSON Schema structured output (e.g., OpenAI's `response_format: { type: "json_schema" }`) now use it automatically, bypassing the need for prompt-based schema injection.

**Source**: [`jsonSchema` on `LLMRequest`](../src/types.ts:62) · [`supportsStructuredOutput` on `LLMProvider`](../src/types.ts:86)

### How It Works

1. The runtime checks `provider.supportsStructuredOutput` before each call.
2. If `true`, the request includes `jsonSchema` with the function's Zod-derived schema.
3. The provider passes this schema to the API's native structured output mechanism.
4. Validation still runs after the response as a safety net.

### Provider Support Matrix

| Provider | `supportsStructuredOutput` |
|---|---|
| OpenAI | ✅ Yes |
| DeepSeek | ✅ Yes |
| OpenRouter | ✅ Yes |
| Anthropic | ❌ No (prompt-based) |
| Gemini | ❌ No (prompt-based) |
| Ollama | ❌ No (prompt-based) |
| LM Studio | ❌ No (prompt-based) |

### Usage

No explicit configuration needed — the runtime auto-detects provider support:

```typescript
import { OpenAIProvider, LScriptRuntime } from "lmscript";

const provider = new OpenAIProvider({ apiKey: "sk-..." });
// provider.supportsStructuredOutput === true

const runtime = new LScriptRuntime({ provider });

// The runtime automatically adds jsonSchema to the request
const result = await runtime.execute(myFunction, input);
```

---

## 4. Accurate Token Counting

[`estimateTokens()`](../src/tokenizer.ts:15) provides ~85–90% accurate BPE-like token estimation without external dependencies. For exact counts, plug in `tiktoken` or any custom counter.

**Source**: [`TokenCounter`](../src/tokenizer.ts:5) · [`estimateTokens()`](../src/tokenizer.ts:15) · [`simpleTokenEstimator()`](../src/tokenizer.ts:80)

### Built-in Estimators

| Function | Accuracy | Use Case |
|---|---|---|
| [`estimateTokens()`](../src/tokenizer.ts:15) | ~85–90% | Production (default) |
| [`simpleTokenEstimator()`](../src/tokenizer.ts:80) | ~60–70% | Testing, fast approximation |

### Usage

```typescript
import { estimateTokens, simpleTokenEstimator } from "lmscript";

// Default BPE-approximate estimator
const count = estimateTokens("Hello, world! This is a test.");
// ~8 tokens

// Simple character-based estimator (4 chars per token)
const simple = simpleTokenEstimator(4);
simple("Hello, world!"); // Math.ceil(13 / 4) = 4

// Custom counter with tiktoken
import { encoding_for_model } from "tiktoken";
const enc = encoding_for_model("gpt-4o");
const tiktokenCounter = (text: string) => enc.encode(text).length;
```

### Plugging Into ContextStack

```typescript
import { ContextStack } from "lmscript";

const ctx = new ContextStack({
  maxTokens: 4096,
  tokenCounter: estimateTokens,  // or your custom tiktoken counter
});
```

---

## 5. Multi-Modal Messages

Messages can now contain a mix of text and image content blocks, enabling vision capabilities with supported providers.

**Source**: [`ContentBlock`](../src/types.ts:39) · [`MessageContent`](../src/types.ts:42) · [`extractText()`](../src/content.ts:13) · [`toOpenAIContent()`](../src/content.ts:68) · [`toAnthropicContent()`](../src/content.ts:102)

### Content Block Types

| Type | Interface | Description |
|---|---|---|
| `text` | [`TextContent`](../src/types.ts:14) | Plain text content |
| `image_url` | [`ImageUrlContent`](../src/types.ts:20) | Image from a URL (with optional detail level) |
| `image_base64` | [`ImageBase64Content`](../src/types.ts:30) | Base64-encoded image data |

### Usage

```typescript
import type { ChatMessage, ContentBlock } from "lmscript";

const message: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "What's in this image?" },
    {
      type: "image_url",
      image_url: {
        url: "https://example.com/photo.jpg",
        detail: "high",
      },
    },
  ],
};

// Or with base64-encoded images
const messageB64: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "Describe this diagram." },
    {
      type: "image_base64",
      mediaType: "image/png",
      data: "iVBORw0KGgo...",
    },
  ],
};
```

### Extracting Text

For providers that don't support multi-modal or for token counting:

```typescript
import { extractText } from "lmscript";

const text = extractText(message.content);
// "What's in this image?"
```

### Provider Support

| Provider | `image_url` | `image_base64` |
|---|---|---|
| OpenAI | ✅ | ✅ (converted to data URI) |
| Anthropic | ❌ (skipped) | ✅ |
| Gemini | ❌ (skipped) | ✅ |
| Ollama | Via extractText fallback | Via extractText fallback |
| LM Studio | Via extractText fallback | Via extractText fallback |

---

## 6. Agent Loop Framework

The [`AgentLoop`](../src/agent.ts:47) enables iterative tool-calling workflows where the LLM is called repeatedly until it produces a final response without tool calls, or `maxIterations` is reached.

**Source**: [`AgentLoop`](../src/agent.ts:47) · [`AgentConfig`](../src/agent.ts:7) · [`AgentResult`](../src/agent.ts:20) · [`executeAgent()`](../src/runtime.ts:932)

### How It Works

1. The LLM is called with the function's tools.
2. If the response contains tool calls, each tool is executed.
3. Tool results are fed back as user messages.
4. The loop repeats until no tool calls are returned or `maxIterations` is reached.
5. The final response is validated against the function's schema.

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `maxIterations` | `number` | `10` | Maximum LLM call rounds |
| `onToolCall` | `(toolCall) => void \| boolean` | — | Callback after each tool; return `false` to stop |
| `onIteration` | `(iteration, response) => void \| boolean` | — | Callback after each LLM response; return `false` to stop |

### Usage

```typescript
import { AgentLoop, LScriptRuntime } from "lmscript";
import { z } from "zod";

const ResearchFn = {
  name: "Research",
  model: "gpt-4o",
  system: "You are a research assistant with access to tools.",
  prompt: (query: string) => `Research: ${query}`,
  schema: z.object({ answer: z.string(), sources: z.array(z.string()) }),
  tools: [searchTool, fetchTool],
};

// Option 1: Use AgentLoop class
const agent = new AgentLoop(runtime, {
  maxIterations: 5,
  onToolCall: (tc) => console.log(`Tool called: ${tc.name}`),
});
const result = await agent.run(ResearchFn, "What is quantum computing?");

// Option 2: Use runtime.executeAgent() directly
const result2 = await runtime.executeAgent(ResearchFn, "What is quantum computing?", {
  maxIterations: 5,
  onIteration: (iter, response) => {
    console.log(`Iteration ${iter}`);
    if (iter >= 3) return false; // Stop early
  },
});

console.log(result.data);        // { answer: "...", sources: [...] }
console.log(result.iterations);  // Number of LLM call rounds
console.log(result.toolCalls);   // All tool calls across all iterations
```

---

## 7. Circuit Breaker

[`CircuitBreaker`](../src/circuit-breaker.ts:39) prevents cascading failures by temporarily disabling failing providers. It integrates with [`FallbackProvider`](../src/providers/fallback.ts:53) for automatic failover.

**Source**: [`CircuitBreaker`](../src/circuit-breaker.ts:39) · [`CircuitBreakerConfig`](../src/circuit-breaker.ts:15) · [`FallbackProvider`](../src/providers/fallback.ts:53) · [`getProviderHealth()`](../src/providers/fallback.ts:214)

### Circuit States

| State | Description |
|---|---|
| **closed** | Normal operation — requests flow through |
| **open** | Circuit tripped — requests are blocked |
| **half-open** | Testing recovery — limited requests allowed |

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `failureThreshold` | `number` | `5` | Consecutive failures before opening |
| `resetTimeout` | `number` | `30000` | ms before transitioning open → half-open |
| `successThreshold` | `number` | `2` | Successes in half-open needed to close |

### Standalone Usage

```typescript
import { CircuitBreaker } from "lmscript";

const breaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 10_000,
  successThreshold: 1,
});

if (breaker.isAllowed()) {
  try {
    await callExternalService();
    breaker.recordSuccess();
  } catch {
    breaker.recordFailure();
  }
}

console.log(breaker.getState());        // "closed" | "open" | "half-open"
console.log(breaker.getFailureCount()); // number
```

### FallbackProvider Integration

```typescript
import { FallbackProvider, OpenAIProvider, AnthropicProvider } from "lmscript";

const fallback = new FallbackProvider(
  [
    new OpenAIProvider({ apiKey: "sk-..." }),
    new AnthropicProvider({ apiKey: "sk-ant-..." }),
  ],
  {
    retryDelay: 1000,
    circuitBreaker: {
      failureThreshold: 3,
      resetTimeout: 30_000,
      successThreshold: 2,
    },
  }
);

// Check health of all providers
const health = fallback.getProviderHealth();
// [{ name: "openai", state: "closed", failureCount: 0 },
//  { name: "anthropic", state: "closed", failureCount: 0 }]
```

When all circuits are open, `FallbackProvider` automatically tries the provider whose circuit has been open the longest (most likely to have recovered).

---

## 8. Prompt Versioning & A/B Testing

[`PromptRegistry`](../src/prompt-registry.ts:64) manages prompt variants for A/B testing, tracking performance metrics to identify the best-performing prompt configuration.

**Source**: [`PromptRegistry`](../src/prompt-registry.ts:64) · [`PromptVariant`](../src/prompt-registry.ts:8) · [`VariantMetrics`](../src/prompt-registry.ts:31)

### Selection Strategies

| Strategy | Description |
|---|---|
| `"weighted"` | Random selection weighted by `weight` property (default) |
| `"random"` | Equal probability random selection |
| `"round-robin"` | Sequential cycling through variants |

### Usage

```typescript
import { PromptRegistry } from "lmscript";

const registry = new PromptRegistry({ strategy: "weighted" });

// Register variants for a function
registry.registerVariants("AnalyzeSentiment", [
  {
    name: "control",
    system: "You are a sentiment analysis expert.",
    weight: 2,  // Twice as likely to be selected
  },
  {
    name: "concise",
    system: "Classify the sentiment. Be brief.",
    temperature: 0.3,
    weight: 1,
  },
  {
    name: "detailed",
    system: "Provide thorough sentiment analysis with reasoning.",
    temperature: 0.7,
    weight: 1,
  },
]);

// Select and apply a variant
const variant = registry.selectVariant("AnalyzeSentiment");
if (variant) {
  const variantFn = registry.applyVariant(AnalyzeSentiment, variant);
  // variantFn.name === "AnalyzeSentiment[control]"

  try {
    const result = await runtime.execute(variantFn, input);
    registry.recordResult("AnalyzeSentiment", variant.name, result);
  } catch {
    registry.recordFailure("AnalyzeSentiment", variant.name);
  }
}

// View performance metrics
const metrics = registry.getMetrics("AnalyzeSentiment");
for (const m of metrics) {
  console.log(`${m.name}: ${m.successRate * 100}% success, avg ${m.avgTokens} tokens`);
}

// Get the best-performing variant
const best = registry.getBestVariant("AnalyzeSentiment");
console.log(`Best variant: ${best?.name} (${best?.successRate * 100}% success)`);
```

### VariantMetrics Fields

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Variant name |
| `executions` | `number` | Total execution count |
| `successes` | `number` | Successful validations |
| `avgAttempts` | `number` | Average retries per execution |
| `avgTokens` | `number` | Average tokens per execution |
| `totalTokens` | `number` | Total tokens consumed |
| `successRate` | `number` | Success ratio (0–1) |

---

## 9. DSL Enhancements

The `.ls` DSL now supports **optional fields** (`?`) and **default values** (`= value`).

**Source**: [`TypeFieldNode.optional`](../src/dsl/ast.ts:6) · [`TypeFieldNode.defaultValue`](../src/dsl/ast.ts:7) · [`QUESTION` token](../src/dsl/lexer.ts:26) · [`parseTypeField()`](../src/dsl/parser.ts:74)

### Optional Fields

Mark a field as optional with `?` after the field name:

```
type SentimentResult = {
  sentiment: "positive" | "negative" | "neutral",
  confidence: number(min=0, max=1),
  reasoning?: string,         // optional — may be absent in output
  keywords?: string[],        // optional array
}
```

Optional fields compile to `.optional()` in the generated Zod schema.

### Default Values

Assign a default with `= value` after the type:

```
type AnalysisConfig = {
  language: string = "en",
  maxLength: number = 500,
  verbose: boolean = false,
}
```

Default values compile to `.default(value)` in the generated Zod schema. Supported value types: `string`, `number`, `boolean`.

### Combined Example

```
type ReviewResult = {
  score: number(min=1, max=5),
  summary: string(maxLength=200),
  language?: string = "en",      // optional with default
  tags?: string[],               // optional, no default
}

llm ReviewProduct(product: string) -> ReviewResult {
  model: "gpt-4o"
  temperature: 0.4
  system: "You review products."
  prompt: """
    Review the following product: {{product}}
  """
}
```

---

## 10. Embeddings & RAG Pipeline

Full-stack Retrieval-Augmented Generation with pluggable embedding providers and vector stores.

**Source**: [`EmbeddingProvider`](../src/embeddings.ts:4) · [`VectorStore`](../src/embeddings.ts:43) · [`MemoryVectorStore`](../src/embeddings.ts:101) · [`RAGPipeline`](../src/rag.ts:64) · [`OpenAIEmbeddingProvider`](../src/providers/openai-embeddings.ts:12)

### Architecture

```
Query → EmbeddingProvider.embed() → VectorStore.search() → Context → LLM
```

### Embedding Provider

```typescript
import { OpenAIEmbeddingProvider } from "lmscript";

const embedder = new OpenAIEmbeddingProvider({
  apiKey: "sk-...",
  // baseUrl: "https://custom-endpoint/v1/embeddings"  // optional
});

const vectors = await embedder.embed(["Hello world", "Goodbye world"]);
// vectors: number[][] — one vector per input text
```

### Vector Store

[`MemoryVectorStore`](../src/embeddings.ts:101) provides brute-force cosine similarity search (suitable for < 100k documents). Implement the [`VectorStore`](../src/embeddings.ts:43) interface for production stores (Pinecone, Weaviate, etc.).

```typescript
import { MemoryVectorStore } from "lmscript";

const store = new MemoryVectorStore();

await store.add([
  { id: "doc1", content: "LLMs are language models.", vector: [0.1, 0.2, ...] },
  { id: "doc2", content: "RAG improves accuracy.", vector: [0.3, 0.4, ...] },
]);

const results = await store.search(queryVector, 5); // top 5
// results: [{ document, score }]

await store.count();  // 2
await store.clear();
```

### RAG Pipeline

```typescript
import { RAGPipeline, MemoryVectorStore, LScriptRuntime } from "lmscript";
import { OpenAIEmbeddingProvider } from "lmscript";
import { z } from "zod";

const rag = new RAGPipeline(runtime, {
  embeddingProvider: new OpenAIEmbeddingProvider({ apiKey: "sk-..." }),
  vectorStore: new MemoryVectorStore(),
  topK: 5,
  minScore: 0.7,
});

// 1. Ingest documents (auto-embeds)
await rag.ingest([
  { id: "doc1", content: "LLMs are large language models trained on text." },
  { id: "doc2", content: "RAG combines retrieval with generation." },
  { id: "doc3", content: "Vector databases store embeddings.", metadata: { source: "wiki" } },
]);

// 2. Query with RAG-augmented context
const AnswerFn = {
  name: "Answer",
  model: "gpt-4o",
  system: "Answer the question using the provided context.",
  prompt: (q: string) => q,
  schema: z.object({ answer: z.string(), confidence: z.number() }),
};

const { result, retrievedDocuments, context } = await rag.query(
  AnswerFn,
  "What is RAG?"
);

console.log(result.data.answer);
console.log(`Retrieved ${retrievedDocuments.length} documents`);
```

### Custom Context Formatter

```typescript
const rag = new RAGPipeline(runtime, {
  embeddingProvider: embedder,
  vectorStore: store,
  formatContext: (results) =>
    results.map(r => `• ${r.document.content}`).join("\n"),
});
```

---

## 11. OpenTelemetry Integration

[`createTelemetryMiddleware()`](../src/telemetry.ts:102) produces middleware hooks that emit OpenTelemetry-compatible spans and metrics for every LLM execution — without requiring `@opentelemetry/*` as a hard dependency.

**Source**: [`createTelemetryMiddleware()`](../src/telemetry.ts:102) · [`OTelLogTransport`](../src/telemetry.ts:66) · [`TelemetryConfig`](../src/telemetry.ts:48)

### Emitted Telemetry

| Metric / Span | Type | Description |
|---|---|---|
| `{prefix}.execute` | Span | Wraps each execution with function name, model, attempts |
| `{prefix}.executions` | Counter | Execution count (by function, status) |
| `{prefix}.tokens` | Counter | Tokens used (by function, type: prompt/completion) |
| `{prefix}.duration` | Histogram | Execution duration in ms |
| `{prefix}.attempts` | Histogram | Retry attempts per execution |

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `tracer` | `TelemetryTracer` | — | OpenTelemetry-compatible tracer |
| `meter` | `TelemetryMeter` | — | OpenTelemetry-compatible meter |
| `metricPrefix` | `string` | `"lmscript"` | Prefix for all metric names |
| `includePrompts` | `boolean` | `false` | Include prompt content in span attributes |

### Usage

```typescript
import { createTelemetryMiddleware, OTelLogTransport, LScriptRuntime } from "lmscript";
import { MiddlewareManager } from "lmscript";

// With real OpenTelemetry SDK
import { trace, metrics } from "@opentelemetry/api";

const tracer = trace.getTracer("lmscript");
const meter = metrics.getMeter("lmscript");

const middleware = new MiddlewareManager();
middleware.use(createTelemetryMiddleware({
  tracer,
  meter,
  metricPrefix: "myapp.llm",
  includePrompts: false,  // Set true to capture prompts (may contain PII)
}));

const runtime = new LScriptRuntime({
  provider: myProvider,
  middleware,
});
```

### OTelLogTransport

Forward lmscript log entries to an OpenTelemetry span as events:

```typescript
import { Logger, LogLevel, OTelLogTransport } from "lmscript";

const otelTransport = new OTelLogTransport(tracer);

const logger = new Logger({
  level: LogLevel.INFO,
  transports: [otelTransport],
});

// Set the active span for log correlation
const span = tracer.startSpan("my-operation");
otelTransport.setActiveSpan(span);
// ... logs are now attached to this span
otelTransport.setActiveSpan(null); // detach
```

---

## 12. Batch Job Management

[`BatchManager`](../src/batch.ts:87) provides managed batch processing with job tracking, progress callbacks, cancellation support, and configurable concurrency.

**Source**: [`BatchManager`](../src/batch.ts:87) · [`BatchJob`](../src/batch.ts:39) · [`BatchManagerConfig`](../src/batch.ts:65) · [`BatchJobStatus`](../src/batch.ts:8)

### BatchManager vs executeBatch

| Feature | `runtime.executeBatch()` | `BatchManager` |
|---|---|---|
| Job tracking | ❌ | ✅ Status, progress, history |
| Cancellation | ❌ | ✅ `cancel(jobId)` |
| Progress callbacks | ❌ | ✅ `onProgress` |
| Delay between requests | ❌ | ✅ `delayBetweenRequests` |
| Error tolerance | Throws on first error | ✅ `continueOnError` |

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `5` | Max concurrent requests |
| `delayBetweenRequests` | `number` | `0` | Delay in ms between requests |
| `continueOnError` | `boolean` | `true` | Continue on individual failures |
| `onProgress` | `(job) => void` | — | Progress callback |

### Usage

```typescript
import { BatchManager, LScriptRuntime } from "lmscript";
import { z } from "zod";

const batch = new BatchManager(runtime, {
  concurrency: 3,
  delayBetweenRequests: 100,
  continueOnError: true,
  onProgress: (job) => {
    const pct = ((job.completedRequests + job.failedRequests) / job.totalRequests * 100).toFixed(0);
    console.log(`Job ${job.id}: ${pct}% complete`);
  },
});

// Submit a batch job (returns immediately)
const jobId = await batch.submit(ClassifyDoc, [
  { id: "req-1", input: "First document to classify" },
  { id: "req-2", input: "Second document to classify" },
  { id: "req-3", input: "Third document to classify" },
]);

// Check status
const status = batch.getJob(jobId);
console.log(status?.status); // "pending" | "processing" | "completed" | ...

// Wait for completion
const completed = await batch.waitForCompletion(jobId);
console.log(`Completed: ${completed.completedRequests}/${completed.totalRequests}`);
console.log(`Failed: ${completed.failedRequests}`);
console.log(`Total tokens: ${completed.totalUsage.totalTokens}`);

// Inspect individual results
for (const r of completed.results) {
  if (r.status === "success") {
    console.log(`${r.id}: ${JSON.stringify(r.data)}`);
  } else {
    console.error(`${r.id}: ${r.error}`);
  }
}

// Cancel a running job
batch.cancel(jobId);

// List all jobs, optionally filtered by status
const processing = batch.listJobs("processing");

// Clean up finished jobs
const removed = batch.cleanup();
```

### Job Lifecycle

```
pending → processing → completed
                     → failed
                     → cancelled
```

---

## See Also

- [Getting Started](./getting-started.md) — Installation and first function
- [User Guide](./user-guide.md) — Core concepts
- [API Reference](./api-reference.md) — Complete TypeScript API
- [Advanced Topics](./advanced.md) — Caching, cost tracking, sessions, logging
