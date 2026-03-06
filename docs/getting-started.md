# Getting Started

[← Back to Index](./README.md)

---

## Prerequisites

- **Node.js** ≥ 18.0.0
- **TypeScript** ≥ 5.5 (recommended)
- An API key for at least one LLM provider (OpenAI, Anthropic, Google Gemini), or a local model server (Ollama, LM Studio)

---

## Installation

```bash
npm install @sschepis/lmscript
```

L-Script has only two runtime dependencies:

| Package | Purpose |
|---|---|
| [`zod`](https://zod.dev/) | Schema definition and validation |
| [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) | Converting Zod schemas to JSON Schema for LLM instructions |

---

## Your First LLM Function

An [`LScriptFunction`](../src/types.ts:55) is a typed object that fully describes an LLM call: the model, system prompt, prompt template, output schema, and optional configuration.

### Step 1: Define an output schema

```typescript
import { z } from "zod";

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
```

### Step 2: Define the LLM function

```typescript
import type { LScriptFunction } from "lmscript";

const AnalyzeSentiment: LScriptFunction<string, typeof SentimentSchema> = {
  name: "AnalyzeSentiment",
  model: "gpt-4o",
  system: "You are a sentiment analysis expert.",
  prompt: (text) => `Analyze the sentiment of this text:\n${text}`,
  schema: SentimentSchema,
  temperature: 0.3,
};
```

The generic parameters `<string, typeof SentimentSchema>` mean:
- **Input type** (`I`): the function accepts a `string`
- **Output schema** (`O`): the function returns data matching `SentimentSchema`

### Step 3: Create a runtime and execute

```typescript
import { LScriptRuntime, OpenAIProvider } from "lmscript";

const runtime = new LScriptRuntime({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
  }),
});

const result = await runtime.execute(AnalyzeSentiment, "I love this product!");
// result.data is fully typed: { sentiment, confidence, summary }
console.log(result.data.sentiment);  // "positive"
console.log(result.attempts);        // number of attempts needed
console.log(result.usage);           // token usage stats
```

---

## What Happens Under the Hood

When you call [`runtime.execute()`](../src/runtime.ts:79), the runtime:

1. **Converts** the Zod schema to JSON Schema using `zod-to-json-schema`
2. **Injects** the JSON Schema into the system prompt with strict formatting instructions
3. **Builds** the prompt by calling `fn.prompt(input)`
4. **Includes** few-shot examples (if any) as user/assistant message pairs
5. **Sends** the request to the configured provider with `jsonMode: true`
6. **Parses** the LLM's response as JSON (stripping markdown code fences if present)
7. **Validates** the parsed JSON against the Zod schema
8. **Retries** with error feedback if validation fails (up to `maxRetries` times)
9. **Returns** a typed [`ExecutionResult<T>`](../src/types.ts:127) on success

---

## Using Environment Variables

A common pattern is to configure providers via environment variables:

```bash
# .env or shell export
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
```

```typescript
import { OpenAIProvider, AnthropicProvider, GeminiProvider } from "lmscript";

const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const gemini = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! });
```

---

## Using Local Models

For local model servers, no API key is required:

```typescript
import { OllamaProvider, LMStudioProvider } from "lmscript";

// Ollama (default: http://localhost:11434)
const ollama = new OllamaProvider({
  apiKey: "unused",
  baseUrl: "http://localhost:11434/api/chat",
});

// LM Studio (default: http://localhost:1234)
const lmstudio = new LMStudioProvider(); // no config needed
```

---

## Project Structure

A typical L-Script project looks like this:

```
my-project/
├── src/
│   ├── functions/          # LScriptFunction definitions
│   │   ├── analyze.ts
│   │   └── classify.ts
│   ├── schemas/            # Zod schemas (reusable)
│   │   └── sentiment.ts
│   └── index.ts            # Runtime setup and orchestration
├── scripts/                # .ls DSL files (optional)
│   └── security-review.ls
├── tests/
│   └── functions.test.ts
├── package.json
└── tsconfig.json
```

---

## Next Steps

- [User Guide](./user-guide.md) — Deep dive into all core concepts
- [Providers](./providers.md) — Configure and switch between LLM providers
- [DSL Reference](./dsl-reference.md) — Write LLM functions in `.ls` files
- [API Reference](./api-reference.md) — Complete API documentation
