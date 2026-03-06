# API Reference

[← Back to Index](./README.md)

---

## Table of Contents

1. [Core Runtime](#core-runtime)
 2. [Types & Interfaces](#types--interfaces)
 3. [Context & Sessions](#context--sessions)
 4. [Pipelines](#pipelines)
 5. [Transformers](#transformers)
 6. [Providers](#providers)
 7. [Router](#router)
 8. [Middleware](#middleware)
 9. [Cache](#cache)
10. [Cost Tracking](#cost-tracking)
11. [Logger](#logger)
12. [Rate Limiter](#rate-limiter)
13. [Token Counter](#token-counter)
14. [Content Utilities](#content-utilities)
15. [Agent Loop](#agent-loop)
16. [Circuit Breaker](#circuit-breaker)
17. [Prompt Registry](#prompt-registry)
18. [Embeddings](#embeddings)
19. [RAG Pipeline](#rag-pipeline)
20. [Telemetry](#telemetry)
21. [Batch Processing](#batch-processing)
22. [DSL](#dsl)
23. [Testing Utilities](#testing-utilities)
24. [CLI Utilities](#cli-utilities)

---

## Core Runtime

### `LScriptRuntime`

**Source**: [`src/runtime.ts:40`](../src/runtime.ts:40)

The core execution engine. Compiles [`LScriptFunction`](../src/types.ts:55) definitions into structured LLM calls.

#### Constructor

```typescript
new LScriptRuntime(config: RuntimeConfig)
```

| Parameter | Type | Description |
|---|---|---|
| `config` | [`RuntimeConfig`](#runtimeconfig) | Runtime configuration |

#### Methods

| Method | Signature | Description |
|---|---|---|
| `execute()` | `<I, O>(fn, input) → Promise<ExecutionResult<O>>` | Execute a typed LLM function |
| `executeStream()` | `<I, O>(fn, input) → StreamResult<O>` | Execute with streaming (returns sync) |
| `executeAll()` | `(tasks[]) → Promise<ParallelResult>` | Execute multiple tasks in parallel |
| `executeBatch()` | `<I, O>(fn, inputs[], options?) → Promise<ExecutionResult<O>[]>` | Execute same function on multiple inputs |
| `executeWithTransform()` | `<I, O, U>(fn, input, transformer) → Promise<ExecutionResult<U>>` | Execute with output transformation |
| `executeWithHistory()` | `<I, O>(fn, input, history) → Promise<ExecutionResult<O>>` | Execute with conversation history (internal) |
| `executeAgent()` | `<I, O>(fn, input, config?) → Promise<AgentResult<O>>` | Execute with iterative tool-calling agent loop |
| `createSession()` | `<I, O>(fn, contextOptions?) → Session<I, O>` | Create a conversational session |

#### `execute(fn, input)`

```typescript
async execute<I, O extends z.ZodType>(
  fn: LScriptFunction<I, O>,
  input: I
): Promise<ExecutionResult<z.infer<O>>>
```

Compiles and executes a typed LLM function. Handles schema injection, validation, retries, caching, cost tracking, middleware hooks, and tool calling.

**Throws**: `Error` on validation failure after all retries, [`BudgetExceededError`](#budgetexceedederror) on budget violation.

#### `executeStream(fn, input)`

```typescript
executeStream<I, O extends z.ZodType>(
  fn: LScriptFunction<I, O>,
  input: I
): StreamResult<z.infer<O>>
```

Returns synchronously with a [`StreamResult`](#streamresultt) containing an async iterable of tokens and a promise for the final validated result. Falls back to `execute()` if the provider doesn't support streaming.

#### `executeAll(tasks)`

```typescript
async executeAll(
  tasks: Array<{ name: string; fn: LScriptFunction<any, any>; input: any }>
): Promise<ParallelResult>
```

Executes all tasks concurrently via `Promise.allSettled()`. Never throws — failures are captured in the result.

#### `executeBatch(fn, inputs, options?)`

```typescript
async executeBatch<I, O extends z.ZodType>(
  fn: LScriptFunction<I, O>,
  inputs: I[],
  options?: { concurrency?: number }
): Promise<Array<ExecutionResult<z.infer<O>>>>
```

Executes the same function against multiple inputs. If `concurrency` is set, uses semaphore-based limiting. Otherwise runs all in parallel.

#### `executeWithTransform(fn, input, transformer)`

```typescript
async executeWithTransform<I, O extends z.ZodType, U>(
  fn: LScriptFunction<I, O>,
  input: I,
  transformer: OutputTransformer<z.infer<O>, U>
): Promise<ExecutionResult<U>>
```

Executes the function and applies a transformer to the validated output.

#### `createSession(fn, contextOptions?)`

```typescript
createSession<I, O extends z.ZodType>(
  fn: LScriptFunction<I, O>,
  contextOptions?: ContextStackOptions
): Session<I, O>
```

Creates a new [`Session`](#session) with an internal [`ContextStack`](#contextstack).

---

## Types & Interfaces

### `LScriptFunction<I, O>`

**Source**: [`src/types.ts:55`](../src/types.ts:55)

Defines a typed LLM call.

```typescript
interface LScriptFunction<I, O extends z.ZodType> {
  name: string;
  model: string;
  system: string;
  prompt: (input: I) => string;
  schema: O;
  temperature?: number;        // Default: 0.7
  maxRetries?: number;         // Default: 2
  examples?: Array<{ input: I; output: z.infer<O> }>;
  tools?: ToolDefinition[];
  retryConfig?: RetryConfig;   // Per-function retry backoff configuration
}
```

### `RuntimeConfig`

**Source**: [`src/types.ts:86`](../src/types.ts:86)

```typescript
interface RuntimeConfig {
  provider: LLMProvider;
  defaultTemperature?: number;   // Default: 0.7
  defaultMaxRetries?: number;    // Default: 2
  verbose?: boolean;             // Default: false
  middleware?: MiddlewareManager;
  cache?: ExecutionCache;
  costTracker?: CostTracker;
  budget?: BudgetConfig;
  logger?: Logger;
  retryConfig?: RetryConfig;    // Retry backoff configuration
  rateLimiter?: RateLimiter;    // API rate limiting
}
```

### `ExecutionResult<T>`

**Source**: [`src/types.ts:127`](../src/types.ts:127)

```typescript
interface ExecutionResult<T> {
  data: T;
  attempts: number;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolCalls?: ToolCall[];
}
```

### `StreamResult<T>`

**Source**: [`src/types.ts:143`](../src/types.ts:143)

```typescript
interface StreamResult<T> {
  stream: AsyncIterable<string>;
  result: Promise<ExecutionResult<T>>;
}
```

### `ChatMessage`

**Source**: [`src/types.ts:44`](../src/types.ts:44)

```typescript
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}
```

### `MessageContent`

**Source**: [`src/types.ts:42`](../src/types.ts:42)

```typescript
type MessageContent = string | ContentBlock[];
```

### `ContentBlock`

**Source**: [`src/types.ts:39`](../src/types.ts:39)

```typescript
type ContentBlock = TextContent | ImageUrlContent | ImageBase64Content;
```

### `TextContent`

**Source**: [`src/types.ts:14`](../src/types.ts:14)

```typescript
interface TextContent {
  type: "text";
  text: string;
}
```

### `ImageUrlContent`

**Source**: [`src/types.ts:20`](../src/types.ts:20)

```typescript
interface ImageUrlContent {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}
```

### `ImageBase64Content`

**Source**: [`src/types.ts:30`](../src/types.ts:30)

```typescript
interface ImageBase64Content {
  type: "image_base64";
  mediaType: string;
  data: string;
}
```

### `RetryConfig`

**Source**: [`src/types.ts:131`](../src/types.ts:131)

```typescript
interface RetryConfig {
  baseDelay?: number;       // Default: 1000
  maxDelay?: number;        // Default: 30000
  jitterFactor?: number;    // Default: 0.2
}
```

### `LLMProvider`

**Source**: [`src/types.ts:81`](../src/types.ts:81)

```typescript
interface LLMProvider {
  readonly name: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream?(request: LLMRequest): AsyncIterable<string>;
  readonly supportsStructuredOutput?: boolean;
}
```

The `supportsStructuredOutput` property indicates whether the provider supports native JSON Schema structured output via `response_format` with `json_schema` type. When `true` and a `jsonSchema` is present on the request, the provider will use native schema enforcement instead of relying solely on system-prompt injection.

### `LLMProviderConfig`

**Source**: [`src/types.ts:18`](../src/types.ts:18)

```typescript
interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
}
```

### `LLMRequest`

**Source**: [`src/types.ts:56`](../src/types.ts:56)

```typescript
interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  jsonMode: boolean;
  jsonSchema?: {
    name: string;
    schema: object;
    strict?: boolean;
  };
  tools?: Array<{ name: string; description: string; parameters: object }>;
}
```

The `jsonSchema` field enables native structured output on providers that support it. When set, providers with `supportsStructuredOutput: true` will use `response_format: { type: "json_schema", json_schema: { ... } }` for more reliable JSON output.

### `LLMResponse`

**Source**: [`src/types.ts:31`](../src/types.ts:31)

```typescript
interface LLMResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}
```

### `ToolDefinition<P, R>`

**Source**: [`src/types.ts:153`](../src/types.ts:153)

```typescript
interface ToolDefinition<P extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  description: string;
  parameters: P;
  execute: (params: z.infer<P>) => Promise<R> | R;
}
```

### `ToolCall`

**Source**: [`src/types.ts:160`](../src/types.ts:160)

```typescript
interface ToolCall {
  name: string;
  arguments: unknown;
  result: unknown;
}
```

### `ContextStackOptions`

**Source**: [`src/types.ts:179`](../src/types.ts:179)

```typescript
interface ContextStackOptions {
  maxTokens?: number;                     // Default: 4096
  pruneStrategy?: "fifo" | "summarize";   // Default: "fifo"
  tokenCounter?: TokenCounter;            // Custom token counter (default: built-in estimator)
}
```

### `BudgetConfig`

**Source**: [`src/types.ts:228`](../src/types.ts:228)

```typescript
interface BudgetConfig {
  maxTotalTokens?: number;
  maxTokensPerExecution?: number;
  maxTotalCost?: number;
  modelPricing?: ModelPricing;
}
```

### `ModelPricing`

**Source**: [`src/types.ts:226`](../src/types.ts:226)

```typescript
type ModelPricing = Record<string, { inputPer1k: number; outputPer1k: number }>;
```

### `ExecutionContext`

**Source**: [`src/types.ts:199`](../src/types.ts:199)

```typescript
interface ExecutionContext<I = unknown, O = unknown> {
  fn: LScriptFunction<I, any>;
  input: I;
  messages: ChatMessage[];
  attempt: number;
  startTime: number;
}
```

### `MiddlewareHooks`

**Source**: [`src/types.ts:207`](../src/types.ts:207)

```typescript
interface MiddlewareHooks {
  onBeforeExecute?: (ctx: ExecutionContext) => Promise<void> | void;
  onAfterValidation?: (ctx: ExecutionContext, result: unknown) => Promise<void> | void;
  onRetry?: (ctx: ExecutionContext, error: Error) => Promise<void> | void;
  onError?: (ctx: ExecutionContext, error: Error) => Promise<void> | void;
  onComplete?: (ctx: ExecutionContext, result: ExecutionResult<unknown>) => Promise<void> | void;
}
```

### `CacheBackend`

**Source**: [`src/types.ts:217`](../src/types.ts:217)

```typescript
interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

### `ParallelResult`

**Source**: [`src/types.ts:244`](../src/types.ts:244)

```typescript
interface ParallelResult {
  tasks: ParallelTaskResult[];
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  successCount: number;
  failureCount: number;
}
```

### `ParallelTaskResult`

**Source**: [`src/types.ts:237`](../src/types.ts:237)

```typescript
interface ParallelTaskResult {
  name: string;
  status: "fulfilled" | "rejected";
  result?: ExecutionResult<unknown>;
  error?: Error;
}
```

### `PipelineResult<T>`

**Source**: [`src/types.ts:182`](../src/types.ts:182)

```typescript
interface PipelineResult<T = unknown> {
  finalData: T;
  steps: PipelineStepResult[];
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

### `PipelineStepResult<T>`

**Source**: [`src/types.ts:168`](../src/types.ts:168)

```typescript
interface PipelineStepResult<T = unknown> {
  name: string;
  data: T;
  attempts: number;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

---

## Context & Sessions

### `ContextStack`

**Source**: [`src/context.ts:22`](../src/context.ts:22)

Manages conversation message history with automatic pruning.

| Method | Signature | Description |
|---|---|---|
| `constructor()` | `(options?: ContextStackOptions)` | Create with optional config |
| `push()` | `(message: ChatMessage) → Promise<void>` | Push a message (triggers prune) |
| `pushAll()` | `(messages: ChatMessage[]) → Promise<void>` | Push multiple messages |
| `getMessages()` | `() → ChatMessage[]` | Get all messages (copy) |
| `getTokenCount()` | `() → number` | Get estimated token count |
| `clear()` | `() → void` | Clear all messages |
| `setSummarizer()` | `(fn: SummarizerFn) → void` | Set summarizer for "summarize" strategy |
| `length` | `number` (getter) | Number of messages |

### `SummarizerFn`

**Source**: [`src/context.ts:12`](../src/context.ts:12)

```typescript
type SummarizerFn = (messages: ChatMessage[]) => Promise<string>;
```

### `Session<I, O>`

**Source**: [`src/session.ts:13`](../src/session.ts:13)

Multi-turn conversational session wrapping a runtime, function, and context stack.

| Method | Signature | Description |
|---|---|---|
| `constructor()` | `(runtime, fn, contextStack)` | Create session |
| `send()` | `(input: I) → Promise<ExecutionResult<O>>` | Send a message in the conversation |
| `getHistory()` | `() → ChatMessage[]` | Get conversation history |
| `clearHistory()` | `() → void` | Reset conversation |
| `getTokenCount()` | `() → number` | Estimated token count |

---

## Pipelines

### `Pipeline<TInput, TOutput>`

**Source**: [`src/pipeline.ts:25`](../src/pipeline.ts:25)

Chains multiple LScriptFunctions sequentially.

| Method | Signature | Description |
|---|---|---|
| `Pipeline.from()` | `(fn) → Pipeline<I, O>` | Create pipeline from first function |
| `pipe()` | `(fn) → Pipeline<TInput, NewOutput>` | Append a function |
| `execute()` | `(runtime, input) → Promise<PipelineResult<TOutput>>` | Run the pipeline |

---

## Transformers

### `OutputTransformer<T, U>`

**Source**: [`src/transformer.ts:10`](../src/transformer.ts:10)

```typescript
type OutputTransformer<T, U> = (data: T) => U | Promise<U>;
```

### Functions

| Function | Signature | Description |
|---|---|---|
| `withTransform()` | `(fn, transformer) → { fn, transformer }` | Wrap function with transformer |
| `composeTransformers()` | `(...transformers) → OutputTransformer` | Compose transformers left-to-right |
| `trimStringsTransformer` | `OutputTransformer<unknown, unknown>` | Recursively trim all strings |
| `dateStringTransformer` | `OutputTransformer<unknown, unknown>` | Convert ISO date strings to Date |

---

## Providers

### `BaseLLMProvider`

**Source**: [`src/providers/base.ts:8`](../src/providers/base.ts:8)

Abstract base class. Subclasses implement `defaultBaseUrl()`, `buildRequestBody()`, `parseResponse()`.

### `OpenAIProvider`

**Source**: [`src/providers/openai.ts:29`](../src/providers/openai.ts:29)

```typescript
new OpenAIProvider(config: LLMProviderConfig)
```

Supports: `chat()`, `chatStream()`, JSON mode, tool calling.

### `AnthropicProvider`

**Source**: [`src/providers/anthropic.ts:22`](../src/providers/anthropic.ts:22)

```typescript
new AnthropicProvider(config: LLMProviderConfig)
```

Supports: `chat()`, `chatStream()`. Uses `x-api-key` header.

### `GeminiProvider`

**Source**: [`src/providers/gemini.ts:37`](../src/providers/gemini.ts:37)

```typescript
new GeminiProvider(config: LLMProviderConfig)
```

Supports: `chat()`, `chatStream()`. API key in URL, dynamic endpoint.

### `OllamaProvider`

**Source**: [`src/providers/ollama.ts:23`](../src/providers/ollama.ts:23)

```typescript
new OllamaProvider(config: LLMProviderConfig)
```

Supports: `chat()`, `chatStream()`. No auth. JSON format via `format: "json"`.

### `LMStudioProvider`

**Source**: [`src/providers/lmstudio.ts:42`](../src/providers/lmstudio.ts:42)

```typescript
new LMStudioProvider(config?: Partial<LLMProviderConfig>)
```

Supports: `chat()`, `chatStream()`, tool calling. OpenAI-compatible. Omits `response_format`.

### `FallbackProvider`

**Source**: [`src/providers/fallback.ts:30`](../src/providers/fallback.ts:30)

```typescript
new FallbackProvider(providers: LLMProvider[], options?: { retryDelay?: number })
```

Tries each provider in order. Throws [`AllProvidersFailedError`](#allprovidersfailederror) if all fail.

### `AllProvidersFailedError`

**Source**: [`src/providers/fallback.ts:8`](../src/providers/fallback.ts:8)

```typescript
class AllProvidersFailedError extends Error {
  readonly errors: Array<{ provider: string; error: Error }>;
}
```

### `OpenAIEmbeddingProvider`

**Source**: [`src/providers/openai-embeddings.ts:12`](../src/providers/openai-embeddings.ts:12)

Implements [`EmbeddingProvider`](#embeddingprovider). Works with OpenAI, Azure OpenAI, and any OpenAI-compatible embedding API.

```typescript
new OpenAIEmbeddingProvider(config: { apiKey: string; baseUrl?: string })
```

| Method | Signature | Description |
|---|---|---|
| `embed()` | `(texts: string[], model?: string) → Promise<number[][]>` | Generate embeddings for one or more texts |

Default model: `text-embedding-3-small`. Default base URL: `https://api.openai.com/v1/embeddings`.

---

## Router

### `ModelRouter`

**Source**: [`src/router.ts:27`](../src/router.ts:27)

Implements [`LLMProvider`](#llmprovider). Routes requests based on pattern-matching rules.

```typescript
new ModelRouter(config: { rules: RoutingRule[]; defaultProvider: LLMProvider })
```

| Method | Description |
|---|---|
| `chat(request)` | Route and execute |
| `chatStream(request)` | Route and stream |
| `addRule(rule)` | Add a routing rule |
| `removeRule(match)` | Remove rules by match value |
| `resolveProvider(fn)` | Resolve provider for a function (without executing) |

### `RoutingRule`

**Source**: [`src/router.ts:10`](../src/router.ts:10)

```typescript
interface RoutingRule {
  match: string | RegExp | ((fn: LScriptFunction<any, any>) => boolean);
  provider: LLMProvider;
  modelOverride?: string;
}
```

---

## Middleware

### `MiddlewareManager`

**Source**: [`src/middleware.ts:14`](../src/middleware.ts:14)

| Method | Description |
|---|---|
| `use(hooks)` | Register middleware hooks |
| `remove(hooks)` | Unregister middleware hooks |
| `runBeforeExecute(ctx)` | Run all `onBeforeExecute` hooks |
| `runAfterValidation(ctx, result)` | Run all `onAfterValidation` hooks |
| `runRetry(ctx, error)` | Run all `onRetry` hooks |
| `runError(ctx, error)` | Run all `onError` hooks |
| `runComplete(ctx, result)` | Run all `onComplete` hooks |

---

## Cache

### `ExecutionCache`

**Source**: [`src/cache.ts:57`](../src/cache.ts:57)

Content-addressable memoization for LLM responses.

```typescript
new ExecutionCache(backend: CacheBackend)
```

| Method | Signature | Description |
|---|---|---|
| `computeKey()` | `(fn, input) → string` | Generate deterministic cache key |
| `getCached()` | `(fn, input) → Promise<ExecutionResult \| null>` | Retrieve cached result |
| `setCached()` | `(fn, input, result) → Promise<void>` | Store result in cache |

Cache key is based on: `fn.name + fn.model + fn.system + fn.prompt(input)`, hashed with djb2.

### `MemoryCacheBackend`

**Source**: [`src/cache.ts:22`](../src/cache.ts:22)

In-memory cache backend using a `Map` with optional TTL support.

```typescript
new MemoryCacheBackend()
```

Implements [`CacheBackend`](#cachebackend): `get()`, `set()`, `delete()`, `clear()`.

---

## Cost Tracking

### `CostTracker`

**Source**: [`src/cost-tracker.ts:26`](../src/cost-tracker.ts:26)

Tracks token usage and cost per function.

```typescript
new CostTracker()
```

| Method | Signature | Description |
|---|---|---|
| `trackUsage()` | `(fnName, usage) → void` | Record token usage |
| `getTotalTokens()` | `() → number` | Get total tokens consumed |
| `getTotalCost()` | `(modelPricing?) → number` | Estimate total cost (USD) |
| `getUsageByFunction()` | `() → Map<string, UsageEntry>` | Per-function breakdown |
| `reset()` | `() → void` | Clear all tracked data |
| `checkBudget()` | `(budget, additionalTokens?) → void` | Check and enforce budget |

### `BudgetExceededError`

**Source**: [`src/cost-tracker.ts:6`](../src/cost-tracker.ts:6)

```typescript
class BudgetExceededError extends Error {
  name: "BudgetExceededError";
}
```

Thrown when `maxTotalTokens`, `maxTokensPerExecution`, or `maxTotalCost` limits are exceeded.

---

## Logger

### `Logger`

**Source**: [`src/logger.ts:120`](../src/logger.ts:120)

Structured logging with transports and spans.

```typescript
new Logger(options?: LoggerOptions)
```

| Method | Description |
|---|---|
| `debug(message, context?)` | Log at DEBUG level |
| `info(message, context?)` | Log at INFO level |
| `warn(message, context?)` | Log at WARN level |
| `error(message, context?)` | Log at ERROR level |
| `startSpan(name)` | Create a new [`Span`](#span) |
| `addTransport(transport)` | Add a log transport |
| `getLevel()` | Get current log level |

### `LoggerOptions`

**Source**: [`src/logger.ts:115`](../src/logger.ts:115)

```typescript
interface LoggerOptions {
  level?: LogLevel;            // Default: LogLevel.INFO
  transports?: LogTransport[]; // Default: [ConsoleTransport]
}
```

### `LogLevel`

**Source**: [`src/logger.ts:7`](../src/logger.ts:7)

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}
```

### `Span`

**Source**: [`src/logger.ts:89`](../src/logger.ts:89)

Represents a timed operation span.

| Property/Method | Type | Description |
|---|---|---|
| `id` | `string` | Unique span ID (hex) |
| `name` | `string` | Span name |
| `startTime` | `number` | Start timestamp |
| `log(level, message, context?)` | method | Log within this span |
| `end()` | method | End span, returns `{ duration }` |

### `ConsoleTransport`

**Source**: [`src/logger.ts:52`](../src/logger.ts:52)

Default transport that writes colorized log entries to the console.

### `LogEntry`

**Source**: [`src/logger.ts:17`](../src/logger.ts:17)

```typescript
interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  spanId?: string;
  traceId?: string;
}
```

### `LogTransport`

**Source**: [`src/logger.ts:28`](../src/logger.ts:28)

```typescript
interface LogTransport {
  write(entry: LogEntry): void;
}
```

---

## Rate Limiter

### `RateLimiter`

**Source**: [`src/rate-limiter.ts:24`](../src/rate-limiter.ts:24)

A sliding-window rate limiter that enforces requests-per-minute (RPM) and tokens-per-minute (TPM) limits.

```typescript
new RateLimiter(config: RateLimitConfig)
```

| Method | Signature | Description |
|---|---|---|
| `acquire()` | `() → Promise<void>` | Wait until a request is allowed under rate limits |
| `reportTokens()` | `(count: number) → void` | Report tokens used after a request completes |
| `reset()` | `() → void` | Reset all counters and timestamps |

### `RateLimitConfig`

**Source**: [`src/rate-limiter.ts:3`](../src/rate-limiter.ts:3)

```typescript
interface RateLimitConfig {
  requestsPerMinute?: number;   // Default: unlimited
  tokensPerMinute?: number;     // Default: unlimited
}
```

---

## Token Counter

### `TokenCounter`

**Source**: [`src/tokenizer.ts:5`](../src/tokenizer.ts:5)

```typescript
type TokenCounter = (text: string) => number;
```

A function that takes a string and returns the estimated number of tokens.

### `estimateTokens(text)`

**Source**: [`src/tokenizer.ts:15`](../src/tokenizer.ts:15)

```typescript
function estimateTokens(text: string): number
```

Built-in token estimator based on a word/subword model. Approximates BPE tokenization without external dependencies (~85–90% accuracy vs tiktoken for English text). Handles whitespace, punctuation, CJK characters, and numbers.

### `simpleTokenEstimator(charsPerToken?)`

**Source**: [`src/tokenizer.ts:80`](../src/tokenizer.ts:80)

```typescript
function simpleTokenEstimator(charsPerToken?: number): TokenCounter
```

Creates a simple character-based estimator. Default: 4 chars per token. Useful for testing or when accuracy isn't critical.

---

## Content Utilities

**Source**: [`src/content.ts`](../src/content.ts)

Utilities for working with multi-modal [`MessageContent`](#messagecontent).

### `extractText(content)`

**Source**: [`src/content.ts:13`](../src/content.ts:13)

```typescript
function extractText(content: MessageContent): string
```

Extract text content from a `MessageContent` value. Joins text blocks with newlines; ignores image blocks. For providers that don't support multi-modal and for token estimation.

### `estimateContentTokens(content, textTokenCounter)`

**Source**: [`src/content.ts:44`](../src/content.ts:44)

```typescript
function estimateContentTokens(
  content: MessageContent,
  textTokenCounter: (text: string) => number
): number
```

Estimate total tokens for a `MessageContent` value. For strings, delegates to the text counter. For content block arrays, sums text tokens + image token estimates (~85 tokens for low detail, ~765 for high detail).

### `toOpenAIContent(content)`

**Source**: [`src/content.ts:68`](../src/content.ts:68)

```typescript
function toOpenAIContent(content: MessageContent): string | Array<Record<string, unknown>>
```

Convert `MessageContent` to OpenAI's native format. Base64 images become data URI `image_url` blocks.

### `toAnthropicContent(content)`

**Source**: [`src/content.ts:102`](../src/content.ts:102)

```typescript
function toAnthropicContent(content: MessageContent): string | Array<Record<string, unknown>>
```

Convert `MessageContent` to Anthropic's native format. URL images are not supported and are skipped.

### `toGeminiParts(content)`

**Source**: [`src/content.ts:136`](../src/content.ts:136)

```typescript
function toGeminiParts(content: MessageContent): Array<Record<string, unknown>>
```

Convert `MessageContent` to Gemini's parts format. URL images are not supported and are skipped.

---

## Agent Loop

### `AgentLoop`

**Source**: [`src/agent.ts:47`](../src/agent.ts:47)

Provides iterative tool-calling execution. Repeatedly calls the LLM until it produces a final text response (no more tool calls) or `maxIterations` is reached.

```typescript
new AgentLoop(runtime: LScriptRuntime, config?: AgentConfig)
```

| Method | Signature | Description |
|---|---|---|
| `run()` | `<I, O>(fn, input) → Promise<AgentResult<O>>` | Execute a function with iterative tool calling |

### `AgentConfig`

**Source**: [`src/agent.ts:7`](../src/agent.ts:7)

```typescript
interface AgentConfig {
  maxIterations?: number;    // Default: 10
  onToolCall?: (toolCall: ToolCall) => void | boolean | Promise<void | boolean>;
  onIteration?: (iteration: number, response: string) => void | boolean | Promise<void | boolean>;
}
```

### `AgentResult<T>`

**Source**: [`src/agent.ts:20`](../src/agent.ts:20)

```typescript
interface AgentResult<T> {
  data: T;
  toolCalls: ToolCall[];
  iterations: number;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

---

## Circuit Breaker

### `CircuitBreaker`

**Source**: [`src/circuit-breaker.ts:39`](../src/circuit-breaker.ts:39)

Tracks consecutive failures and temporarily disables a resource when the failure threshold is reached, then gradually re-enables it after a cooldown period.

```typescript
new CircuitBreaker(config?: CircuitBreakerConfig)
```

| Method | Signature | Description |
|---|---|---|
| `isAllowed()` | `() → boolean` | Check if a request is allowed through the circuit |
| `recordSuccess()` | `() → void` | Record a successful request |
| `recordFailure()` | `() → void` | Record a failed request |
| `getState()` | `() → CircuitState` | Get the current circuit state |
| `getFailureCount()` | `() → number` | Get the current failure count |
| `getLastFailureTime()` | `() → number` | Get timestamp of last failure |
| `reset()` | `() → void` | Manually reset to closed state |

### `CircuitBreakerConfig`

**Source**: [`src/circuit-breaker.ts:15`](../src/circuit-breaker.ts:15)

```typescript
interface CircuitBreakerConfig {
  failureThreshold?: number;   // Default: 5
  resetTimeout?: number;       // Default: 30000 (30s)
  successThreshold?: number;   // Default: 2
}
```

### `CircuitState`

**Source**: [`src/circuit-breaker.ts:10`](../src/circuit-breaker.ts:10)

```typescript
type CircuitState = "closed" | "open" | "half-open";
```

- **closed** — Normal operation; requests flow through
- **open** — Circuit has tripped; requests are blocked
- **half-open** — Testing recovery; limited requests are allowed

---

## Prompt Registry

### `PromptRegistry`

**Source**: [`src/prompt-registry.ts:64`](../src/prompt-registry.ts:64)

Manages prompt variants for A/B testing and tracks their performance.

```typescript
new PromptRegistry(config?: PromptRegistryConfig)
```

| Method | Signature | Description |
|---|---|---|
| `registerVariants()` | `(functionName, variants[]) → void` | Register variants for a function |
| `selectVariant()` | `(functionName) → PromptVariant \| undefined` | Select a variant based on strategy |
| `applyVariant()` | `(fn, variant) → LScriptFunction` | Apply a variant to a function |
| `recordResult()` | `(functionName, variantName, result) → void` | Record execution result for a variant |
| `recordFailure()` | `(functionName, variantName) → void` | Record a failed execution |
| `getMetrics()` | `(functionName) → VariantMetrics[]` | Get metrics for all variants |
| `getBestVariant()` | `(functionName) → VariantMetrics \| undefined` | Get best-performing variant |
| `resetMetrics()` | `() → void` | Reset all metrics |
| `hasVariants()` | `(functionName) → boolean` | Check if variants are registered |

### `PromptVariant<I>`

**Source**: [`src/prompt-registry.ts:8`](../src/prompt-registry.ts:8)

```typescript
interface PromptVariant<I = unknown> {
  name: string;
  prompt?: (input: I) => string;
  system?: string;
  temperature?: number;
  model?: string;
  weight?: number;              // Default: 1
}
```

### `VariantMetrics`

**Source**: [`src/prompt-registry.ts:31`](../src/prompt-registry.ts:31)

```typescript
interface VariantMetrics {
  name: string;
  executions: number;
  successes: number;
  avgAttempts: number;
  avgTokens: number;
  totalTokens: number;
  successRate: number;          // 0-1
}
```

### `SelectionStrategy`

**Source**: [`src/prompt-registry.ts:51`](../src/prompt-registry.ts:51)

```typescript
type SelectionStrategy = "random" | "round-robin" | "weighted";
```

---

## Embeddings

### `EmbeddingProvider`

**Source**: [`src/embeddings.ts:4`](../src/embeddings.ts:4)

```typescript
interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[], model?: string): Promise<number[][]>;
}
```

### `VectorStore`

**Source**: [`src/embeddings.ts:43`](../src/embeddings.ts:43)

```typescript
interface VectorStore {
  add(documents: VectorDocument[]): Promise<void>;
  search(queryVector: number[], topK?: number): Promise<VectorSearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}
```

### `MemoryVectorStore`

**Source**: [`src/embeddings.ts:101`](../src/embeddings.ts:101)

In-memory vector store using brute-force cosine similarity search. Suitable for small-to-medium collections (< 100k documents).

```typescript
new MemoryVectorStore()
```

Implements [`VectorStore`](#vectorstore).

### `cosineSimilarity(a, b)`

**Source**: [`src/embeddings.ts:76`](../src/embeddings.ts:76)

```typescript
function cosineSimilarity(a: number[], b: number[]): number
```

Compute cosine similarity between two vectors. Returns a value between -1 and 1. Throws if vector dimensions don't match.

### `VectorDocument`

**Source**: [`src/embeddings.ts:19`](../src/embeddings.ts:19)

```typescript
interface VectorDocument {
  id: string;
  content: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}
```

### `VectorSearchResult`

**Source**: [`src/embeddings.ts:33`](../src/embeddings.ts:33)

```typescript
interface VectorSearchResult {
  document: VectorDocument;
  score: number;                // 0-1, higher is better
}
```

---

## RAG Pipeline

### `RAGPipeline`

**Source**: [`src/rag.ts:64`](../src/rag.ts:64)

Retrieval-Augmented Generation pipeline. Embeds a query, searches a vector store, formats retrieved context, and injects it into an LLM function's system prompt.

```typescript
new RAGPipeline(runtime: LScriptRuntime, config: RAGConfig)
```

| Method | Signature | Description |
|---|---|---|
| `ingest()` | `(documents[]) → Promise<void>` | Ingest documents into the vector store (auto-embeds) |
| `query()` | `<I, O>(fn, input, queryText?) → Promise<RAGResult<O>>` | Execute with RAG-augmented context |

### `RAGConfig`

**Source**: [`src/rag.ts:9`](../src/rag.ts:9)

```typescript
interface RAGConfig {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  topK?: number;                // Default: 5
  minScore?: number;            // Default: 0
  embeddingModel?: string;
  formatContext?: (results: VectorSearchResult[]) => string;
}
```

### `RAGResult<T>`

**Source**: [`src/rag.ts:32`](../src/rag.ts:32)

```typescript
interface RAGResult<T> {
  result: ExecutionResult<T>;
  retrievedDocuments: VectorSearchResult[];
  context: string;
}
```

---

## Telemetry

### `createTelemetryMiddleware(config)`

**Source**: [`src/telemetry.ts:102`](../src/telemetry.ts:102)

```typescript
function createTelemetryMiddleware(config: TelemetryConfig): MiddlewareHooks
```

Creates middleware hooks that emit OpenTelemetry-compatible spans and metrics for each LLM execution. Returns standard [`MiddlewareHooks`](#middlewarehooks) that can be registered with a [`MiddlewareManager`](#middlewaremanager).

**Emitted spans**: `{prefix}.execute` — wraps each execution with function name, model, attempt count.

**Emitted metrics**:
- `{prefix}.executions` — counter of executions (by function, status)
- `{prefix}.tokens` — counter of tokens used (by function, type)
- `{prefix}.duration` — histogram of execution duration (by function)
- `{prefix}.attempts` — histogram of attempt count (by function)

### `TelemetryConfig`

**Source**: [`src/telemetry.ts:48`](../src/telemetry.ts:48)

```typescript
interface TelemetryConfig {
  tracer?: TelemetryTracer;
  meter?: TelemetryMeter;
  metricPrefix?: string;        // Default: "lmscript"
  includePrompts?: boolean;     // Default: false
}
```

### `OTelLogTransport`

**Source**: [`src/telemetry.ts:66`](../src/telemetry.ts:66)

OpenTelemetry-compatible log transport. Forwards lmscript log entries to an OpenTelemetry tracer as span events.

```typescript
new OTelLogTransport(tracer: TelemetryTracer)
```

| Method | Signature | Description |
|---|---|---|
| `setActiveSpan()` | `(span: TelemetrySpan \| null) → void` | Set the active span for log attachment |
| `write()` | `(entry: LogEntry) → void` | Write a log entry as a span event |

Implements [`LogTransport`](#logtransport).

---

## Batch Processing

### `BatchManager`

**Source**: [`src/batch.ts:87`](../src/batch.ts:87)

Handles async batch processing of LLM requests with job tracking, configurable concurrency, error tolerance, progress callbacks, and cancellation.

```typescript
new BatchManager(runtime: LScriptRuntime, config?: BatchManagerConfig)
```

| Method | Signature | Description |
|---|---|---|
| `submit()` | `<I, O>(fn, requests[]) → Promise<string>` | Submit a batch job (returns job ID) |
| `getJob()` | `(jobId) → BatchJob \| undefined` | Get current status of a batch job |
| `waitForCompletion()` | `<T>(jobId, pollIntervalMs?) → Promise<BatchJob<T>>` | Wait for a batch job to complete |
| `cancel()` | `(jobId) → boolean` | Cancel a running batch job |
| `listJobs()` | `(status?) → BatchJob[]` | List all jobs, optionally filtered by status |
| `cleanup()` | `() → number` | Remove completed/failed/cancelled jobs |

### `BatchManagerConfig`

**Source**: [`src/batch.ts:65`](../src/batch.ts:65)

```typescript
interface BatchManagerConfig {
  concurrency?: number;             // Default: 5
  delayBetweenRequests?: number;    // Default: 0
  continueOnError?: boolean;        // Default: true
  onProgress?: (job: BatchJob) => void;
}
```

### `BatchJob<T>`

**Source**: [`src/batch.ts:39`](../src/batch.ts:39)

```typescript
interface BatchJob<T = unknown> {
  id: string;
  status: BatchJobStatus;
  functionName: string;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  results: BatchRequestResult<T>[];
  createdAt: Date;
  completedAt?: Date;
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

### `BatchJobStatus`

**Source**: [`src/batch.ts:8`](../src/batch.ts:8)

```typescript
type BatchJobStatus = "pending" | "submitted" | "processing" | "completed" | "failed" | "cancelled";
```

---

## DSL

### `Lexer`

**Source**: [`src/dsl/lexer.ts:56`](../src/dsl/lexer.ts:56)

```typescript
new Lexer(source: string)
lexer.tokenize(): Token[]
```

### `Parser`

**Source**: [`src/dsl/parser.ts:23`](../src/dsl/parser.ts:23)

```typescript
new Parser(tokens: Token[])
parser.parse(): Program
```

### `compile(program)`

**Source**: [`src/dsl/compiler.ts:24`](../src/dsl/compiler.ts:24)

```typescript
function compile(program: Program): CompiledModule
```

### `compileFile(source)`

**Source**: [`src/dsl/compiler.ts:50`](../src/dsl/compiler.ts:50)

```typescript
function compileFile(source: string): CompiledModule
```

Convenience function: lex → parse → compile in one step.

### `CompiledModule`

**Source**: [`src/dsl/compiler.ts:9`](../src/dsl/compiler.ts:9)

```typescript
interface CompiledModule {
  types: Map<string, z.ZodType>;
  functions: Map<string, LScriptFunction<string, z.ZodType>>;
}
```

### `TokenType`

**Source**: [`src/dsl/lexer.ts:3`](../src/dsl/lexer.ts:3)

Enum of all token types: `TYPE`, `LLM`, `IDENTIFIER`, `STRING`, `TRIPLE_STRING`, `NUMBER`, `LBRACE`, `RBRACE`, `LPAREN`, `RPAREN`, `LBRACKET`, `RBRACKET`, `COLON`, `COMMA`, `ARROW`, `EQUALS`, `PIPE`, `TEMPLATE_VAR`, `COMMENT`, `EOF`.

### Error Types

| Error | Source | Description |
|---|---|---|
| `LexerError` | [`src/dsl/lexer.ts:45`](../src/dsl/lexer.ts:45) | Invalid input during tokenization |
| `ParseError` | [`src/dsl/parser.ts:12`](../src/dsl/parser.ts:12) | Syntax error during parsing |
| `CompileError` | [`src/dsl/compiler.ts:14`](../src/dsl/compiler.ts:14) | Semantic error during compilation |

### AST Node Types

| Type | Source | Description |
|---|---|---|
| `TypeDeclarationNode` | [`src/dsl/ast.ts:11`](../src/dsl/ast.ts:11) | Type definition |
| `LLMFunctionNode` | [`src/dsl/ast.ts:17`](../src/dsl/ast.ts:17) | LLM function definition |
| `TypeFieldNode` | [`src/dsl/ast.ts:3`](../src/dsl/ast.ts:3) | Field within a type |
| `Program` | [`src/dsl/ast.ts:33`](../src/dsl/ast.ts:33) | Root AST node |

---

## Testing Utilities

### `MockProvider`

**Source**: [`src/testing/mock-provider.ts:20`](../src/testing/mock-provider.ts:20)

```typescript
new MockProvider(config?: MockProviderConfig)
```

| Method | Description |
|---|---|
| `chat(request)` | Return configured response |
| `getRecordedRequests()` | Get all recorded requests |
| `getRequestCount()` | Number of recorded requests |
| `reset()` | Clear recorded requests |
| `assertCalledWith(matcher)` | Assert a matching request was made |
| `assertCallCount(n)` | Assert exact call count |

### `createMockProvider(config?)`

**Source**: [`src/testing/mock-provider.ts:147`](../src/testing/mock-provider.ts:147)

Factory function for `MockProvider`.

### `diffSchemaResult(schema, actual)`

**Source**: [`src/testing/schema-diff.ts:17`](../src/testing/schema-diff.ts:17)

```typescript
function diffSchemaResult(schema: z.ZodType, actual: unknown): SchemaDiff[]
```

### `formatSchemaDiff(diffs)`

**Source**: [`src/testing/schema-diff.ts:274`](../src/testing/schema-diff.ts:274)

```typescript
function formatSchemaDiff(diffs: SchemaDiff[]): string
```

### `captureSnapshot(fn, sampleInput)`

**Source**: [`src/testing/prompt-snapshot.ts:31`](../src/testing/prompt-snapshot.ts:31)

```typescript
function captureSnapshot<I, O>(fn: LScriptFunction<I, O>, sampleInput: I): PromptSnapshot
```

### `compareSnapshots(baseline, current)`

**Source**: [`src/testing/prompt-snapshot.ts:62`](../src/testing/prompt-snapshot.ts:62)

```typescript
function compareSnapshots(baseline: PromptSnapshot, current: PromptSnapshot): SnapshotDiff
```

### `formatSnapshotDiff(diff)`

**Source**: [`src/testing/prompt-snapshot.ts:121`](../src/testing/prompt-snapshot.ts:121)

```typescript
function formatSnapshotDiff(diff: SnapshotDiff): string
```

### `ChaosProvider`

**Source**: [`src/testing/chaos.ts:23`](../src/testing/chaos.ts:23)

```typescript
new ChaosProvider(config: ChaosConfig)
```

Wraps a provider and randomly injects failures.

### `generateFuzzInputs(schema, count)`

**Source**: [`src/testing/chaos.ts:91`](../src/testing/chaos.ts:91)

```typescript
function generateFuzzInputs(schema: z.ZodType, count: number): unknown[]
```

---

## CLI Utilities

### `generateManifest(fn)`

**Source**: [`src/cli.ts:25`](../src/cli.ts:25)

```typescript
function generateManifest(fn: LScriptFunction<unknown, z.ZodType>): FunctionManifest
```

### `extractFunctions(mod)`

**Source**: [`src/cli.ts:41`](../src/cli.ts:41)

```typescript
function extractFunctions(mod: Record<string, unknown>): Array<{ key: string; fn: LScriptFunction }>
```

### `FunctionManifest`

**Source**: [`src/cli.ts:12`](../src/cli.ts:12)

```typescript
interface FunctionManifest {
  name: string;
  model: string;
  system: string;
  temperature: number | undefined;
  schema: object;
  exampleCount: number;
  toolCount: number;
}
```
