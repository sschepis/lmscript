# Examples

[← Back to Index](./README.md)

---

## Table of Contents

1. [Sentiment Analysis](#sentiment-analysis)
2. [Security Code Review](#security-code-review)
3. [Multi-Agent Critique Pipeline](#multi-agent-critique-pipeline)
4. [Conversational Tutor](#conversational-tutor)
5. [Batch Processing](#batch-processing)
6. [DSL-Based Functions](#dsl-based-functions)
7. [Production Stack](#production-stack)
8. [Research Agent with Tools](#research-agent-with-tools)
9. [Agent Loop (Iterative Tool Calling)](#agent-loop-iterative-tool-calling)
10. [RAG Pipeline (Retrieval-Augmented Generation)](#rag-pipeline-retrieval-augmented-generation)
11. [Prompt A/B Testing](#prompt-ab-testing)
12. [Rate Limiting](#rate-limiting)
13. [Circuit Breaker + Fallback Provider](#circuit-breaker--fallback-provider)
14. [Multi-Modal Messages](#multi-modal-messages)
15. [OpenTelemetry Integration](#opentelemetry-integration)
16. [Batch Job Manager](#batch-job-manager)

---

## Sentiment Analysis

A simple function that classifies text sentiment with a confidence score.

```typescript
import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "lmscript";
import type { LScriptFunction } from "lmscript";

// Schema
const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  key_phrases: z.array(z.string()),
});

// Function definition
const AnalyzeSentiment: LScriptFunction<string, typeof SentimentSchema> = {
  name: "AnalyzeSentiment",
  model: "gpt-4o",
  system: "You are a sentiment analysis expert. Analyze text objectively.",
  prompt: (text) => `Analyze the sentiment of this text:\n\n${text}`,
  schema: SentimentSchema,
  temperature: 0.2,
  examples: [
    {
      input: "This product is amazing!",
      output: {
        sentiment: "positive",
        confidence: 0.95,
        summary: "Strong positive sentiment about product quality",
        key_phrases: ["amazing"],
      },
    },
  ],
};

// Execution
const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await runtime.execute(
  AnalyzeSentiment,
  "The new update broke my workflow. Very frustrating."
);

console.log(result.data);
// {
//   sentiment: "negative",
//   confidence: 0.9,
//   summary: "User frustrated with a broken update",
//   key_phrases: ["broke", "frustrating"]
// }
```

**Source**: [`src/examples/sentiment-analysis.ts`](../src/examples/sentiment-analysis.ts)

---

## Security Code Review

Review code for security vulnerabilities using typed output.

```typescript
import { z } from "zod";
import type { LScriptFunction } from "lmscript";

const CritiqueSchema = z.object({
  score: z.number().min(1).max(10),
  vulnerabilities: z.array(z.string()),
  suggested_fix: z.string(),
});

const SecurityReviewer: LScriptFunction<string, typeof CritiqueSchema> = {
  name: "SecurityReviewer",
  model: "gpt-4o",
  system: "You are a senior security researcher. Be pedantic and skeptical.",
  prompt: (code) => `Review the following function for security flaws:\n\`\`\`\n${code}\n\`\`\``,
  schema: CritiqueSchema,
  temperature: 0.2,
};

const result = await runtime.execute(SecurityReviewer, `
function login(username, password) {
  const query = "SELECT * FROM users WHERE name='" + username + "'";
  return db.query(query);
}
`);

console.log(result.data.vulnerabilities);
// ["SQL injection via string concatenation", ...]
```

This same function can be defined in the L-Script DSL:

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

**Source**: [`src/examples/security-reviewer.ts`](../src/examples/security-reviewer.ts), [`examples/security-review.ls`](../examples/security-review.ls)

---

## Multi-Agent Critique Pipeline

Chain multiple LLM "agents" where each critiques the previous output.

```typescript
import { z } from "zod";
import { Pipeline } from "lmscript";
import type { LScriptFunction } from "lmscript";

// Step 1: Generate a draft
const DraftSchema = z.object({
  title: z.string(),
  content: z.string(),
  approach: z.string(),
});

const GenerateDraft: LScriptFunction<string, typeof DraftSchema> = {
  name: "GenerateDraft",
  model: "gpt-4o",
  system: "You are a technical writer.",
  prompt: (topic) => `Write a brief technical draft about: ${topic}`,
  schema: DraftSchema,
  temperature: 0.7,
};

// Step 2: Critique the draft
const CritiqueSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
  revised_content: z.string(),
});

const CritiqueDraft: LScriptFunction<z.infer<typeof DraftSchema>, typeof CritiqueSchema> = {
  name: "CritiqueDraft",
  model: "gpt-4o",
  system: "You are a senior technical editor. Be constructive but thorough.",
  prompt: (draft) =>
    `Critique this draft:\n\nTitle: ${draft.title}\n\n${draft.content}\n\nApproach: ${draft.approach}`,
  schema: CritiqueSchema,
  temperature: 0.3,
};

// Build and execute pipeline
const pipeline = Pipeline.from(GenerateDraft).pipe(CritiqueDraft);
const result = await pipeline.execute(runtime, "microservices vs monoliths");

console.log(result.finalData.suggestions);
console.log(`Total tokens: ${result.totalUsage.totalTokens}`);
console.log(`Steps: ${result.steps.length}`);
```

**Source**: [`src/examples/multi-agent-critique.ts`](../src/examples/multi-agent-critique.ts)

---

## Conversational Tutor

A multi-turn conversational session that maintains context.

```typescript
import { z } from "zod";
import { LScriptRuntime, OpenAIProvider, ContextStack, Session } from "lmscript";

const TutorSchema = z.object({
  explanation: z.string(),
  follow_up_questions: z.array(z.string()),
  difficulty_level: z.enum(["beginner", "intermediate", "advanced"]),
});

const TutorFunction: LScriptFunction<string, typeof TutorSchema> = {
  name: "Tutor",
  model: "gpt-4o",
  system: "You are a patient programming tutor. Adapt explanations to the student's level.",
  prompt: (question) => question,
  schema: TutorSchema,
  temperature: 0.5,
};

const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

// Create session with context management
const session = new Session(
  runtime,
  TutorFunction,
  new ContextStack({ maxTokens: 8192, pruneStrategy: "fifo" })
);

// Multi-turn conversation
const r1 = await session.send("What is a closure in JavaScript?");
console.log(r1.data.explanation);
// Detailed explanation of closures...

const r2 = await session.send("Can you give me a practical example?");
console.log(r2.data.explanation);
// Builds on the previous answer about closures...

const r3 = await session.send("How do closures relate to React hooks?");
console.log(r3.data.explanation);
// Connects closures to React hooks with full conversation context...

console.log(`Token usage: ${session.getTokenCount()}`);
console.log(`History: ${session.getHistory().length} messages`);
```

**Source**: [`src/examples/conversational-tutor.ts`](../src/examples/conversational-tutor.ts)

---

## Batch Processing

Process multiple inputs concurrently with rate limiting.

```typescript
import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "lmscript";

const ClassifySchema = z.object({
  category: z.string(),
  confidence: z.number(),
  tags: z.array(z.string()),
});

const ClassifyDocument: LScriptFunction<string, typeof ClassifySchema> = {
  name: "ClassifyDocument",
  model: "gpt-4o",
  system: "Classify documents into categories.",
  prompt: (doc) => `Classify this document:\n${doc}`,
  schema: ClassifySchema,
  temperature: 0.2,
};

const documents = [
  "Quarterly revenue increased 15%...",
  "New security patch released for...",
  "Employee satisfaction survey results...",
  // ... hundreds more
];

// Batch with concurrency limit
const results = await runtime.executeBatch(
  ClassifyDocument,
  documents,
  { concurrency: 5 }  // Max 5 concurrent API calls
);

for (const result of results) {
  console.log(`${result.data.category}: ${result.data.tags.join(", ")}`);
}

// Or use executeAll for different functions
const parallelResults = await runtime.executeAll([
  { name: "sentiment", fn: AnalyzeSentiment, input: text },
  { name: "entities", fn: ExtractEntities, input: text },
  { name: "topic", fn: ClassifyTopic, input: text },
]);

console.log(`Success: ${parallelResults.successCount}/${parallelResults.tasks.length}`);
```

**Source**: [`src/examples/batch-processor.ts`](../src/examples/batch-processor.ts)

---

## DSL-Based Functions

Using the L-Script DSL to define functions in `.ls` files.

### Translation Agent (`.ls` file)

```ls
// translation.ls

type Translation = {
  original_language: string,
  target_language: string,
  translated_text: string,
  confidence: number(min=0, max=1),
  alternative_translations: string[]
}

llm Translator(text: string) -> Translation {
  model: "gpt-4o"
  temperature: 0.3
  system: "You are a professional translator. Detect the source language automatically."
  prompt:
    """
    Translate the following text to English:
    {{text}}
    """
}
```

### Using Compiled DSL Functions

```typescript
import { compileFile, LScriptRuntime, OpenAIProvider } from "lmscript";
import { readFileSync } from "fs";

// Read and compile the .ls file
const source = readFileSync("./translation.ls", "utf-8");
const module = compileFile(source);

// Get the compiled function
const translator = module.functions.get("Translator")!;

// Execute it like any other LScriptFunction
const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await runtime.execute(translator, "Bonjour le monde!");
console.log(result.data);
// {
//   original_language: "French",
//   target_language: "English",
//   translated_text: "Hello world!",
//   confidence: 0.98,
//   alternative_translations: ["Hello, world!", "Greetings, world!"]
// }
```

**Source**: [`examples/translation.ls`](../examples/translation.ls), [`src/examples/dsl-demo.ts`](../src/examples/dsl-demo.ts)

---

## Production Stack

A full production setup with middleware, caching, cost tracking, logging, and provider routing.

```typescript
import {
  LScriptRuntime,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
  ModelRouter,
  FallbackProvider,
  MiddlewareManager,
  ExecutionCache,
  MemoryCacheBackend,
  CostTracker,
  Logger,
  ConsoleTransport,
  LogLevel,
} from "lmscript";

// 1. Set up providers
const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const ollama = new OllamaProvider({ apiKey: "unused" });

// 2. Configure routing with fallback
const router = new ModelRouter({
  rules: [
    { match: /^gpt-/, provider: new FallbackProvider([openai, anthropic]) },
    { match: /^claude-/, provider: anthropic },
  ],
  defaultProvider: ollama,
});

// 3. Set up middleware
const middleware = new MiddlewareManager();
middleware.use({
  onBeforeExecute: (ctx) => console.log(`[START] ${ctx.fn.name}`),
  onComplete: (ctx, result) => {
    const elapsed = Date.now() - ctx.startTime;
    console.log(`[DONE] ${ctx.fn.name} in ${elapsed}ms (${result.attempts} attempts)`);
  },
  onError: (ctx, error) => console.error(`[FAIL] ${ctx.fn.name}: ${error.message}`),
});

// 4. Set up caching
const cache = new ExecutionCache(new MemoryCacheBackend());

// 5. Set up cost tracking
const costTracker = new CostTracker();

// 6. Set up logging
const logger = new Logger({
  level: LogLevel.INFO,
  transports: [new ConsoleTransport()],
});

// 7. Create runtime
const runtime = new LScriptRuntime({
  provider: router,
  middleware,
  cache,
  costTracker,
  budget: {
    maxTotalCost: 10.00,
    maxTotalTokens: 1_000_000,
  },
  logger,
});

// Execute functions
const result = await runtime.execute(MyFunction, input);

// Check costs
console.log(`Total tokens: ${costTracker.getTotalTokens()}`);
console.log(`Usage by function:`, costTracker.getUsageByFunction());
```

**Source**: [`src/examples/production-stack.ts`](../src/examples/production-stack.ts), [`src/examples/production-stack-lmstudio.ts`](../src/examples/production-stack-lmstudio.ts)

---

## Research Agent with Tools

An LLM function with tool calling for external data access.

```typescript
import { z } from "zod";
import type { LScriptFunction, ToolDefinition } from "lmscript";

// Define tools
const SearchTool: ToolDefinition = {
  name: "search_web",
  description: "Search the web for information",
  parameters: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().describe("Max results to return"),
  }),
  execute: async ({ query, maxResults }) => {
    // Your search API integration
    const results = await searchAPI.search(query, maxResults ?? 5);
    return results.map(r => ({ title: r.title, snippet: r.snippet }));
  },
};

const CalculatorTool: ToolDefinition = {
  name: "calculate",
  description: "Perform mathematical calculations",
  parameters: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: ({ expression }) => {
    return { result: eval(expression) }; // Use a safe math parser in production
  },
};

// Define the research function
const ResearchSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const ResearchAgent: LScriptFunction<string, typeof ResearchSchema> = {
  name: "ResearchAgent",
  model: "gpt-4o",
  system: "You are a research assistant. Use tools to find accurate information.",
  prompt: (question) => question,
  schema: ResearchSchema,
  tools: [SearchTool, CalculatorTool],
  temperature: 0.3,
};

const result = await runtime.execute(
  ResearchAgent,
  "What is the population of Tokyo and how does it compare to New York?"
);

console.log(result.data.answer);
console.log(result.toolCalls); // Shows which tools were called and their results
```

**Source**: [`src/examples/research-agent.ts`](../src/examples/research-agent.ts)

---

## Agent Loop (Iterative Tool Calling)

Demonstrates `AgentLoop` and `runtime.executeAgent()` for multi-step tool-calling workflows where the LLM iteratively calls tools until it produces a final answer.

```typescript
import { z } from "zod";
import { LScriptRuntime, AgentLoop } from "lmscript";
import type { AgentConfig, LScriptFunction, ToolDefinition, ToolCall } from "lmscript";

// Define tools
const calculatorTool: ToolDefinition = {
  name: "calculator",
  description: "Perform basic arithmetic.",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: (params) => {
    switch (params.operation) {
      case "add": return { result: params.a + params.b };
      case "multiply": return { result: params.a * params.b };
      // ...
    }
  },
};

// Define agent function with tools
const assistantFn: LScriptFunction<string, typeof ResultSchema> = {
  name: "SmartAssistant",
  model: "gpt-4o",
  system: "You are a helpful assistant with tools.",
  prompt: (question) => question,
  schema: ResultSchema,
  tools: [calculatorTool, weatherTool],
};

// Run with AgentLoop class
const agentLoop = new AgentLoop(runtime, {
  maxIterations: 5,
  onToolCall: (tc: ToolCall) => console.log(`Tool: ${tc.name}`),
  onIteration: (i, response) => console.log(`Iteration ${i}`),
});

const result = await agentLoop.run(assistantFn, "What is 25 × 4?");
console.log(result.data);       // Final typed answer
console.log(result.iterations); // Number of LLM calls
console.log(result.toolCalls);  // All tool calls made
```

**Key Takeaways:**
- `AgentLoop` wraps `runtime.executeAgent()` with callbacks for observability
- Tools are defined with Zod parameter schemas and `execute` functions
- The agent iterates until no more tool calls or `maxIterations` is reached
- Use `onToolCall` and `onIteration` callbacks to monitor progress

**Source**: [`src/examples/agent-loop-demo.ts`](../src/examples/agent-loop-demo.ts)

---

## RAG Pipeline (Retrieval-Augmented Generation)

Demonstrates `MemoryVectorStore`, `RAGPipeline`, and custom `EmbeddingProvider` for retrieval-augmented generation workflows.

```typescript
import { LScriptRuntime, MemoryVectorStore, RAGPipeline, cosineSimilarity } from "lmscript";
import type { EmbeddingProvider } from "lmscript";

// Custom embedding provider (replace with OpenAIEmbeddingProvider in production)
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock-embeddings";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashToVector(text));
  }
  private hashToVector(text: string): number[] { /* ... */ }
}

// Create RAG pipeline
const embeddingProvider = new MockEmbeddingProvider();
const vectorStore = new MemoryVectorStore();
const rag = new RAGPipeline(runtime, {
  embeddingProvider,
  vectorStore,
  topK: 3,       // Retrieve top 3 documents
  minScore: 0.1, // Minimum similarity threshold
});

// Ingest documents
await rag.ingest([
  { id: "doc-1", content: "TypeScript adds static typing to JavaScript.", metadata: { topic: "ts" } },
  { id: "doc-2", content: "React uses a virtual DOM for rendering.", metadata: { topic: "react" } },
]);

// Query with augmented context
const result = await rag.query(qaFunction, "What is TypeScript?");
console.log(result.result.data);          // LLM answer
console.log(result.retrievedDocuments);   // Retrieved docs with scores
console.log(result.context);             // Formatted context string
```

**Key Takeaways:**
- `MemoryVectorStore` provides in-memory cosine similarity search
- `RAGPipeline.ingest()` automatically embeds and stores documents
- `RAGPipeline.query()` retrieves context and augments the LLM prompt
- Use `cosineSimilarity()` for direct vector comparison

**Source**: [`src/examples/rag-pipeline-demo.ts`](../src/examples/rag-pipeline-demo.ts)

---

## Prompt A/B Testing

Demonstrates `PromptRegistry` for managing prompt variants, weighted A/B testing, and identifying the best-performing variant.

```typescript
import { PromptRegistry } from "lmscript";
import type { PromptVariant, ExecutionResult } from "lmscript";

const registry = new PromptRegistry({ strategy: "weighted" });

// Register variants with different weights
registry.registerVariants("Summarizer", [
  { name: "control", system: "Produce concise summaries.", weight: 1 },
  { name: "detailed", system: "Produce thorough summaries.", temperature: 0.3, weight: 2 },
  { name: "brief", system: "Produce tweet-length summaries.", weight: 1 },
]);

// Selection follows weight distribution
const variant = registry.selectVariant("Summarizer"); // "detailed" selected ~50%

// Record results after execution
registry.recordResult("Summarizer", "detailed", executionResult);
registry.recordFailure("Summarizer", "brief");

// Get metrics and find the winner
const metrics = registry.getMetrics("Summarizer");
const best = registry.getBestVariant("Summarizer");
console.log(`Best: ${best.name} (${(best.successRate * 100).toFixed(1)}% success rate)`);

// Apply variant to create a modified function
const modifiedFn = registry.applyVariant(baseFn, variant);
```

**Key Takeaways:**
- Supports `"weighted"`, `"random"`, and `"round-robin"` selection strategies
- `recordResult()` / `recordFailure()` track per-variant metrics
- `getBestVariant()` ranks by success rate, then by token efficiency
- `applyVariant()` creates a new function with the variant's overrides

**Source**: [`src/examples/prompt-ab-testing.ts`](../src/examples/prompt-ab-testing.ts)

---

## Rate Limiting

Demonstrates `RateLimiter` with sliding-window RPM and TPM throttling.

```typescript
import { RateLimiter } from "lmscript";

// Configure limits
const limiter = new RateLimiter({
  requestsPerMinute: 60,  // Max 60 requests per minute
  tokensPerMinute: 100000, // Max 100k tokens per minute
});

// acquire() blocks until a slot is available
await limiter.acquire();
const response = await provider.chat(request);

// Report token usage for TPM tracking
limiter.reportTokens(response.usage.totalTokens);

// Integrate with LScriptRuntime
const runtime = new LScriptRuntime({
  provider: myProvider,
  rateLimiter: limiter, // Automatically applied to all execute() calls
});
```

**Key Takeaways:**
- `acquire()` uses a sliding 60-second window — it blocks (awaits) when limits are hit
- `reportTokens()` records token consumption for TPM enforcement
- Pass the limiter to `RuntimeConfig.rateLimiter` for automatic integration
- Both RPM and TPM can be configured independently or together

**Source**: [`src/examples/rate-limiting-demo.ts`](../src/examples/rate-limiting-demo.ts)

---

## Circuit Breaker + Fallback Provider

Demonstrates `CircuitBreaker` for fault tolerance and `FallbackProvider` for automatic failover between providers.

```typescript
import { CircuitBreaker, FallbackProvider } from "lmscript";

// Standalone circuit breaker
const breaker = new CircuitBreaker({
  failureThreshold: 3,    // Open after 3 failures
  resetTimeout: 30000,    // Try half-open after 30s
  successThreshold: 2,    // Close after 2 successes in half-open
});

if (breaker.isAllowed()) {
  try {
    await makeRequest();
    breaker.recordSuccess();   // closed or half-open → track
  } catch {
    breaker.recordFailure();   // may trip to open
  }
}

console.log(breaker.getState()); // "closed" | "open" | "half-open"

// FallbackProvider with built-in circuit breakers
const provider = new FallbackProvider([primaryProvider, fallbackProvider], {
  retryDelay: 100,
  circuitBreaker: { failureThreshold: 3, resetTimeout: 30000 },
});

const response = await provider.chat(request); // Tries primary, falls back on failure

// Monitor provider health
const health = provider.getProviderHealth();
// [{ name: "primary", state: "open", failureCount: 3 },
//  { name: "fallback", state: "closed", failureCount: 0 }]
```

**Key Takeaways:**
- Circuit breaker transitions: **closed** → (failures) → **open** → (timeout) → **half-open** → (successes) → **closed**
- `FallbackProvider` tries providers in order; failing providers' circuits open automatically
- `getProviderHealth()` shows real-time state of each provider's circuit
- When all circuits are open, the provider with the oldest failure is tried as a safety fallback

**Source**: [`src/examples/circuit-breaker-demo.ts`](../src/examples/circuit-breaker-demo.ts)

---

## Multi-Modal Messages

Demonstrates creating messages with text + image content blocks using `ContentBlock` types and `extractText()`.

```typescript
import { extractText } from "lmscript";
import type { ContentBlock, TextContent, ImageUrlContent, ImageBase64Content } from "lmscript";

// Text + image URL message
const content: ContentBlock[] = [
  { type: "text", text: "Describe this image:" },
  { type: "image_url", image_url: { url: "https://example.com/photo.jpg", detail: "high" } },
];

// Base64 image message
const base64Content: ContentBlock[] = [
  { type: "text", text: "What object is shown?" },
  { type: "image_base64", mediaType: "image/png", data: "iVBORw0KGgo..." },
];

// Extract text from mixed content (strips image blocks)
const text = extractText(content); // "Describe this image:"

// Use with ChatMessage
const message: ChatMessage = { role: "user", content };
```

**Key Takeaways:**
- Three content block types: `TextContent`, `ImageUrlContent`, `ImageBase64Content`
- `extractText()` extracts only text blocks — useful for token estimation and fallback
- Image URL blocks support `detail: "auto" | "low" | "high"` for token optimization
- Providers automatically convert content blocks to their native format

**Source**: [`src/examples/multimodal-demo.ts`](../src/examples/multimodal-demo.ts)

---

## OpenTelemetry Integration

Demonstrates `createTelemetryMiddleware()` and `OTelLogTransport` for distributed tracing and metrics without a hard dependency on `@opentelemetry/*`.

```typescript
import {
  LScriptRuntime,
  MiddlewareManager,
  Logger,
  LogLevel,
  createTelemetryMiddleware,
  OTelLogTransport,
} from "lmscript";
import type { TelemetryTracer, TelemetryMeter, TelemetryConfig } from "lmscript";

// Create telemetry middleware (uses OTel-compatible interfaces)
const telemetryHooks = createTelemetryMiddleware({
  tracer,             // TelemetryTracer (or real OTel Tracer)
  meter,              // TelemetryMeter (or real OTel Meter)
  metricPrefix: "myapp",
  includePrompts: false,
});

// Register with middleware manager
const middleware = new MiddlewareManager();
middleware.use(telemetryHooks);

// Forward logs to tracing
const otelTransport = new OTelLogTransport(tracer);
const logger = new Logger({ level: LogLevel.INFO, transports: [otelTransport] });

// Create runtime with telemetry
const runtime = new LScriptRuntime({ provider, middleware, logger });

// Executions automatically emit:
// - Spans: myapp.execute (with function name, model, duration, tokens)
// - Counters: myapp.executions, myapp.tokens
// - Histograms: myapp.duration, myapp.attempts
```

**Key Takeaways:**
- No hard dependency on `@opentelemetry/*` — uses compatible interfaces
- `createTelemetryMiddleware()` returns `MiddlewareHooks` for automatic instrumentation
- `OTelLogTransport` bridges the structured logger to OTel span events
- In production, pass real OTel SDK objects (`trace.getTracer()`, `metrics.getMeter()`)

**Source**: [`src/examples/telemetry-demo.ts`](../src/examples/telemetry-demo.ts)

---

## Batch Job Manager

Demonstrates `BatchManager` for async batch processing with concurrency control, progress tracking, and job management.

```typescript
import { LScriptRuntime, BatchManager } from "lmscript";
import type { BatchRequest, BatchJob } from "lmscript";

const batchManager = new BatchManager(runtime, {
  concurrency: 3,           // Max 3 concurrent requests
  delayBetweenRequests: 50, // 50ms between requests
  continueOnError: true,    // Don't stop on individual failures
  onProgress: (job: BatchJob) => {
    console.log(`${job.completedRequests}/${job.totalRequests} done`);
  },
});

// Submit a batch job
const requests: BatchRequest<string>[] = articles.map((text, i) => ({
  id: `article-${i}`,
  input: text,
}));

const jobId = await batchManager.submit(summarizerFn, requests);

// Track status
const status = batchManager.getJob(jobId);
console.log(status.status); // "pending" | "processing" | "completed" | "failed"

// Wait for completion
const completed = await batchManager.waitForCompletion(jobId);
console.log(completed.completedRequests); // Number of successes
console.log(completed.totalUsage);        // Aggregated token usage

// Job management
batchManager.cancel(jobId);   // Cancel a running job
batchManager.listJobs();      // List all jobs
batchManager.cleanup();       // Remove finished jobs
```

**Key Takeaways:**
- Unlike `runtime.executeBatch()`, `BatchManager` provides job tracking and progress callbacks
- `onProgress` callback fires after each request completes
- `continueOnError: true` processes remaining requests even if some fail
- Use `waitForCompletion()` to block until all requests finish

**Source**: [`src/examples/batch-manager-demo.ts`](../src/examples/batch-manager-demo.ts)

---

## Running Examples

```bash
# Set up API keys
export OPENAI_API_KEY=sk-...

# Run specific examples
npm run example:security
npm run example:sentiment
npm run example:critique
npm run example:research
npm run example:tutor
npm run example:batch
npm run example:dsl
npm run example:production
```

---

## Next Steps

- [Getting Started](./getting-started.md) — Installation and first function
- [User Guide](./user-guide.md) — Deep dive into concepts
- [Advanced Topics](./advanced.md) — Caching, budgets, parallel execution
