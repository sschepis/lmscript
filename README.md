# L-Script (lmscript)

**A Typed Runtime for LLM Orchestration**

`build: passing` · `tests: passing` · `license: MIT` · `node: >=18`

> *"We are not writing text; we are defining the topology of a thought process."*

---

## Overview

L-Script treats LLMs as **typed, non-deterministic processors** that require formal interfaces. Instead of ad-hoc string prompting, you define **typed functions** with Zod schemas that compile to structured API calls with automatic validation, retry logic, and provider abstraction.

**Three pillars:**

| Pillar | What it does |
|---|---|
| **Schema Enforcement** | Every LLM call validates output against a Zod schema. If the model drifts, the runtime catches it and retries. |
| **Context Management** | `ContextStack` manages conversation history with automatic FIFO or summarization pruning at token limits. |
| **Model Agnosticism** | Write logic once; swap providers (OpenAI, Anthropic, Gemini, Ollama) without changing function definitions. |

---

## Quick Start

```typescript
import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "lmscript";
import type { LScriptFunction } from "lmscript";

// 1. Define your output schema
const AnalysisSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  summary: z.string(),
  action_items: z.array(z.string()),
});

// 2. Define the LLM function
const AnalyzeFeedback: LScriptFunction<string, typeof AnalysisSchema> = {
  name: "AnalyzeFeedback",
  model: "gpt-4o",
  system: "You are a Senior Product Manager.",
  prompt: (text) => `Review this customer feedback:\n${text}`,
  schema: AnalysisSchema,
  temperature: 0.3,
};

// 3. Execute with full type safety
const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await runtime.execute(AnalyzeFeedback, feedbackText);
// result.data is fully typed: { sentiment, summary, action_items }
```

---

## Installation

```bash
npm install lmscript
```

---

## Features

### Tier 1: Core Runtime

#### Typed LLM Functions

Every LLM call is an [`LScriptFunction`](src/types.ts:55) — a typed object with a name, model, system prompt, prompt template, and a Zod schema for output validation.

```typescript
const MyFunction: LScriptFunction<string, typeof MySchema> = {
  name: "MyFunction",
  model: "gpt-4o",
  system: "You are an expert analyst.",
  prompt: (input) => `Analyze: ${input}`,
  schema: MySchema,
  temperature: 0.3,
  maxRetries: 3,
};
```

#### Multi-Agent Pipelines

Chain multiple LLM functions sequentially with [`Pipeline.from(fn1).pipe(fn2)`](src/pipeline.ts:1). The output of each step becomes the input to the next.

```typescript
import { Pipeline } from "lmscript";

const pipeline = Pipeline.from(ExtractFacts).pipe(Summarize).pipe(GenerateReport);
const result = await pipeline.run(runtime, rawData);
// result.finalData — output of the last step
// result.steps    — results from each step
// result.totalUsage — aggregated token usage
```

#### Few-Shot Examples

Add optional [`examples`](src/types.ts:78) to any function for in-context learning:

```typescript
const ClassifyEmail: LScriptFunction<string, typeof ClassifySchema> = {
  name: "ClassifyEmail",
  model: "gpt-4o",
  system: "Classify emails by intent.",
  prompt: (email) => `Classify this email:\n${email}`,
  schema: ClassifySchema,
  examples: [
    { input: "I want a refund", output: { intent: "refund", priority: "high" } },
    { input: "Thanks for the update!", output: { intent: "acknowledgment", priority: "low" } },
  ],
};
```

#### Context Management

[`ContextStack`](src/context.ts:1) manages conversation history with configurable token limits and pruning strategies:

```typescript
import { ContextStack } from "lmscript";

const ctx = new ContextStack({ maxTokens: 4096, pruneStrategy: "fifo" });
ctx.push({ role: "user", content: "Hello" });
ctx.push({ role: "assistant", content: "Hi there!" });

ctx.getMessages();    // ChatMessage[]
ctx.getTokenCount();  // estimated token count
```

The `"summarize"` strategy accepts a custom summarizer function for intelligent pruning.

#### Streaming

[`executeStream()`](src/runtime.ts) returns a [`StreamResult`](src/types.ts:143) with partial tokens as they arrive:

```typescript
const { stream, result } = await runtime.executeStream(MyFunction, input);

for await (const token of stream) {
  process.stdout.write(token); // partial tokens
}

const final = await result; // validated ExecutionResult<T>
```

#### Tool / Function Calling

Attach [`tools`](src/types.ts:81) to any function. The runtime automatically executes tool calls and re-prompts the LLM with results:

