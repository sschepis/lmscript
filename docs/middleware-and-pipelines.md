# Middleware & Pipelines

[← Back to Index](./README.md)

---

## Table of Contents

1. [Middleware Hooks](#middleware-hooks)
2. [Pipelines](#pipelines)
3. [Output Transformers](#output-transformers)
4. [Telemetry Middleware](#telemetry-middleware)

---

## Middleware Hooks

[`MiddlewareManager`](../src/middleware.ts:14) provides lifecycle hooks that fire at key points during execution. Use them for logging, monitoring, rate limiting, analytics, or any cross-cutting concern.

### Setup

```typescript
import { MiddlewareManager, LScriptRuntime } from "lmscript";

const middleware = new MiddlewareManager();

middleware.use({
  onBeforeExecute: (ctx) => {
    console.log(`Starting: ${ctx.fn.name} (attempt ${ctx.attempt})`);
  },
  onAfterValidation: (ctx, result) => {
    console.log(`Validated output for: ${ctx.fn.name}`);
  },
  onRetry: (ctx, error) => {
    console.warn(`Retrying ${ctx.fn.name}: ${error.message}`);
  },
  onError: (ctx, error) => {
    console.error(`Error in ${ctx.fn.name}: ${error.message}`);
  },
  onComplete: (ctx, result) => {
    const elapsed = Date.now() - ctx.startTime;
    console.log(`Completed ${ctx.fn.name} in ${elapsed}ms (${result.attempts} attempts)`);
  },
});

const runtime = new LScriptRuntime({ provider, middleware });
```

### Hook Lifecycle

Hooks fire in this order during a successful execution:

```
onBeforeExecute → [LLM call] → onAfterValidation → onComplete
```

On validation failure with retry:

```
onBeforeExecute → [LLM call] → (validation fails) → onRetry → [retry LLM call] → onAfterValidation → onComplete
```

On final failure:

```
onBeforeExecute → [LLM call] → (validation fails) → onRetry → ... → onError
```

### Available Hooks

| Hook | When It Fires | Arguments |
|---|---|---|
| `onBeforeExecute` | Before the first LLM call | [`ExecutionContext`](../src/types.ts:199) |
| `onAfterValidation` | After successful schema validation | `ExecutionContext`, validated data |
| `onRetry` | Before each retry attempt | `ExecutionContext`, `Error` |
| `onError` | On unrecoverable error | `ExecutionContext`, `Error` |
| `onComplete` | After successful execution | `ExecutionContext`, [`ExecutionResult`](../src/types.ts:127) |

### ExecutionContext

The [`ExecutionContext`](../src/types.ts:199) object passed to hooks contains:

| Property | Type | Description |
|---|---|---|
| `fn` | `LScriptFunction` | The function being executed |
| `input` | `unknown` | The input passed to the function |
| `messages` | `ChatMessage[]` | The compiled message array |
| `attempt` | `number` | Current attempt number (1-based) |
| `startTime` | `number` | Timestamp when execution started (`Date.now()`) |

### Multiple Middleware

You can register multiple middleware sets. They run in registration order:

```typescript
middleware.use(loggingHooks);
middleware.use(analyticsHooks);
middleware.use(rateLimitHooks);
```

### Removing Middleware

```typescript
middleware.remove(analyticsHooks); // Pass the same reference
```

### Error Isolation

Errors thrown in middleware hooks are caught and logged to `console.error`. They do **not** crash the execution — the runtime continues even if a hook fails.

### Practical Example: Execution Timer

```typescript
const timerMiddleware: MiddlewareHooks = {
  onBeforeExecute: (ctx) => {
    (ctx as any).__startTime = Date.now();
  },
  onComplete: (ctx, result) => {
    const elapsed = Date.now() - (ctx as any).__startTime;
    metrics.recordLatency(ctx.fn.name, elapsed);
    metrics.recordTokens(ctx.fn.name, result.usage?.totalTokens ?? 0);
  },
};
```

---

## Pipelines

[`Pipeline`](../src/pipeline.ts:25) chains multiple [`LScriptFunction`](../src/types.ts:55) objects sequentially, where the output of each step becomes the input to the next.

### Basic Usage

```typescript
import { Pipeline } from "lmscript";

const pipeline = Pipeline
  .from(ExtractFacts)     // Step 1: string → Facts
  .pipe(Summarize)        // Step 2: Facts → Summary
  .pipe(GenerateReport);  // Step 3: Summary → Report

const result = await pipeline.execute(runtime, rawDocument);
```

### Pipeline Result

[`PipelineResult`](../src/types.ts:182) contains:

| Property | Type | Description |
|---|---|---|
| `finalData` | `T` | Output of the last step |
| `steps` | [`PipelineStepResult[]`](../src/types.ts:168) | Results from each step |
| `totalUsage` | `{ promptTokens, completionTokens, totalTokens }` | Aggregated token usage |

Each step result includes:

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Name of the function |
| `data` | `unknown` | Output data |
| `attempts` | `number` | Number of attempts needed |
| `usage` | token usage | Token usage for this step |

### Type Safety

Pipelines are type-safe. The TypeScript compiler ensures that:
- The initial input type matches the first function's input type
- Each function's output type matches the next function's input type
- The final result type matches the last function's output type

```typescript
// This would be a TypeScript error if Summarize doesn't accept Facts as input:
Pipeline.from(ExtractFacts).pipe(Summarize);
```

### Example: Multi-Step Analysis

```typescript
// Step 1: Extract entities from text
const ExtractEntities: LScriptFunction<string, typeof EntitiesSchema> = { ... };

// Step 2: Classify entities (input = extracted entities)
const ClassifyEntities: LScriptFunction<z.infer<typeof EntitiesSchema>, typeof ClassifiedSchema> = { ... };

// Step 3: Generate report (input = classified entities)
const Report: LScriptFunction<z.infer<typeof ClassifiedSchema>, typeof ReportSchema> = { ... };

const pipeline = Pipeline.from(ExtractEntities).pipe(ClassifyEntities).pipe(Report);

const result = await pipeline.execute(runtime, "The company Apple released...");
console.log(result.finalData);  // Typed Report output
console.log(result.steps);      // 3 step results
console.log(result.totalUsage); // Aggregated tokens across all 3 steps
```

---

## Output Transformers

[`OutputTransformer`](../src/transformer.ts:10) functions post-process validated LLM output before returning it to the caller.

### Using Transformers

```typescript
import { withTransform, trimStringsTransformer } from "lmscript";

// Method 1: via runtime.executeWithTransform()
const result = await runtime.executeWithTransform(
  MyFunction,
  input,
  trimStringsTransformer
);

// Method 2: via withTransform() helper
const wrapped = withTransform(MyFunction, trimStringsTransformer);
const result2 = await runtime.executeWithTransform(
  wrapped.fn,
  input,
  wrapped.transformer
);
```

### Built-in Transformers

#### `trimStringsTransformer`

Recursively trims all string values in the output:

```typescript
import { trimStringsTransformer } from "lmscript";

// Input:  { name: "  John  ", tags: ["  a  ", " b "] }
// Output: { name: "John", tags: ["a", "b"] }
```

#### `dateStringTransformer`

Recursively converts ISO 8601 date strings to `Date` objects:

```typescript
import { dateStringTransformer } from "lmscript";

// Input:  { createdAt: "2024-01-15T10:30:00Z" }
// Output: { createdAt: Date(2024-01-15T10:30:00Z) }
```

### Composing Transformers

Use [`composeTransformers()`](../src/transformer.ts:86) to chain multiple transformers. They are applied left-to-right:

```typescript
import { composeTransformers, trimStringsTransformer, dateStringTransformer } from "lmscript";

const composed = composeTransformers(
  trimStringsTransformer,   // runs first
  dateStringTransformer,    // runs second
);

const result = await runtime.executeWithTransform(MyFunction, input, composed);
```

### Custom Transformers

A transformer is any function `(data: T) => U | Promise<U>`:

```typescript
import type { OutputTransformer } from "lmscript";

const toUpperCase: OutputTransformer<{ name: string }, { name: string }> = (data) => ({
  ...data,
  name: data.name.toUpperCase(),
});

const addTimestamp: OutputTransformer<any, any> = (data) => ({
  ...data,
  processedAt: new Date().toISOString(),
});
```

---

## Telemetry Middleware

[`createTelemetryMiddleware()`](../src/telemetry.ts:102) generates a complete set of middleware hooks that emit OpenTelemetry-compatible spans and metrics for every execution — without requiring a hard dependency on `@opentelemetry/*` packages.

### Setup

```typescript
import { createTelemetryMiddleware, MiddlewareManager, LScriptRuntime } from "lmscript";

// Import your OpenTelemetry SDK
import { trace, metrics } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
const meter = metrics.getMeter("my-app");

// Create telemetry middleware hooks
const telemetryHooks = createTelemetryMiddleware({
  tracer,              // OpenTelemetry Tracer
  meter,               // OpenTelemetry Meter
  metricPrefix: "lmscript",  // Prefix for metric names (default: "lmscript")
  includePrompts: false,      // Include prompt text in spans (default: false, for security)
});

// Register with middleware manager
const middleware = new MiddlewareManager();
middleware.use(telemetryHooks);

const runtime = new LScriptRuntime({ provider, middleware });
```

### What Gets Instrumented

The telemetry middleware hooks into the standard middleware lifecycle:

| Hook | What It Does |
|---|---|
| `onBeforeExecute` | Starts a new span named `{prefix}.execute` with function name and model attributes |
| `onComplete` | Ends the span with success status, records duration/token metrics |
| `onError` | Ends the span with error status, records the error |
| `onRetry` | Adds a span event for each retry attempt |

### Emitted Spans

Each execution produces a span with these attributes:

| Attribute | Type | Description |
|---|---|---|
| `lmscript.function` | `string` | Function name |
| `lmscript.model` | `string` | Model identifier |
| `lmscript.attempts` | `number` | Number of attempts |
| `lmscript.duration_ms` | `number` | Total execution duration |
| `lmscript.prompt_tokens` | `number` | Prompt token count |
| `lmscript.completion_tokens` | `number` | Completion token count |
| `lmscript.total_tokens` | `number` | Total token count |

### Emitted Metrics

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `{prefix}.executions` | Counter | function, model, status | Execution count |
| `{prefix}.tokens` | Counter | function, model, type | Token usage |
| `{prefix}.duration` | Histogram | function, model | Execution duration (ms) |
| `{prefix}.attempts` | Histogram | function, model | Attempts per execution |

### Log Forwarding with OTelLogTransport

[`OTelLogTransport`](../src/telemetry.ts:66) forwards L-Script [`Logger`](../src/logger.ts:120) entries to an OpenTelemetry tracer as span events:

```typescript
import { OTelLogTransport, Logger } from "lmscript";

const transport = new OTelLogTransport(tracer);
const logger = new Logger({ transports: [transport] });

// All logger.info(), logger.warn(), logger.error() calls
// are also recorded as span events on the active span
```

### Complete Example

```typescript
import { trace, metrics } from "@opentelemetry/api";
import {
  createTelemetryMiddleware,
  OTelLogTransport,
  MiddlewareManager,
  Logger,
  LScriptRuntime,
  OpenAIProvider,
} from "lmscript";

// Initialize OpenTelemetry (SDK setup not shown — see @opentelemetry/sdk-node)
const tracer = trace.getTracer("my-app", "1.0.0");
const meter = metrics.getMeter("my-app", "1.0.0");

// Telemetry middleware
const telemetry = createTelemetryMiddleware({
  tracer,
  meter,
  metricPrefix: "lmscript",
  includePrompts: process.env.NODE_ENV !== "production",
});

// Log transport
const otelTransport = new OTelLogTransport(tracer);
const logger = new Logger({
  level: "info",
  transports: [otelTransport],
});

// Wire everything together
const middleware = new MiddlewareManager();
middleware.use(telemetry);

const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  middleware,
  logger,
});

// Every execute() call now emits OTel spans + metrics
const result = await runtime.execute(MyFunction, input);
```

See [OpenTelemetry](./advanced.md#opentelemetry) in the Advanced Topics guide for additional details on metrics and span configuration.

---

## Next Steps

- [User Guide](./user-guide.md) — Core concepts
- [Testing](./testing.md) — Mock providers and testing utilities
- [Advanced Topics](./advanced.md) — Caching, cost tracking, parallel execution
