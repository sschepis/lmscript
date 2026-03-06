# User Guide

[← Back to Index](./README.md)

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Defining LLM Functions](#defining-llm-functions)
3. [Schemas and Validation](#schemas-and-validation)
4. [Executing Functions](#executing-functions)
5. [Few-Shot Examples](#few-shot-examples)
6. [Streaming](#streaming)
7. [Tool / Function Calling](#tool--function-calling)
 8. [Context Management](#context-management)
 9. [Conversational Sessions](#conversational-sessions)
10. [Error Handling and Retries](#error-handling-and-retries)
11. [Retry Configuration](#retry-configuration)
12. [Multi-Modal Messages](#multi-modal-messages)
13. [Agent Loop](#agent-loop)

---

## Core Concepts

L-Script is built around a single central abstraction: the **typed LLM function**. Every interaction with a language model is modeled as a function with:

- A **typed input** (`I`) — what you pass in
- A **Zod schema** (`O`) — what the LLM must return
- A **prompt template** — how input becomes the user message
- A **system prompt** — the LLM's persona and constraints
- A **model identifier** — which model to target

The [`LScriptRuntime`](../src/runtime.ts:40) compiles these definitions into structured API calls, validates responses, and retries on failure.

---

## Defining LLM Functions

An [`LScriptFunction<I, O>`](../src/types.ts:55) is a plain TypeScript object:

```typescript
import { z } from "zod";
import type { LScriptFunction } from "lmscript";

const ReviewSchema = z.object({
  score: z.number().min(1).max(10),
  issues: z.array(z.string()),
  recommendation: z.string(),
});

const CodeReview: LScriptFunction<string, typeof ReviewSchema> = {
  name: "CodeReview",           // Human-readable name for logging
  model: "gpt-4o",             // Target model identifier
  system: "You are a senior code reviewer. Be thorough but fair.",
  prompt: (code) => `Review this code:\n\`\`\`\n${code}\n\`\`\``,
  schema: ReviewSchema,         // Zod schema for output validation
  temperature: 0.2,             // Lower = more deterministic (default: 0.7)
  maxRetries: 3,                // Retry count on validation failure (default: 2)
};
```

### LScriptFunction Properties

| Property | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | ✓ | — | Human-readable identifier for logging and debugging |
| `model` | `string` | ✓ | — | Model identifier (e.g., `"gpt-4o"`, `"claude-sonnet-4-20250514"`) |
| `system` | `string` | ✓ | — | System instructions defining the LLM's persona |
| `prompt` | `(input: I) => string` | ✓ | — | Template function that converts input to a user message |
| `schema` | `O extends z.ZodType` | ✓ | — | Zod schema that validates and types the LLM's output |
| `temperature` | `number` | | `0.7` | Sampling temperature (0 = deterministic, 1 = creative) |
| `maxRetries` | `number` | | `2` | Maximum retries on schema validation failure |
| `examples` | `Array<{input, output}>` | | — | Few-shot examples for in-context learning |
| `tools` | [`ToolDefinition[]`](../src/types.ts:153) | | — | Tool definitions for LLM function calling |
| `retryConfig` | [`RetryConfig`](../src/types.ts:131) | | — | Per-function retry backoff configuration |

### Complex Input Types

The input type can be any TypeScript type, not just `string`:

```typescript
interface ReviewInput {
  code: string;
  language: string;
  context: string;
}

const CodeReview: LScriptFunction<ReviewInput, typeof ReviewSchema> = {
  name: "CodeReview",
  model: "gpt-4o",
  system: "You are a senior code reviewer.",
  prompt: (input) => 
    `Review this ${input.language} code:\n\`\`\`${input.language}\n${input.code}\n\`\`\`\n\nContext: ${input.context}`,
  schema: ReviewSchema,
};
```

---

## Schemas and Validation

Every [`LScriptFunction`](../src/types.ts:55) requires a Zod schema that defines the shape of the expected output. The runtime:

1. Converts the schema to JSON Schema and injects it into the system prompt
2. Instructs the LLM to respond with valid JSON conforming to the schema
3. Parses and validates the response using `schema.safeParse()`
4. On failure, sends the validation error back to the LLM for a retry

### Supported Zod Types

You can use any Zod type that serializes to JSON Schema:

```typescript
import { z } from "zod";

const ComplexSchema = z.object({
  // Primitives
  name: z.string(),
  count: z.number().int().min(0),
  active: z.boolean(),

  // Enums
  status: z.enum(["pending", "approved", "rejected"]),

  // Arrays
  tags: z.array(z.string()),

  // Nested objects
  metadata: z.object({
    source: z.string(),
    version: z.number(),
  }),

  // Optional fields
  notes: z.string().optional(),

  // Constrained types
  score: z.number().min(0).max(100),
  description: z.string().max(500),
});
```

---

## Executing Functions

### Basic Execution

```typescript
import { LScriptRuntime, OpenAIProvider } from "lmscript";

const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await runtime.execute(MyFunction, myInput);
```

The returned [`ExecutionResult<T>`](../src/types.ts:127) contains:

| Property | Type | Description |
|---|---|---|
| `data` | `T` (inferred from schema) | The validated, fully-typed output |
| `attempts` | `number` | Number of attempts needed (1 = first try succeeded) |
| `usage` | `{ promptTokens, completionTokens, totalTokens }` | Token usage statistics |
| `toolCalls` | [`ToolCall[]`](../src/types.ts:160) | Tool calls made during execution (if any) |

### Runtime Configuration

```typescript
const runtime = new LScriptRuntime({
  provider: myProvider,          // Required: LLM provider
  defaultTemperature: 0.5,       // Default temperature for all functions
  defaultMaxRetries: 3,          // Default retry count
  verbose: true,                 // Enable verbose logging
  middleware: myMiddleware,      // Lifecycle hooks (see Middleware docs)
  cache: myCache,               // Response caching (see Advanced docs)
  costTracker: myCostTracker,   // Token usage tracking (see Advanced docs)
  budget: myBudgetConfig,       // Budget limits (see Advanced docs)
  logger: myLogger,             // Structured logging (see Advanced docs)
  retryConfig: {                 // Retry backoff configuration
    baseDelay: 1000,
    maxDelay: 30_000,
    jitterFactor: 0.2,
  },
  rateLimiter: new RateLimiter({ // API rate limiting (see Advanced docs)
    requestsPerMinute: 60,
    tokensPerMinute: 100_000,
  }),
});
```

---

## Few-Shot Examples

Add [`examples`](../src/types.ts:78) to any function for in-context learning. Each example is a pair of `{ input, output }` that gets injected as user/assistant message pairs before the actual prompt:

```typescript
const ClassifyEmail: LScriptFunction<string, typeof ClassifySchema> = {
  name: "ClassifyEmail",
  model: "gpt-4o",
  system: "Classify emails by intent.",
  prompt: (email) => `Classify this email:\n${email}`,
  schema: ClassifySchema,
  examples: [
    {
      input: "I want a refund for order #12345",
      output: { intent: "refund", priority: "high", department: "support" },
    },
    {
      input: "Thanks for the quick response!",
      output: { intent: "acknowledgment", priority: "low", department: "none" },
    },
  ],
};
```

Examples are injected into the message history as alternating `user`/`assistant` pairs, placed between the system message and the actual user prompt. This provides the LLM with concrete examples of the expected input/output mapping.

---

## Streaming

[`executeStream()`](../src/runtime.ts:297) returns a [`StreamResult`](../src/types.ts:143) with partial tokens as they arrive from the LLM:

```typescript
const { stream, result } = runtime.executeStream(MyFunction, input);

// Process tokens as they arrive
for await (const token of stream) {
  process.stdout.write(token);
}

// Get the final validated result
const final = await result;
console.log(final.data); // fully typed and validated
```

The `stream` is an `AsyncIterable<string>` of partial tokens. The `result` is a `Promise<ExecutionResult<T>>` that resolves once streaming completes and the full response has been validated.

**Fallback behavior**: If the provider doesn't support [`chatStream()`](../src/types.ts:44), `executeStream()` falls back to a regular `execute()` and yields the entire result as a single chunk.

---

## Tool / Function Calling

Attach [`tools`](../src/types.ts:81) to any function to enable LLM function calling. The runtime automatically:

1. Converts tool parameter schemas to JSON Schema
2. Sends tool definitions with the request
3. Executes tool calls when the LLM requests them
4. Feeds tool results back to the LLM
5. Repeats up to 5 rounds of tool calls

```typescript
import { z } from "zod";
import type { ToolDefinition } from "lmscript";

const LookupTool: ToolDefinition = {
  name: "lookup_user",
  description: "Look up a user by their ID",
  parameters: z.object({
    userId: z.string().describe("The user ID to look up"),
  }),
  execute: async ({ userId }) => {
    const user = await db.users.findById(userId);
    return { name: user.name, email: user.email };
  },
};

const AssistantFn: LScriptFunction<string, typeof Schema> = {
  name: "Assistant",
  model: "gpt-4o",
  system: "You are a helpful assistant with access to a user database.",
  prompt: (question) => question,
  schema: Schema,
  tools: [LookupTool],
};
```

### ToolDefinition Properties

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Tool name (must be unique within a function) |
| `description` | `string` | Description of what the tool does |
| `parameters` | `z.ZodType` | Zod schema for tool parameters |
| `execute` | `(params) => Promise<R> \| R` | Function that executes the tool |

---

## Context Management

[`ContextStack`](../src/context.ts:22) manages conversation history with configurable token limits and automatic pruning:

```typescript
import { ContextStack } from "lmscript";

const ctx = new ContextStack({
  maxTokens: 4096,           // Maximum token budget
  pruneStrategy: "fifo",     // "fifo" or "summarize"
});

// Push messages
await ctx.push({ role: "user", content: "Hello" });
await ctx.push({ role: "assistant", content: "Hi there!" });

// Query state
ctx.getMessages();    // ChatMessage[]
ctx.getTokenCount();  // Estimated token count (~4 chars per token)
ctx.length;           // Number of messages
ctx.clear();          // Reset
```

### Pruning Strategies

- **`"fifo"`** (default) — Removes the oldest non-system messages first. System messages are always preserved because they anchor the persona.
- **`"summarize"`** — Summarizes the oldest half of non-system messages using a custom summarizer function, then replaces them with a single summary message. Falls back to FIFO if the summarizer isn't set or if still over budget after summarization.

#### Setting Up Summarization

```typescript
const ctx = new ContextStack({
  maxTokens: 4096,
  pruneStrategy: "summarize",
});

ctx.setSummarizer(async (messages) => {
  // Use an LLM to summarize the conversation
  const result = await runtime.execute(SummarizeFunction, messages);
  return result.data.summary;
});
```

---

## Conversational Sessions

[`Session`](../src/session.ts:13) wraps a runtime and an LLM function with a [`ContextStack`](../src/context.ts:22) to manage multi-turn conversations:

```typescript
import { Session, ContextStack } from "lmscript";

// Create a session
const session = new Session(
  runtime,
  ChatFunction,
  new ContextStack({ maxTokens: 8192, pruneStrategy: "fifo" })
);

// Each send() call builds on the previous conversation
const r1 = await session.send("What is TypeScript?");
const r2 = await session.send("How does it compare to JavaScript?");
// r2 has full conversation context from r1

// Or use the runtime's factory method
const session2 = runtime.createSession(ChatFunction, {
  maxTokens: 8192,
  pruneStrategy: "fifo",
});
```

### Session API

| Method | Description |
|---|---|
| `send(input)` | Send a message and get a validated response |
| `getHistory()` | Get the full conversation history as `ChatMessage[]` |
| `clearHistory()` | Reset the conversation |
| `getTokenCount()` | Get estimated token count of current context |

---

## Error Handling and Retries

The runtime automatically retries when the LLM's output fails schema validation:

1. On validation failure, the Zod error is formatted and sent back to the LLM as a follow-up message
2. The LLM is asked to fix its response
3. This repeats up to `maxRetries` times (default: 2, configurable per-function or globally)

If all retries are exhausted, the runtime throws with a descriptive error:

```typescript
try {
  const result = await runtime.execute(MyFunction, input);
} catch (error) {
  // Error: [lmscript] Compilation failed for "MyFunction" after 3 attempts.
  // Last error: score: Expected number, received string; issues: Required
  console.error(error.message);
}
```

### Special Error Types

| Error | When It's Thrown |
|---|---|
| `Error` (generic) | Schema validation failure after all retries |
| [`BudgetExceededError`](../src/cost-tracker.ts:6) | Token or cost budget limit exceeded (not retryable) |
| [`AllProvidersFailedError`](../src/providers/fallback.ts:8) | All providers in a fallback chain failed |

`BudgetExceededError` is never retried — it's thrown immediately and propagates up.

---

## Retry Configuration

The runtime supports configurable exponential backoff with jitter for retries. When an LLM call fails schema validation, the retry delay follows this formula:

```
delay = min(baseDelay × backoffMultiplier^attempt + random_jitter, maxDelay)
```

### RetryConfig

Configure retry backoff via [`RetryConfig`](../src/types.ts:131) at the runtime level or per-function:

```typescript
import { LScriptRuntime } from "lmscript";

const runtime = new LScriptRuntime({
  provider: myProvider,
  retryConfig: {
    baseDelay: 1000,       // Start with 1s delay (default: 1000)
    maxDelay: 30_000,      // Cap at 30s (default: 30000)
    jitterFactor: 0.2,     // ±20% randomness to prevent thundering herd (default: 0.2)
  },
});
```

### Per-Function Override

Each [`LScriptFunction`](../src/types.ts:97) can override the global retry config:

```typescript
const StrictAnalysis: LScriptFunction<string, typeof Schema> = {
  name: "StrictAnalysis",
  model: "gpt-4o",
  system: "You are a strict analyst.",
  prompt: (text) => `Analyze: ${text}`,
  schema: AnalysisSchema,
  maxRetries: 5,
  retryConfig: {
    baseDelay: 2000,       // More conservative backoff for this function
    maxDelay: 60_000,
    jitterFactor: 0.3,
  },
};
```

### RetryConfig Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `baseDelay` | `number` | `1000` | Base delay in ms for exponential backoff |
| `maxDelay` | `number` | `30000` | Maximum delay in ms |
| `jitterFactor` | `number` | `0.2` | Jitter factor (0–1). Adds randomness to prevent thundering herd |

The jitter prevents multiple concurrent requests from retrying at exactly the same time, which would cause a "thundering herd" effect on the API.

---

## Multi-Modal Messages

L-Script supports multi-modal messages through [`ContentBlock`](../src/types.ts:39) types. Instead of passing a plain string as message content, you can pass an array of content blocks that mix text and images.

### Content Block Types

| Type | Interface | Description |
|---|---|---|
| Text | [`TextContent`](../src/types.ts:14) | A text block: `{ type: "text", text: "..." }` |
| Image URL | [`ImageUrlContent`](../src/types.ts:20) | An image from a URL: `{ type: "image_url", image_url: { url, detail? } }` |
| Image Base64 | [`ImageBase64Content`](../src/types.ts:30) | An inline base64 image: `{ type: "image_base64", mediaType, data }` |

[`MessageContent`](../src/types.ts:42) is defined as `string | ContentBlock[]`, so existing string-based code continues to work unchanged.

### Sending Messages with Images

```typescript
import type { ChatMessage, ContentBlock } from "lmscript";

const messages: ChatMessage[] = [
  {
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/photo.jpg",
          detail: "high",  // "auto" | "low" | "high"
        },
      },
    ],
  },
];
```

Or with base64-encoded images:

```typescript
const imageMessage: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "Describe this diagram." },
    {
      type: "image_base64",
      mediaType: "image/png",
      data: fs.readFileSync("diagram.png").toString("base64"),
    },
  ],
};
```

### Extracting Text from Multi-Modal Content

Use [`extractText()`](../src/content.ts:13) to get the text portion of any message content, which is useful for providers that don't support images or for token estimation:

```typescript
import { extractText } from "lmscript";

const content: MessageContent = [
  { type: "text", text: "Hello" },
  { type: "image_url", image_url: { url: "https://example.com/img.jpg" } },
  { type: "text", text: "What is this?" },
];

const text = extractText(content); // "Hello\nWhat is this?"
```

### Provider-Specific Formatting

Content blocks are automatically converted to each provider's native format using the utilities in [`src/content.ts`](../src/content.ts):

| Utility | Target Provider | Notes |
|---|---|---|
| [`toOpenAIContent()`](../src/content.ts:68) | OpenAI, OpenRouter, DeepSeek | Base64 images converted to data URIs |
| [`toAnthropicContent()`](../src/content.ts:102) | Anthropic, Vertex Anthropic | URL images not supported (skipped) |
| [`toGeminiParts()`](../src/content.ts:136) | Google Gemini | URL images not supported (skipped) |

---

## Agent Loop

The [`AgentLoop`](../src/agent.ts:47) provides iterative tool-calling execution. Unlike single-shot [`execute()`](../src/runtime.ts:40), the agent loop repeatedly calls the LLM until it produces a final text response (no more tool calls) or `maxIterations` is reached.

### Basic Usage

```typescript
import { AgentLoop } from "lmscript";

const agent = new AgentLoop(runtime, {
  maxIterations: 10,  // Maximum LLM call rounds (default: 10)
});

const result = await agent.run(MyToolFunction, userInput);
console.log(result.data);        // Final validated output
console.log(result.iterations);  // Number of LLM rounds used
console.log(result.toolCalls);   // All tool calls across all iterations
```

You can also use the runtime's [`executeAgent()`](../src/runtime.ts) method directly:

```typescript
const result = await runtime.executeAgent(MyToolFunction, userInput, {
  maxIterations: 5,
});
```

### Tool-Calling Agent Example

```typescript
import { z } from "zod";
import type { LScriptFunction, ToolDefinition } from "lmscript";
import { AgentLoop } from "lmscript";

// Define tools the agent can use
const SearchTool: ToolDefinition = {
  name: "search",
  description: "Search for information on a topic",
  parameters: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    return await searchAPI(query);
  },
};

const CalculateTool: ToolDefinition = {
  name: "calculate",
  description: "Perform a mathematical calculation",
  parameters: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: ({ expression }) => eval(expression),
};

// Define the agent function with tools
const ResearchAgent: LScriptFunction<string, typeof ResearchSchema> = {
  name: "ResearchAgent",
  model: "gpt-4o",
  system: "You are a research assistant. Use tools to find information, then synthesize a report.",
  prompt: (question) => question,
  schema: ResearchSchema,
  tools: [SearchTool, CalculateTool],
};

// Run the agent loop
const agent = new AgentLoop(runtime, {
  maxIterations: 10,
  onToolCall: (tc) => console.log(`Tool called: ${tc.name}`),
  onIteration: (i, resp) => console.log(`Iteration ${i}: ${resp.slice(0, 100)}...`),
});

const result = await agent.run(ResearchAgent, "What is the GDP of France?");
```

### AgentConfig Options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxIterations` | `number` | `10` | Maximum number of LLM call iterations |
| `onToolCall` | `(toolCall) => void \| boolean` | — | Callback after each tool execution. Return `false` to stop early |
| `onIteration` | `(iteration, response) => void \| boolean` | — | Callback after each LLM response. Return `false` to stop early |

### AgentResult Properties

| Property | Type | Description |
|---|---|---|
| `data` | `T` | The final validated output |
| `toolCalls` | [`ToolCall[]`](../src/types.ts:225) | All tool calls made across all iterations |
| `iterations` | `number` | Number of LLM call iterations used |
| `usage` | `{ promptTokens, completionTokens, totalTokens }` | Total token usage across all iterations |

### Iteration Flow

1. The LLM is called with the function definition and tools
2. If the LLM responds with tool calls, each tool is executed and results are fed back
3. The LLM is called again with the tool results in context
4. Steps 2–3 repeat until the LLM produces a final text response (no tool calls) or `maxIterations` is reached
5. The final response is validated against the schema and returned

---

## Next Steps

- [Middleware & Pipelines](./middleware-and-pipelines.md) — Chain functions, add lifecycle hooks
- [Providers](./providers.md) — Switch between LLM providers
- [Advanced Topics](./advanced.md) — Caching, cost tracking, parallel execution
