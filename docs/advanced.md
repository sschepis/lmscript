# Advanced Topics

[← Back to Index](./README.md)

---

## Table of Contents

1. [Execution Cache](#execution-cache)
 2. [Cost Tracking](#cost-tracking)
 3. [Budget Enforcement](#budget-enforcement)
 4. [Structured Logging](#structured-logging)
 5. [Parallel Execution](#parallel-execution)
 6. [Conversational Sessions](#conversational-sessions)
 7. [Custom Cache Backends](#custom-cache-backends)
 8. [Custom Log Transports](#custom-log-transports)
 9. [Rate Limiting](#rate-limiting)
10. [Token Counting](#token-counting)
11. [Circuit Breaker](#circuit-breaker)
12. [Prompt A/B Testing](#prompt-ab-testing)
13. [Embeddings & RAG](#embeddings--rag)
14. [OpenTelemetry](#opentelemetry)
15. [Batch Processing](#batch-processing)
16. [Production Checklist](#production-checklist)

---

## Execution Cache

[`ExecutionCache`](../src/cache.ts:57) provides content-addressable memoization for LLM responses. When the same function is called with the same input, the cached result is returned instantly without making an API call.

### Setup

```typescript
import { ExecutionCache, MemoryCacheBackend, LScriptRuntime } from "lmscript";

const cache = new ExecutionCache(new MemoryCacheBackend());

const runtime = new LScriptRuntime({
  provider: myProvider,
  cache,
});
```

### How It Works

1. Before each execution, the cache generates a deterministic key from:
   - `fn.name`
   - `fn.model`
   - `fn.system`
   - `fn.prompt(input)` (the rendered prompt)
2. These components are joined with `|` and hashed using the djb2 algorithm
3. If a cached result exists, it's returned with `attempts: 0`
4. After successful execution, the result is stored in the cache

### Cache Key Computation

```typescript
const cache = new ExecutionCache(new MemoryCacheBackend());
const key = cache.computeKey(myFunction, "input text");
// "lmscript:a1b2c3d4" (djb2 hash)
```

The key depends on the full prompt (including input), so the same function with different inputs produces different keys.

### MemoryCacheBackend

[`MemoryCacheBackend`](../src/cache.ts:22) is the built-in in-memory cache using a `Map`. It supports TTL-based expiration:

```typescript
const backend = new MemoryCacheBackend();

// Manual operations
await backend.set("key", "value", 60_000); // TTL: 60 seconds
const val = await backend.get("key");       // "value" or null if expired
await backend.delete("key");
await backend.clear();
```

### Cache Invalidation

The cache doesn't auto-invalidate. You can:

- Clear the entire cache: `await backend.clear()`
- Delete specific entries: `await backend.delete(key)`
- Use TTL for time-based expiration (via `MemoryCacheBackend.set()` with `ttlMs`)
- Implement a custom backend with your own invalidation logic

---

## Cost Tracking

[`CostTracker`](../src/cost-tracker.ts:26) monitors token usage across all executions, with per-function breakdowns.

### Setup

```typescript
import { CostTracker, LScriptRuntime } from "lmscript";

const costTracker = new CostTracker();

const runtime = new LScriptRuntime({
  provider: myProvider,
  costTracker,
});
```

### Querying Usage

```typescript
// After executing functions...

// Total tokens across all functions
costTracker.getTotalTokens(); // number

// Per-function breakdown
const usage = costTracker.getUsageByFunction();
// Map<string, { calls, totalTokens, promptTokens, completionTokens }>

for (const [fnName, entry] of usage) {
  console.log(`${fnName}: ${entry.calls} calls, ${entry.totalTokens} tokens`);
}
```

### Cost Estimation

Pass a pricing map to estimate costs:

```typescript
const pricing = {
  "gpt-4o": { inputPer1k: 0.005, outputPer1k: 0.015 },
  "claude-sonnet-4-20250514": { inputPer1k: 0.003, outputPer1k: 0.015 },
};

const totalCost = costTracker.getTotalCost(pricing);
console.log(`Total cost: $${totalCost.toFixed(4)}`);
```

**Note**: Cost estimation uses function names as proxies for model names. For accurate cost tracking, align your function names with model names or implement custom tracking logic.

### Resetting

```typescript
costTracker.reset(); // Clear all tracked usage
```

---

## Budget Enforcement

The runtime can enforce budget limits to prevent runaway costs.

### Setup

```typescript
import { CostTracker, LScriptRuntime, BudgetExceededError } from "lmscript";

const costTracker = new CostTracker();

const runtime = new LScriptRuntime({
  provider: myProvider,
  costTracker,
  budget: {
    maxTotalTokens: 100_000,        // Hard limit on total tokens
    maxTokensPerExecution: 10_000,   // Per-execution limit
    maxTotalCost: 5.00,             // Maximum USD spend
    modelPricing: {
      "gpt-4o": { inputPer1k: 0.005, outputPer1k: 0.015 },
    },
  },
});
```

### Budget Checks

Budget is checked:
1. **Before** each execution (against current totals)
2. **After** each execution (against updated totals)

If a limit is exceeded, a [`BudgetExceededError`](../src/cost-tracker.ts:6) is thrown. This error is **never retried** — it propagates immediately.

### Handling Budget Errors

```typescript
try {
  const result = await runtime.execute(myFn, input);
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.error("Budget exceeded:", error.message);
    // "Token budget exceeded: 100500 tokens would exceed limit of 100000"
    // or: "Cost budget exceeded: $5.0234 exceeds limit of $5.0000"
  }
}
```

### BudgetConfig Options

| Option | Type | Description |
|---|---|---|
| `maxTotalTokens` | `number` | Maximum total tokens across all executions |
| `maxTokensPerExecution` | `number` | Maximum tokens per single execution |
| `maxTotalCost` | `number` | Maximum total cost in USD |
| `modelPricing` | `ModelPricing` | Per-model pricing for cost calculation |

---

## Structured Logging

[`Logger`](../src/logger.ts:120) provides structured logging with levels, transports, and spans for execution tracing.

### Setup

```typescript
import { Logger, ConsoleTransport, LogLevel, LScriptRuntime } from "lmscript";

const logger = new Logger({
  level: LogLevel.DEBUG,
  transports: [new ConsoleTransport()],
});

const runtime = new LScriptRuntime({
  provider: myProvider,
  logger,
});
```

### Log Levels

| Level | Value | Use For |
|---|---|---|
| `DEBUG` | 0 | Detailed debugging (attempt counts, schema diffs) |
| `INFO` | 1 | Normal operations (function start, validation pass) |
| `WARN` | 2 | Schema validation failures before retry |
| `ERROR` | 3 | Execution failures |
| `SILENT` | 4 | No logging |

Messages are only emitted if their level is ≥ the logger's configured level.

### Manual Logging

```typescript
logger.debug("Cache hit", { fn: "AnalyzeSentiment" });
logger.info("Processing batch", { count: 50 });
logger.warn("Rate limit approaching", { remaining: 10 });
logger.error("Provider failed", { provider: "openai", status: 500 });
```

### Spans

Spans represent timed operations, useful for tracing execution flow:

```typescript
const span = logger.startSpan("my-operation");
span.log(LogLevel.INFO, "Starting work", { step: 1 });

// ... do work ...

const { duration } = span.end();
console.log(`Operation took ${duration}ms`);
```

Spans automatically generate unique IDs and attach them to log entries for correlation.

### Runtime Logging

When a logger is configured, the runtime automatically logs:

- Function compilation (INFO)
- Target model (DEBUG)
- Each attempt (DEBUG)
- Schema validation pass/fail (INFO/WARN)
- Schema diff reports (DEBUG, when verbose or DEBUG level)
- Execution errors (ERROR)
- Span start/end (DEBUG)

---

## Parallel Execution

### `executeAll()` — Multiple Different Functions

Execute different functions concurrently using `Promise.allSettled()`:

```typescript
const results = await runtime.executeAll([
  { name: "sentiment", fn: AnalyzeSentiment, input: text },
  { name: "entities", fn: ExtractEntities, input: text },
  { name: "topic", fn: ClassifyTopic, input: text },
]);

// Results for all tasks, including failures
for (const task of results.tasks) {
  if (task.status === "fulfilled") {
    console.log(`${task.name}: ${JSON.stringify(task.result!.data)}`);
  } else {
    console.error(`${task.name} failed: ${task.error!.message}`);
  }
}

console.log(`${results.successCount}/${results.tasks.length} succeeded`);
console.log(`Total tokens: ${results.totalUsage.totalTokens}`);
```

`executeAll()` never throws — failures are captured in each task's result.

### `executeBatch()` — Same Function, Multiple Inputs

Execute the same function against many inputs with optional concurrency control:

```typescript
// Process all at once
const results = await runtime.executeBatch(ClassifyDoc, documents);

// Limit concurrency to 5 parallel requests
const results = await runtime.executeBatch(ClassifyDoc, documents, {
  concurrency: 5,
});
```

The concurrency limiter uses a semaphore pattern: worker coroutines pull from a shared index until all inputs are processed.

### Concurrency Behavior

| Scenario | Behavior |
|---|---|
| No `concurrency` option | All inputs execute simultaneously |
| `concurrency >= inputs.length` | All inputs execute simultaneously |
| `concurrency < inputs.length` | Semaphore-limited parallel execution |

---

## Conversational Sessions

[`Session`](../src/session.ts:13) manages multi-turn conversations with automatic context tracking.

### How Sessions Work

1. Each [`send()`](../src/session.ts:25) call:
   - Pushes the user prompt to the context stack
   - Gets the conversation history (all messages except the latest)
   - Calls `runtime.executeWithHistory()` with the history
   - Pushes the assistant's JSON response to the context stack
2. The context stack automatically prunes old messages when the token limit is reached
3. System messages are always preserved during pruning

### Session vs Direct Execution

| Feature | `runtime.execute()` | `session.send()` |
|---|---|---|
| Context | Stateless (each call independent) | Stateful (builds on history) |
| Memory management | Manual | Automatic via ContextStack |
| Token tracking | Manual | Automatic |
| Use case | One-shot tasks | Multi-turn conversations |

### Session with Summarization

```typescript
const ctx = new ContextStack({
  maxTokens: 4096,
  pruneStrategy: "summarize",
});

// Set up a summarizer using another LLM function
ctx.setSummarizer(async (messages) => {
  const text = messages.map(m => `${m.role}: ${m.content}`).join("\n");
  const result = await runtime.execute(SummarizeFn, text);
  return result.data.summary;
});

const session = new Session(runtime, ChatFn, ctx);
// Long conversations will be automatically summarized when context gets full
```

---

## Custom Cache Backends

Implement the [`CacheBackend`](../src/types.ts:217) interface for any storage system:

### Redis Example

```typescript
import type { CacheBackend } from "lmscript";
import { createClient } from "redis";

class RedisCacheBackend implements CacheBackend {
  private client;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      await this.client.setEx(key, Math.ceil(ttlMs / 1000), value);
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {
    // Careful: this clears ALL keys. Use a prefix in production.
    await this.client.flushDb();
  }
}

// Usage
const cache = new ExecutionCache(new RedisCacheBackend("redis://localhost:6379"));
```

### SQLite Example

```typescript
class SQLiteCacheBackend implements CacheBackend {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lmscript_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )
    `);
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare(
      "SELECT value, expires_at FROM lmscript_cache WHERE key = ?"
    ).get(key);
    if (!row) return null;
    if (row.expires_at && Date.now() > row.expires_at) {
      this.db.prepare("DELETE FROM lmscript_cache WHERE key = ?").run(key);
      return null;
    }
    return row.value;
  }

  // ... set, delete, clear implementations
}
```

---

## Custom Log Transports

Implement the [`LogTransport`](../src/logger.ts:28) interface for any output target:

### File Transport

```typescript
import type { LogTransport, LogEntry } from "lmscript";
import { appendFileSync } from "fs";

class FileTransport implements LogTransport {
  constructor(private filePath: string) {}

  write(entry: LogEntry): void {
    const line = JSON.stringify({
      time: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      message: entry.message,
      context: entry.context,
      spanId: entry.spanId,
    }) + "\n";
    appendFileSync(this.filePath, line);
  }
}

const logger = new Logger({
  level: LogLevel.INFO,
  transports: [
    new ConsoleTransport(),             // Console output
    new FileTransport("./lmscript.log"), // File output
  ],
});
```

### Metrics Transport

```typescript
class MetricsTransport implements LogTransport {
  write(entry: LogEntry): void {
    if (entry.context?.fn) {
      metrics.increment(`lmscript.${entry.context.fn}.${LogLevel[entry.level]}`);
    }
    if (entry.context?.duration) {
      metrics.histogram("lmscript.execution_duration", entry.context.duration as number);
    }
  }
}
```

---

## Rate Limiting

[`RateLimiter`](../src/rate-limiter.ts:24) enforces requests-per-minute (RPM) and tokens-per-minute (TPM) limits using a sliding-window approach. This prevents hitting API rate limits and incurring 429 errors.

### Setup

```typescript
import { RateLimiter, LScriptRuntime } from "lmscript";

const rateLimiter = new RateLimiter({
  requestsPerMinute: 60,     // Max 60 requests per 60-second window
  tokensPerMinute: 100_000,  // Max 100K tokens per 60-second window
});

const runtime = new LScriptRuntime({
  provider: myProvider,
  rateLimiter,
});
```

### How It Works

The rate limiter uses a 60-second sliding window:

1. **Before each request**, [`acquire()`](../src/rate-limiter.ts:43) checks if the request can proceed
2. If limits are reached, `acquire()` blocks (async sleep) until a slot opens
3. **After each request**, the runtime calls [`reportTokens()`](../src/rate-limiter.ts:67) to track token usage
4. Old entries outside the sliding window are automatically pruned

### Sliding Window

Unlike fixed windows that reset at boundaries (causing burst traffic), the sliding window continuously evaluates the last 60 seconds. If you made 60 requests spread over 60 seconds, the oldest request "ages out" first, opening a slot.

### Manual Usage

```typescript
const limiter = new RateLimiter({ requestsPerMinute: 10 });

// Wait until allowed
await limiter.acquire();

// Make your API call...
const result = await provider.chat(request);

// Report token usage
limiter.reportTokens(result.usage?.totalTokens ?? 0);

// Reset all counters
limiter.reset();
```

---

## Token Counting

L-Script provides a pluggable token counting system for accurate context window management.

### Built-in Estimator

[`estimateTokens()`](../src/tokenizer.ts:15) is the default token counter, providing ~85–90% accuracy vs tiktoken for English text without external dependencies:

```typescript
import { estimateTokens } from "lmscript";

const count = estimateTokens("Hello, how are you?"); // ~5
```

It handles:
- Whitespace splitting and punctuation boundaries
- CJK characters (each counts as ~1.5 tokens)
- Numbers (~3 digits per token)
- Subword estimation for long words (~4 chars per subword)

### Simple Estimator

[`simpleTokenEstimator()`](../src/tokenizer.ts:80) creates a basic character-based counter:

```typescript
import { simpleTokenEstimator } from "lmscript";

const counter = simpleTokenEstimator(4);  // 4 chars per token
const count = counter("Hello world");     // 3
```

### Custom Token Counter

Plug in any token counter (e.g., tiktoken) by implementing the [`TokenCounter`](../src/tokenizer.ts:5) type:

```typescript
import type { TokenCounter } from "lmscript";
import { encoding_for_model } from "tiktoken";

const enc = encoding_for_model("gpt-4o");
const tiktokenCounter: TokenCounter = (text) => enc.encode(text).length;

// Use in ContextStack
const ctx = new ContextStack({
  maxTokens: 8192,
  tokenCounter: tiktokenCounter,
});

// Use in content estimation
import { estimateContentTokens } from "lmscript";
const tokens = estimateContentTokens(message.content, tiktokenCounter);
```

---

## Circuit Breaker

[`CircuitBreaker`](../src/circuit-breaker.ts:39) prevents cascading failures by temporarily disabling a provider after repeated errors.

### States

```
[CLOSED] ──failures──→ [OPEN] ──timeout──→ [HALF-OPEN] ──success──→ [CLOSED]
                          ↑                      │
                          └──────failure──────────┘
```

- **Closed** — Normal operation; requests flow through
- **Open** — Circuit has tripped; requests are blocked for a cooldown period
- **Half-Open** — After the cooldown, a limited number of requests are allowed to test recovery

### Setup

```typescript
import { CircuitBreaker } from "lmscript";

const breaker = new CircuitBreaker({
  failureThreshold: 5,     // Open circuit after 5 consecutive failures
  resetTimeout: 30_000,    // Wait 30s before trying again (half-open)
  successThreshold: 2,     // Need 2 successes in half-open to close
});
```

### Usage with FallbackProvider

The [`FallbackProvider`](../src/providers/fallback.ts:30) uses circuit breakers internally via [`getProviderHealth()`](../src/providers/fallback.ts) to track which providers are healthy:

```typescript
import { FallbackProvider } from "lmscript";

const provider = new FallbackProvider([
  openaiProvider,
  anthropicProvider,
  ollamaProvider,
]);

// The fallback provider automatically:
// 1. Tries each provider in order
// 2. Tracks failures per provider
// 3. Skips providers with open circuits
// 4. Re-enables them after cooldown
```

### Manual Usage

```typescript
const breaker = new CircuitBreaker({ failureThreshold: 3 });

if (breaker.isAllowed()) {
  try {
    const result = await apiCall();
    breaker.recordSuccess();
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
} else {
  // Circuit is open — use fallback or throw
  throw new Error("Service unavailable (circuit open)");
}

// Check state
console.log(breaker.getState());        // "closed" | "open" | "half-open"
console.log(breaker.getFailureCount()); // number
```

---

## Prompt A/B Testing

[`PromptRegistry`](../src/prompt-registry.ts:64) enables A/B testing of prompt variants to find the best-performing configuration.

### Registering Variants

```typescript
import { PromptRegistry } from "lmscript";

const registry = new PromptRegistry({ strategy: "weighted" });

registry.registerVariants("AnalyzeSentiment", [
  {
    name: "control",
    system: "You are a sentiment analyst.",
    weight: 2,  // 2x more likely to be selected
  },
  {
    name: "detailed",
    system: "You are an expert sentiment analyst. Be thorough and consider nuance.",
    temperature: 0.3,
    weight: 1,
  },
  {
    name: "concise",
    system: "Classify sentiment. Be brief.",
    temperature: 0.1,
    weight: 1,
  },
]);
```

### Selection Strategies

| Strategy | Description |
|---|---|
| `"weighted"` | Random selection weighted by `weight` field (default) |
| `"random"` | Uniform random selection |
| `"round-robin"` | Cycle through variants in order |

### Running A/B Tests

```typescript
// Select and apply a variant
const variant = registry.selectVariant("AnalyzeSentiment");
if (variant) {
  const variantFn = registry.applyVariant(AnalyzeSentiment, variant);

  try {
    const result = await runtime.execute(variantFn, input);
    registry.recordResult("AnalyzeSentiment", variant.name, result);
  } catch (error) {
    registry.recordFailure("AnalyzeSentiment", variant.name);
  }
}
```

### Analyzing Results

```typescript
// Get metrics for all variants
const metrics = registry.getMetrics("AnalyzeSentiment");
for (const m of metrics) {
  console.log(`${m.name}: ${m.successRate * 100}% success, ${m.avgTokens} avg tokens`);
}

// Get the best performer
const best = registry.getBestVariant("AnalyzeSentiment");
console.log(`Best variant: ${best?.name} (${best?.successRate * 100}% success rate)`);

// Reset metrics for a new test cycle
registry.resetMetrics();
```

---

## Embeddings & RAG

L-Script provides a complete Retrieval-Augmented Generation (RAG) pipeline.

### Embedding Provider

[`EmbeddingProvider`](../src/embeddings.ts:4) is the interface for generating vector embeddings. The built-in [`OpenAIEmbeddingProvider`](../src/providers/openai-embeddings.ts:12) works with OpenAI and compatible APIs:

```typescript
import { OpenAIEmbeddingProvider } from "lmscript";

const embedder = new OpenAIEmbeddingProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Generate embeddings
const vectors = await embedder.embed(["Hello world", "How are you?"]);
// vectors[0] → number[] (1536-dimensional for text-embedding-3-small)
```

### Vector Store

[`MemoryVectorStore`](../src/embeddings.ts:101) is the built-in in-memory store using brute-force cosine similarity search:

```typescript
import { MemoryVectorStore } from "lmscript";

const store = new MemoryVectorStore();

// Add documents
await store.add([
  { id: "1", content: "TypeScript is a typed superset of JavaScript.", vector: [...] },
  { id: "2", content: "Zod is a TypeScript schema validation library.", vector: [...] },
]);

// Search
const results = await store.search(queryVector, 5);
// results[0] → { document: VectorDocument, score: 0.95 }

// Utilities
await store.count();   // 2
await store.delete(["1"]);
await store.clear();
```

For production, implement the [`VectorStore`](../src/embeddings.ts:43) interface with a dedicated vector database (Pinecone, Weaviate, Chroma, etc.).

### RAG Pipeline

[`RAGPipeline`](../src/rag.ts:64) combines embedding, retrieval, and generation in a single workflow:

```typescript
import { RAGPipeline, MemoryVectorStore, OpenAIEmbeddingProvider } from "lmscript";

const rag = new RAGPipeline(runtime, {
  embeddingProvider: new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  vectorStore: new MemoryVectorStore(),
  topK: 5,           // Retrieve top 5 documents
  minScore: 0.7,     // Only include documents with >0.7 similarity
});

// 1. Ingest documents (auto-embeds)
await rag.ingest([
  { id: "doc1", content: "L-Script is a typed LLM function library." },
  { id: "doc2", content: "Zod schemas validate LLM output." },
  { id: "doc3", content: "Providers abstract away different LLM APIs." },
]);

// 2. Query with RAG-augmented context
const result = await rag.query(
  AnswerQuestion,    // Your LScriptFunction
  "How does validation work?",
);

console.log(result.context);             // Retrieved context string
console.log(result.retrievedDocuments);  // Matched documents with scores
console.log(result.result.data);         // LLM's answer
```

### RAG Workflow

1. **Embed** the user's query using the embedding provider
2. **Search** the vector store for relevant documents
3. **Filter** by minimum similarity score
4. **Format** retrieved documents as numbered context
5. **Inject** context into the LLM function's system prompt
6. **Execute** the augmented function via the runtime

---

## OpenTelemetry

[`createTelemetryMiddleware()`](../src/telemetry.ts:102) integrates L-Script with OpenTelemetry-compatible observability tools without adding hard dependencies on `@opentelemetry/*` packages.

### Setup

```typescript
import { createTelemetryMiddleware, OTelLogTransport } from "lmscript";
import { MiddlewareManager, Logger, LScriptRuntime } from "lmscript";

// Import your OpenTelemetry SDK
import { trace, metrics } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
const meter = metrics.getMeter("my-app");

// Create telemetry middleware
const telemetryHooks = createTelemetryMiddleware({
  tracer,
  meter,
  metricPrefix: "lmscript",       // Prefix for metric names
  includePrompts: false,           // Don't include prompt content in spans (sensitive)
});

// Register middleware
const middleware = new MiddlewareManager();
middleware.use(telemetryHooks);

// Optional: Forward logs to OpenTelemetry
const otelTransport = new OTelLogTransport(tracer);
const logger = new Logger({ transports: [otelTransport] });

// Create runtime with telemetry
const runtime = new LScriptRuntime({
  provider: myProvider,
  middleware,
  logger,
});
```

### Emitted Spans

Each execution produces a span named `{prefix}.execute` with attributes:

| Attribute | Type | Description |
|---|---|---|
| `lmscript.function` | `string` | Function name |
| `lmscript.model` | `string` | Model identifier |
| `lmscript.attempts` | `number` | Number of attempts |
| `lmscript.duration_ms` | `number` | Execution duration |
| `lmscript.prompt_tokens` | `number` | Prompt token count |
| `lmscript.completion_tokens` | `number` | Completion token count |
| `lmscript.total_tokens` | `number` | Total token count |

### Emitted Metrics

| Metric | Type | Attributes | Description |
|---|---|---|---|
| `{prefix}.executions` | Counter | function, model, status | Execution count |
| `{prefix}.tokens` | Counter | function, model, type | Token usage |
| `{prefix}.duration` | Histogram | function, model | Execution duration (ms) |
| `{prefix}.attempts` | Histogram | function, model | Attempt count per execution |

### OTelLogTransport

[`OTelLogTransport`](../src/telemetry.ts:66) implements [`LogTransport`](../src/logger.ts:28) and forwards log entries to an OpenTelemetry tracer as span events:

```typescript
const transport = new OTelLogTransport(tracer);
transport.setActiveSpan(span);  // Attach logs to this span
logger.addTransport(transport);
```

---

## Batch Processing

[`BatchManager`](../src/batch.ts:87) provides managed batch processing with job tracking, progress callbacks, and cancellation — unlike the simpler [`executeBatch()`](../src/runtime.ts) which runs everything at once.

### Setup

```typescript
import { BatchManager } from "lmscript";

const batchManager = new BatchManager(runtime, {
  concurrency: 5,              // Max 5 parallel requests
  delayBetweenRequests: 100,   // 100ms between requests (for rate limiting)
  continueOnError: true,       // Don't abort on individual failures
  onProgress: (job) => {
    const pct = ((job.completedRequests + job.failedRequests) / job.totalRequests * 100).toFixed(0);
    console.log(`[${job.id}] ${pct}% complete`);
  },
});
```

### Submitting Jobs

```typescript
// Prepare batch requests with unique IDs
const requests = documents.map((doc, i) => ({
  id: `doc-${i}`,
  input: doc,
}));

// Submit returns immediately with a job ID
const jobId = await batchManager.submit(ClassifyDocument, requests);
console.log(`Batch job started: ${jobId}`);
```

### Waiting for Completion

```typescript
// Wait for the job to finish (polls every 100ms by default)
const job = await batchManager.waitForCompletion(jobId);

console.log(`Status: ${job.status}`);          // "completed" | "failed" | "cancelled"
console.log(`Completed: ${job.completedRequests}/${job.totalRequests}`);
console.log(`Failed: ${job.failedRequests}`);
console.log(`Total tokens: ${job.totalUsage.totalTokens}`);

// Access individual results
for (const result of job.results) {
  if (result.status === "success") {
    console.log(`${result.id}: ${JSON.stringify(result.data)}`);
  } else {
    console.error(`${result.id}: ${result.error}`);
  }
}
```

### Cancelling Jobs

```typescript
const cancelled = batchManager.cancel(jobId);
// Already-completed requests are preserved in the results
```

### Job Management

```typescript
// Check job status
const job = batchManager.getJob(jobId);

// List all jobs
const allJobs = batchManager.listJobs();
const runningJobs = batchManager.listJobs("processing");

// Clean up finished jobs
const removed = batchManager.cleanup();
```

### BatchManager vs executeBatch

| Feature | [`executeBatch()`](../src/runtime.ts) | [`BatchManager`](../src/batch.ts:87) |
|---|---|---|
| Job tracking | ❌ | ✅ (status, progress, results) |
| Progress callbacks | ❌ | ✅ |
| Cancellation | ❌ | ✅ |
| Delay between requests | ❌ | ✅ |
| Error tolerance | Throws on first error | Configurable (`continueOnError`) |
| Use case | Simple batch operations | Production batch processing |

---

## Production Checklist

### Essential Configuration

- [ ] **Provider**: Select and configure your primary provider
- [ ] **Fallback**: Set up [`FallbackProvider`](../src/providers/fallback.ts:30) for high availability
- [ ] **Router**: Use [`ModelRouter`](../src/router.ts:27) if using multiple models
- [ ] **Cache**: Enable [`ExecutionCache`](../src/cache.ts:57) to reduce duplicate API calls
- [ ] **Budget**: Configure budget limits to prevent runaway costs
- [ ] **Logging**: Set up [`Logger`](../src/logger.ts:120) with appropriate transports
- [ ] **Rate Limiting**: Configure [`RateLimiter`](../src/rate-limiter.ts:24) to avoid 429 errors
- [ ] **Telemetry**: Set up [`createTelemetryMiddleware()`](../src/telemetry.ts:102) for observability

### Reliability

- [ ] **Retries**: Set appropriate `maxRetries` per function (default: 2)
- [ ] **Retry Backoff**: Configure [`RetryConfig`](../src/types.ts:131) with exponential backoff and jitter
- [ ] **Circuit Breaker**: Use [`CircuitBreaker`](../src/circuit-breaker.ts:39) to prevent cascading failures
- [ ] **Temperature**: Use low temperature (0.1-0.3) for deterministic tasks
- [ ] **Schemas**: Make schemas as specific as possible (use `.min()`, `.max()`, enums)
- [ ] **Middleware**: Add monitoring hooks for latency, errors, and token usage

### Testing

- [ ] **Mock Provider**: Use [`MockProvider`](../src/testing/mock-provider.ts:20) in unit tests
- [ ] **Schema Diffs**: Validate LLM output shape with [`diffSchemaResult()`](../src/testing/schema-diff.ts:17)
- [ ] **Snapshots**: Track prompt changes with [`captureSnapshot()`](../src/testing/prompt-snapshot.ts:31)
- [ ] **Chaos Testing**: Test resilience with [`ChaosProvider`](../src/testing/chaos.ts:23)
- [ ] **Fuzz Testing**: Test schema validation with [`generateFuzzInputs()`](../src/testing/chaos.ts:91)
- [ ] **A/B Testing**: Use [`PromptRegistry`](../src/prompt-registry.ts:64) to compare prompt variants

### Performance

- [ ] **Concurrency**: Use `executeBatch()` with `concurrency` limits for bulk operations
- [ ] **Batch Manager**: Use [`BatchManager`](../src/batch.ts:87) for production batch processing with progress tracking
- [ ] **Streaming**: Use `executeStream()` for real-time token delivery
- [ ] **Context Pruning**: Configure [`ContextStack`](../src/context.ts:22) with appropriate token limits
- [ ] **Token Counting**: Use a custom [`TokenCounter`](../src/tokenizer.ts:5) (e.g., tiktoken) for accurate context management

---

## Next Steps

- [Getting Started](./getting-started.md) — Start building
- [User Guide](./user-guide.md) — Core concepts
- [API Reference](./api-reference.md) — Complete API documentation
- [New Features](./new-features.md) — Rate limiting, agent loops, RAG, telemetry