```typescript
const LookupTool: ToolDefinition = {
  name: "lookup_user",
  description: "Look up a user by ID",
  parameters: z.object({ userId: z.string() }),
  execute: async ({ userId }) => db.users.findById(userId),
};

const MyFunction: LScriptFunction<string, typeof Schema> = {
  name: "WithTools",
  model: "gpt-4o",
  system: "You are a helpful assistant.",
  prompt: (q) => q,
  schema: Schema,
  tools: [LookupTool],
};
```

---

### Tier 2: Developer Experience

#### Middleware Hooks

[`MiddlewareManager`](src/middleware.ts:1) provides lifecycle hooks for cross-cutting concerns:

```typescript
import { MiddlewareManager } from "lmscript";

const middleware = new MiddlewareManager();
middleware.use({
  onBeforeExecute: (ctx) => console.log(`Starting ${ctx.fn.name}`),
  onAfterValidation: (ctx, result) => console.log("Validated:", result),
  onRetry: (ctx, error) => console.warn(`Retrying: ${error.message}`),
  onError: (ctx, error) => console.error(`Failed: ${error.message}`),
  onComplete: (ctx, result) => console.log(`Done in ${result.attempts} attempts`),
});

const runtime = new LScriptRuntime({ provider, middleware });
```

#### Execution Cache

[`ExecutionCache`](src/cache.ts:1) with [`MemoryCacheBackend`](src/cache.ts) memoizes LLM responses with TTL support:

```typescript
import { ExecutionCache, MemoryCacheBackend } from "lmscript";

const cache = new ExecutionCache(new MemoryCacheBackend(), {
  defaultTtlMs: 60_000, // 1 minute TTL
});

const runtime = new LScriptRuntime({ provider, cache });
// Identical inputs will return cached results
```

#### Cost Tracking

[`CostTracker`](src/cost-tracker.ts:1) monitors token usage with per-function breakdowns and budget limits:

```typescript
import { CostTracker } from "lmscript";

const costTracker = new CostTracker({
  "gpt-4o": { inputPer1k: 0.005, outputPer1k: 0.015 },
});

const runtime = new LScriptRuntime({
  provider,
  costTracker,
  budget: { maxTotalCost: 1.00, maxTotalTokens: 100_000 },
});

// After executions:
costTracker.getTotalCost();       // total USD spent
costTracker.getUsageByFunction(); // per-function breakdown
```

#### Structured Logging

[`Logger`](src/logger.ts:1) with transports, spans, and log levels for execution tracing:

```typescript
import { Logger, ConsoleTransport, LogLevel } from "lmscript";

const logger = new Logger({
  level: LogLevel.DEBUG,
  transports: [new ConsoleTransport()],
});

const span = logger.startSpan("my-operation");
span.info("Processing started");
span.end();

const runtime = new LScriptRuntime({ provider, logger });
```

#### CLI Tool

The [`lsc`](src/cli.ts:1) command-line tool for working with L-Script files:

```bash
lsc compile <file.ls>   # Compile .ls file and print JSON manifest
lsc list <file.ls>      # List all functions defined in a file
lsc validate <file.ls>  # Validate syntax without compiling
lsc parse <file.ls>     # Parse and print AST
```

---

### Tier 3: Providers

#### OpenAI

[`OpenAIProvider`](src/providers/openai.ts:1) works with OpenAI and any OpenAI-compatible API:

```typescript
import { OpenAIProvider } from "lmscript";

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: "https://api.openai.com/v1", // or any compatible endpoint
});
```

#### Anthropic

[`AnthropicProvider`](src/providers/anthropic.ts:1) for Claude models:

```typescript
import { AnthropicProvider } from "lmscript";

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

#### Google Gemini

[`GeminiProvider`](src/providers/gemini.ts:1) for Gemini models:

```typescript
import { GeminiProvider } from "lmscript";

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
});
```

#### Ollama

[`OllamaProvider`](src/providers/ollama.ts:1) for local models via Ollama:

```typescript
import { OllamaProvider } from "lmscript";

const provider = new OllamaProvider({
  apiKey: "unused", // Ollama doesn't require API keys
  baseUrl: "http://localhost:11434",
});
```

#### Model Router

[`ModelRouter`](src/router.ts:1) routes requests to different providers based on pattern-matched rules:

```typescript
import { ModelRouter } from "lmscript";

const router = new ModelRouter([
  { pattern: /^gpt-/, provider: openaiProvider },
  { pattern: /^claude-/, provider: anthropicProvider },
  { pattern: /^gemini-/, provider: geminiProvider },
  { pattern: /.*/, provider: ollamaProvider }, // fallback
]);

const runtime = new LScriptRuntime({ provider: router });
```

#### Fallback Chain

[`FallbackProvider`](src/providers/fallback.ts:1) automatically fails over to the next provider on error:

```typescript
import { FallbackProvider } from "lmscript";

