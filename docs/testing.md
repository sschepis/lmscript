# Testing

[← Back to Index](./README.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Mock Provider](#mock-provider)
3. [Schema Diff](#schema-diff)
4. [Prompt Snapshots](#prompt-snapshots)
5. [Chaos Testing](#chaos-testing)
6. [Fuzz Input Generation](#fuzz-input-generation)
7. [Testing Patterns](#testing-patterns)

---

## Overview

L-Script ships with a complete testing toolkit under the `lmscript` package. No additional test dependencies are needed beyond your test runner (e.g., [Vitest](https://vitest.dev/)).

All testing utilities are exported from the main package:

```typescript
import {
  // Mock provider
  MockProvider, createMockProvider,
  // Schema diff
  diffSchemaResult, formatSchemaDiff,
  // Prompt snapshots
  captureSnapshot, compareSnapshots, formatSnapshotDiff,
  // Chaos testing
  ChaosProvider, generateFuzzInputs,
} from "lmscript";
```

---

## Mock Provider

[`MockProvider`](../src/testing/mock-provider.ts:20) is a fake LLM provider for deterministic unit testing. It records all requests and returns configurable responses.

### Basic Setup

```typescript
import { MockProvider, LScriptRuntime } from "lmscript";

const mock = new MockProvider({
  defaultResponse: JSON.stringify({
    sentiment: "positive",
    confidence: 0.95,
    summary: "Great product!",
  }),
});

const runtime = new LScriptRuntime({ provider: mock });
const result = await runtime.execute(AnalyzeSentiment, "I love this!");
// result.data = { sentiment: "positive", confidence: 0.95, summary: "Great product!" }
```

### Pattern-Matched Responses

Use the `responses` map to return different responses based on prompt content:

```typescript
const mock = new MockProvider({
  responses: new Map([
    ["refund", JSON.stringify({ intent: "refund", priority: "high" })],
    [/thank/i, JSON.stringify({ intent: "thanks", priority: "low" })],
  ]),
  defaultResponse: JSON.stringify({ intent: "unknown", priority: "medium" }),
});
```

Matchers are checked against the concatenated content of all messages in the request. String matchers use `.includes()`, RegExp matchers use `.test()`.

### Factory Function

```typescript
import { createMockProvider } from "lmscript";

const mock = createMockProvider({
  defaultResponse: JSON.stringify({ result: "ok" }),
  recordRequests: true,
  latency: 100,       // Simulated latency in ms
  failureRate: 0.1,   // 10% chance of simulated failure
});
```

### MockProviderConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultResponse` | `string` | `"{}"` | Default JSON response for unmatched requests |
| `responses` | `Map<string \| RegExp, string>` | — | Pattern-matched response map |
| `recordRequests` | `boolean` | `true` | Record all requests for later inspection |
| `latency` | `number` | — | Simulated response latency in milliseconds |
| `failureRate` | `number` (0-1) | — | Probability of throwing a simulated error |

### Request Recording & Assertions

```typescript
// Inspect recorded requests
const requests = mock.getRecordedRequests(); // LLMRequest[]
const count = mock.getRequestCount();        // number

// Built-in assertion helpers
mock.assertCalledWith("refund");      // Throws if no request contained "refund"
mock.assertCalledWith(/security/i);   // RegExp matching
mock.assertCallCount(3);             // Throws if call count doesn't match

// Reset
mock.reset(); // Clears recorded requests
```

### Token Usage

`MockProvider` always reports `{ promptTokens: 10, completionTokens: 10, totalTokens: 20 }` — fixed values for predictable test assertions.

---

## Schema Diff

[`diffSchemaResult()`](../src/testing/schema-diff.ts:17) performs field-by-field comparison of actual LLM output against a Zod schema, producing detailed diffs instead of just pass/fail.

### Basic Usage

```typescript
import { z } from "zod";
import { diffSchemaResult, formatSchemaDiff } from "lmscript";

const schema = z.object({
  name: z.string(),
  age: z.number().min(0).max(150),
  active: z.boolean(),
});

const actualOutput = {
  name: 42,              // wrong type
  // age is missing
  active: true,
  extra: "field",         // not in schema
};

const diffs = diffSchemaResult(schema, actualOutput);
console.log(formatSchemaDiff(diffs));
```

Output:
```
Schema Validation Diff:
┌────────┬──────────────────────┬──────────┬────────┐
│ Path   │ Issue                │ Expected │ Actual │
├────────┼──────────────────────┼──────────┼────────┤
│ .name  │ type_mismatch        │ string   │ number │
│ .age   │ missing              │ number   │ -      │
│ .extra │ extra_field          │ -        │ string │
└────────┴──────────────────────┴──────────┴────────┘
```

### SchemaDiff Structure

Each [`SchemaDiff`](../src/testing/schema-diff.ts:5) entry contains:

| Property | Type | Description |
|---|---|---|
| `path` | `string` | Dot-notation path to the field (e.g., `.name`, `.metadata.version`) |
| `expected` | `string` | What the schema expected |
| `actual` | `string` | What was received |
| `issue` | `string` | One of: `"missing"`, `"type_mismatch"`, `"constraint_violation"`, `"extra_field"` |

### Supported Diff Detection

| Issue | Description |
|---|---|
| `missing` | Required field is absent |
| `type_mismatch` | Value has wrong type (string where number expected, etc.) |
| `constraint_violation` | Value violates `min`, `max`, `minLength`, `maxLength` constraints |
| `extra_field` | Field present in data but not in schema |

The diff engine recursively traverses nested objects and arrays, correctly handles `ZodOptional`, `ZodNullable`, `ZodDefault`, `ZodEnum`, `ZodUnion`, and `ZodLiteral`.

---

## Prompt Snapshots

Prompt snapshots capture the compiled prompt (system + schema + user) exactly as the runtime would construct it, enabling regression testing when you modify function definitions.

### Capturing a Snapshot

```typescript
import { captureSnapshot } from "lmscript";

const snapshot = captureSnapshot(MyFunction, sampleInput);
```

A [`PromptSnapshot`](../src/testing/prompt-snapshot.ts:7) contains:

| Property | Type | Description |
|---|---|---|
| `fnName` | `string` | Function name |
| `model` | `string` | Target model |
| `systemPrompt` | `string` | Full system prompt (including schema injection) |
| `userPrompt` | `string` | Compiled user prompt |
| `schemaJson` | `object` | JSON Schema representation of the Zod schema |
| `timestamp` | `number` | Capture timestamp |

### Comparing Snapshots

```typescript
import { captureSnapshot, compareSnapshots, formatSnapshotDiff } from "lmscript";

// Capture baseline
const baseline = captureSnapshot(MyFunction, sampleInput);

// ... make changes to the function ...

// Capture current
const current = captureSnapshot(MyFunction, sampleInput);

// Compare
const diff = compareSnapshots(baseline, current);

if (diff.changed) {
  console.log(formatSnapshotDiff(diff));
}
```

### SnapshotDiff Structure

[`SnapshotDiff`](../src/testing/prompt-snapshot.ts:16):

| Property | Type | Description |
|---|---|---|
| `changed` | `boolean` | Whether any fields differ |
| `diffs` | `Array<{ field, baseline, current }>` | List of changed fields with before/after values |

### Use in Tests

```typescript
import { describe, it, expect } from "vitest";
import { captureSnapshot, compareSnapshots } from "lmscript";

describe("MyFunction prompt stability", () => {
  it("should not change the compiled prompt", () => {
    const snapshot = captureSnapshot(MyFunction, "test input");

    // Assert specific fields
    expect(snapshot.model).toBe("gpt-4o");
    expect(snapshot.systemPrompt).toContain("You are an expert");
    expect(snapshot.userPrompt).toContain("test input");
  });

  it("should match baseline snapshot", () => {
    const baseline = loadBaseline(); // Load from file
    const current = captureSnapshot(MyFunction, "test input");
    const diff = compareSnapshots(baseline, current);
    expect(diff.changed).toBe(false);
  });
});
```

---

## Chaos Testing

[`ChaosProvider`](../src/testing/chaos.ts:23) wraps a real provider and randomly injects failures to test resilience.

### Setup

```typescript
import { ChaosProvider, MockProvider, LScriptRuntime } from "lmscript";

const realProvider = new MockProvider({
  defaultResponse: JSON.stringify({ result: "ok" }),
});

const chaos = new ChaosProvider({
  provider: realProvider,
  malformedJsonRate: 0.2,     // 20% chance of returning invalid JSON
  partialResponseRate: 0.1,   // 10% chance of truncated response
  wrongSchemaRate: 0.1,       // 10% chance of valid JSON with wrong fields
  timeoutRate: 0.05,          // 5% chance of simulated timeout
  timeoutMs: 5000,            // Timeout duration
});

const runtime = new LScriptRuntime({ provider: chaos });
```

### ChaosConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `LLMProvider` | (required) | The real provider to wrap |
| `malformedJsonRate` | `number` (0-1) | `0` | Probability of returning malformed JSON |
| `partialResponseRate` | `number` (0-1) | `0` | Probability of truncating the response |
| `wrongSchemaRate` | `number` (0-1) | `0` | Probability of returning wrong-schema JSON |
| `timeoutRate` | `number` (0-1) | `0` | Probability of simulated timeout |
| `timeoutMs` | `number` | `30000` | Timeout duration in milliseconds |

### Chaos Injection Types

| Type | What Happens |
|---|---|
| **Malformed JSON** | Returns `'"{invalid json'` — tests JSON parse error handling |
| **Partial Response** | Truncates response content to half length — tests incomplete JSON handling |
| **Wrong Schema** | Returns valid JSON with unexpected field names — tests schema validation |
| **Timeout** | Waits `timeoutMs` then throws — tests timeout handling |

The chaos checks are evaluated in order: timeout → malformed → partial → wrong schema. If no chaos triggers, the request passes through to the wrapped provider.

---

## Fuzz Input Generation

[`generateFuzzInputs()`](../src/testing/chaos.ts:91) generates random inputs that intentionally violate a schema in various ways.

### Usage

```typescript
import { z } from "zod";
import { generateFuzzInputs, diffSchemaResult } from "lmscript";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
});

const fuzzInputs = generateFuzzInputs(schema, 30);

for (const input of fuzzInputs) {
  const diffs = diffSchemaResult(schema, input);
  // All fuzz inputs should produce diffs
  console.log(`Diffs: ${diffs.length}`);
}
```

### Fuzz Strategies

The generator cycles through these strategies:

| Strategy | What It Generates |
|---|---|
| **Wrong Types** | Correct field names but wrong value types (e.g., number where string expected) |
| **Missing Fields** | Object with ~50% of required fields removed |
| **Extra Fields** | Valid values plus unexpected fields like `__fuzz_extra_1` |
| **Boundary Values** | Edge cases: empty strings, `-MAX_SAFE_INTEGER`, empty arrays |
| **Null/Undefined** | Returns `null` or `undefined` instead of an object |
| **Primitive Instead of Object** | Returns a raw primitive (number, string, boolean) instead of an object |

---

## Testing Patterns

### Pattern 1: Unit Testing an LLM Function

```typescript
import { describe, it, expect } from "vitest";
import { MockProvider, LScriptRuntime } from "lmscript";

describe("AnalyzeSentiment", () => {
  const mock = new MockProvider({
    defaultResponse: JSON.stringify({
      sentiment: "positive",
      confidence: 0.9,
      summary: "User is happy",
    }),
  });
  const runtime = new LScriptRuntime({ provider: mock });

  it("should return validated output", async () => {
    const result = await runtime.execute(AnalyzeSentiment, "Great product!");
    expect(result.data.sentiment).toBe("positive");
    expect(result.data.confidence).toBe(0.9);
    expect(result.attempts).toBe(1);
  });

  it("should include the input in the prompt", async () => {
    await runtime.execute(AnalyzeSentiment, "Test input");
    mock.assertCalledWith("Test input");
  });
});
```

### Pattern 2: Testing Retry Behavior

```typescript
it("should retry on invalid schema", async () => {
  let callCount = 0;
  const mock = new MockProvider({
    responses: new Map([
      // First call returns invalid response
      [/./, (() => {
        callCount++;
        if (callCount === 1) return '{"wrong": "schema"}';
        return JSON.stringify({ sentiment: "positive", confidence: 0.8, summary: "ok" });
      })()],
    ]),
  });
  // ...
});
```

### Pattern 3: Schema Regression Testing

```typescript
it("should catch schema changes", () => {
  const diffs = diffSchemaResult(SentimentSchema, {
    sentiment: "positive",
    confidence: 0.9,
    summary: "ok",
  });
  expect(diffs).toHaveLength(0); // No diffs = valid
});
```

### Pattern 4: Resilience Testing with Chaos

```typescript
it("should handle chaos gracefully", async () => {
  const chaos = new ChaosProvider({
    provider: mockProvider,
    malformedJsonRate: 0.5,
  });
  const runtime = new LScriptRuntime({ provider: chaos });

  // With enough retries, it should eventually succeed
  const fn = { ...MyFunction, maxRetries: 10 };

  // May take multiple attempts but should not throw
  const result = await runtime.execute(fn, "test");
  expect(result.data).toBeDefined();
});
```

---

## Next Steps

- [User Guide](./user-guide.md) — Core concepts
- [API Reference](./api-reference.md) — Complete API documentation
- [Examples](./examples.md) — Annotated code examples