const provider = new FallbackProvider([
  openaiProvider,
  anthropicProvider,
  ollamaProvider,
]);
// If OpenAI fails, tries Anthropic, then Ollama
```

---

### Tier 4: Testing & Reliability

#### Mock Provider

[`MockProvider`](src/testing/mock-provider.ts:1) with request recording and pattern-matched responses for unit testing:

```typescript
import { MockProvider, createMockProvider } from "lmscript";

const mock = createMockProvider([
  { input: /feedback/, output: { sentiment: "positive", summary: "Great!" } },
  { output: { fallback: true } }, // default response
]);

const runtime = new LScriptRuntime({ provider: mock });
// mock.getRecordedRequests() — inspect all requests made
```

#### Schema Diff

[`diffSchemaResult()`](src/testing/schema-diff.ts:1) provides field-by-field validation diffs for testing LLM output:

```typescript
import { diffSchemaResult, formatSchemaDiff } from "lmscript";

const diff = diffSchemaResult(schema, actualOutput);
if (diff.length > 0) {
  console.log(formatSchemaDiff(diff));
  // Shows exactly which fields failed validation and why
}
```

#### Prompt Snapshots

[`captureSnapshot()`](src/testing/prompt-snapshot.ts:1) / [`compareSnapshots()`](src/testing/prompt-snapshot.ts) for prompt regression testing:

```typescript
import { captureSnapshot, compareSnapshots, formatSnapshotDiff } from "lmscript";

const baseline = captureSnapshot(myFunction, testInput);
// ... make changes ...
const current = captureSnapshot(myFunction, testInput);

const diff = compareSnapshots(baseline, current);
if (diff.changed) {
  console.log(formatSnapshotDiff(diff));
}
```

#### Chaos Testing

[`ChaosProvider`](src/testing/chaos.ts) and [`generateFuzzInputs()`](src/testing/chaos.ts) for resilience testing:

```typescript
import { ChaosProvider, generateFuzzInputs } from "lmscript";

// Wrap a provider to inject random failures
const chaos = new ChaosProvider(realProvider, {
  errorRate: 0.3,        // 30% chance of error
  latencyMs: [100, 2000], // random latency range
  malformedRate: 0.1,    // 10% chance of malformed JSON
});

// Generate fuzz inputs for a schema
const fuzzInputs = generateFuzzInputs(MySchema, 50);
```

---

### Tier 5: Advanced Patterns

#### Parallel Execution

[`executeAll()`](src/runtime.ts) and [`executeBatch()`](src/runtime.ts) with concurrency control:

```typescript
// Execute multiple functions in parallel
const results = await runtime.executeAll([
  { fn: AnalyzeSentiment, input: text },
  { fn: ExtractEntities, input: text },
  { fn: ClassifyTopic, input: text },
]);
// results.tasks — individual results
// results.successCount, results.failureCount

// Batch execution with concurrency limit
const batchResults = await runtime.executeBatch(
  items.map((item) => ({ fn: ProcessItem, input: item })),
  { concurrency: 5 }
);
```

#### Conversational Sessions

[`Session`](src/session.ts:1) manages multi-turn conversations with automatic history tracking:

```typescript
import { Session, ContextStack } from "lmscript";

const session = new Session(
  runtime,
  ChatFunction,
  new ContextStack({ maxTokens: 8192, pruneStrategy: "fifo" })
);

const r1 = await session.send("What is TypeScript?");
const r2 = await session.send("How does it compare to JavaScript?");
// r2 has full conversation context from r1

session.getHistory();     // full ChatMessage[] history
session.getTokenCount();  // current token usage
session.clearHistory();   // reset the session
```

#### Output Transformers

[`executeWithTransform()`](src/runtime.ts) with composable [`OutputTransformer`](src/transformer.ts:10) functions:

```typescript
import {
  withTransform,
  dateStringTransformer,
  trimStringsTransformer,
  composeTransformers,
} from "lmscript";

// Apply a single transformer
const result = await runtime.executeWithTransform(
  withTransform(MyFunction, trimStringsTransformer)
);

// Compose multiple transformers (applied left-to-right)
const composed = composeTransformers(
  trimStringsTransformer,
  dateStringTransformer,
);
```

#### L-Script DSL

Parse [`.ls` files](examples/security-review.ls) into typed `LScriptFunction` objects with the built-in DSL compiler:

```ls
// security-review.ls

type Critique = {
  score: number(min=1, max=10),
  vulnerabilities: string[],
  suggested_fix: string
}

llm SecurityReviewer(code: string) -> Critique {
  model: "gpt-4o"
  temperature: 0.2

  system: "You are a senior security researcher. Be pedantic and skeptical."

  prompt:
    """
    Review the following function for security flaws:
    {{code}}
    """
}
```

Use programmatically or via CLI:

```typescript
import { compileFile } from "lmscript";

const module = await compileFile("./security-review.ls");
// module.functions — Map of compiled LScriptFunction objects
// module.types    — Map of compiled Zod schemas
```

```bash
lsc compile security-review.ls   # Compile and print JSON manifest
lsc parse security-review.ls     # Print AST
```

---

## API Reference

| Class / Function | Description |
|---|---|
| [`LScriptRuntime`](src/runtime.ts) | Core runtime — `execute()`, `executeStream()`, `executeAll()`, `executeBatch()`, `executeWithTransform()`, `executeWithHistory()` |
| [`LScriptFunction<I, O>`](src/types.ts:55) | Typed LLM function definition with schema, prompt template, and options |
| [`Pipeline`](src/pipeline.ts) | Sequential multi-step pipeline — `Pipeline.from(fn).pipe(fn2)` |
| [`Session`](src/session.ts) | Multi-turn conversational session with context tracking |
| [`ContextStack`](src/context.ts) | Managed conversation history with token limits and pruning |
| [`MiddlewareManager`](src/middleware.ts) | Lifecycle hooks — `onBeforeExecute`, `onAfterValidation`, `onRetry`, `onError`, `onComplete` |
| [`ExecutionCache`](src/cache.ts) | Response caching with pluggable backends and TTL |
| [`MemoryCacheBackend`](src/cache.ts) | In-memory cache backend |
| [`CostTracker`](src/cost-tracker.ts) | Token usage tracking with budget enforcement |
| [`Logger`](src/logger.ts) | Structured logging with transports and spans |
| [`OpenAIProvider`](src/providers/openai.ts) | OpenAI / OpenAI-compatible provider |
| [`AnthropicProvider`](src/providers/anthropic.ts) | Anthropic Claude provider |
| [`GeminiProvider`](src/providers/gemini.ts) | Google Gemini provider |
| [`OllamaProvider`](src/providers/ollama.ts) | Ollama local model provider |
| [`ModelRouter`](src/router.ts) | Pattern-based model routing |
| [`FallbackProvider`](src/providers/fallback.ts) | Automatic provider failover chain |
| [`MockProvider`](src/testing/mock-provider.ts) | Mock provider for testing with request recording |
| [`diffSchemaResult()`](src/testing/schema-diff.ts) | Field-by-field schema validation diff |
| [`captureSnapshot()`](src/testing/prompt-snapshot.ts) | Prompt snapshot capture for regression testing |
| [`compareSnapshots()`](src/testing/prompt-snapshot.ts) | Snapshot comparison with detailed diffs |
| [`ChaosProvider`](src/testing/chaos.ts) | Chaos testing provider — injects errors, latency, malformed responses |
| [`generateFuzzInputs()`](src/testing/chaos.ts) | Fuzz input generator for schema-aware testing |
| [`compile()` / `compileFile()`](src/dsl/compiler.ts) | L-Script DSL compiler |
| [`withTransform()`](src/transformer.ts) | Output transformer wrapper |
| [`composeTransformers()`](src/transformer.ts) | Compose multiple output transformers |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        L-Script DSL                          │
│              .ls files → Lexer → Parser → AST                │
└──────────────────────┬───────────────────────────────────────┘
                       │ compile()
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                   LScriptFunction<I, O>                      │
│         name · model · system · prompt · schema              │
│         examples · tools · temperature · maxRetries          │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Pipeline │ │ Session  │ │ Parallel │
    │ .pipe()  │ │ .send()  │ │ execAll  │
    └────┬─────┘ └────┬─────┘ └────┬─────┘
         └────────────┬────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                     LScriptRuntime                           │
│  middleware → cache → cost tracking → logger → validation    │
└──────────────────────┬───────────────────────────────────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
        ┌──────────┐ ┌─────┐ ┌──────────┐
        │  Router  │ │ FB  │ │  Direct  │
        │(pattern) │ │Chain│ │ Provider │
        └────┬─────┘ └──┬──┘ └────┬─────┘
             └───────────┼────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                      LLM Providers                           │
│     OpenAI  ·  Anthropic  ·  Gemini  ·  Ollama  ·  Mock     │
└──────────────────────────────────────────────────────────────┘
```

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests
npm run dev          # Watch mode
```

### CLI

```bash
npm run cli:compile -- <file.ls>    # Compile .ls file
npm run cli:list -- <file.ls>       # List functions
npm run cli:validate -- <file.ls>   # Validate syntax
npm run cli:parse -- <file.ls>      # Print AST
```

### Running Examples

```bash
export OPENAI_API_KEY=sk-...
npm run example:security
```

---

## License

MIT
