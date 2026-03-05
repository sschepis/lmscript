import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { LScriptRuntime } from "../src/runtime.js";
import { ContextStack } from "../src/context.js";
import { Pipeline } from "../src/pipeline.js";
import { MiddlewareManager } from "../src/middleware.js";
import { MemoryCacheBackend, ExecutionCache } from "../src/cache.js";
import { CostTracker, BudgetExceededError } from "../src/cost-tracker.js";
import { Logger, LogLevel, ConsoleTransport, Span } from "../src/logger.js";
import type { LogEntry, LogTransport } from "../src/logger.js";
import { generateManifest, extractFunctions } from "../src/cli.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { ModelRouter } from "../src/router.js";
import type { RoutingRule } from "../src/router.js";
import { FallbackProvider, AllProvidersFailedError } from "../src/providers/fallback.js";
import type { LLMProvider, LLMRequest, LLMResponse, LScriptFunction, StreamResult, ToolDefinition, MiddlewareHooks } from "../src/types.js";
import { Session } from "../src/session.js";
import { trimStringsTransformer, composeTransformers } from "../src/transformer.js";
import { Lexer, TokenType, Parser, compile, compileFile, ParseError } from "../src/dsl/index.js";
import type { Token } from "../src/dsl/index.js";

// ── Mock Provider ───────────────────────────────────────────────────

function createMockProvider(
  responseContent: string,
  failCount = 0
): LLMProvider {
  let calls = 0;
  return {
    name: "mock",
    chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
      calls++;
      if (calls <= failCount) {
        return {
          content: '{"invalid": true}',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      }
      return {
        content: responseContent,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
    }),
  };
}

// ── Test schemas ────────────────────────────────────────────────────

const SimpleSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
});

const CritiqueSchema = z.object({
  score: z.number().min(1).max(10),
  vulnerabilities: z.array(z.string()),
  suggested_fix: z.string(),
});

// ── Test function definitions ───────────────────────────────────────

const SimpleFunction: LScriptFunction<string, typeof SimpleSchema> = {
  name: "SimpleTest",
  model: "test-model",
  system: "You are a helpful assistant.",
  prompt: (input: string) => `Answer this: ${input}`,
  schema: SimpleSchema,
  temperature: 0.5,
};

const SecurityReviewer: LScriptFunction<string, typeof CritiqueSchema> = {
  name: "SecurityReviewer",
  model: "test-model",
  system: "You are a security researcher.",
  prompt: (code: string) => `Review this: ${code}`,
  schema: CritiqueSchema,
  temperature: 0.2,
};

// ── Runtime Tests ───────────────────────────────────────────────────

describe("LScriptRuntime", () => {
  it("should execute a function and return validated output", async () => {
    const provider = createMockProvider(
      JSON.stringify({ answer: "42", confidence: 0.95 })
    );
    const runtime = new LScriptRuntime({ provider });

    const result = await runtime.execute(SimpleFunction, "What is the meaning of life?");

    expect(result.data.answer).toBe("42");
    expect(result.data.confidence).toBe(0.95);
    expect(result.attempts).toBe(1);
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("should validate complex nested schemas", async () => {
    const provider = createMockProvider(
      JSON.stringify({
        score: 3,
        vulnerabilities: ["SQL injection", "No input sanitization"],
        suggested_fix: "Use parameterized queries.",
      })
    );
    const runtime = new LScriptRuntime({ provider });

    const result = await runtime.execute(SecurityReviewer, "SELECT * FROM users");

    expect(result.data.score).toBe(3);
    expect(result.data.vulnerabilities).toHaveLength(2);
    expect(result.data.suggested_fix).toContain("parameterized");
  });

  it("should retry on schema validation failure and succeed", async () => {
    const provider = createMockProvider(
      JSON.stringify({ answer: "hello", confidence: 0.8 }),
      1 // fail first call
    );
    const runtime = new LScriptRuntime({ provider, verbose: false });

    const result = await runtime.execute(SimpleFunction, "test");

    expect(result.attempts).toBe(2);
    expect(result.data.answer).toBe("hello");
  });

  it("should throw after exhausting retries", async () => {
    const provider = createMockProvider("not json at all", 999);
    const fn: LScriptFunction<string, typeof SimpleSchema> = {
      ...SimpleFunction,
      maxRetries: 1,
    };
    const runtime = new LScriptRuntime({ provider });

    await expect(runtime.execute(fn, "test")).rejects.toThrow(
      /Compilation failed/
    );
  });

  it("should handle markdown-wrapped JSON responses", async () => {
    const wrappedJson = '```json\n{"answer": "wrapped", "confidence": 0.5}\n```';
    const provider = createMockProvider(wrappedJson);
    const runtime = new LScriptRuntime({ provider });

    const result = await runtime.execute(SimpleFunction, "test");

    expect(result.data.answer).toBe("wrapped");
    expect(result.data.confidence).toBe(0.5);
  });

  it("should pass correct messages to the provider", async () => {
    const provider = createMockProvider(
      JSON.stringify({ answer: "test", confidence: 0.5 })
    );
    const runtime = new LScriptRuntime({ provider });

    await runtime.execute(SimpleFunction, "my question");

    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    expect(chatFn).toHaveBeenCalledTimes(1);

    const request = chatFn.mock.calls[0][0] as LLMRequest;
    expect(request.model).toBe("test-model");
    expect(request.temperature).toBe(0.5);
    expect(request.jsonMode).toBe(true);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("helpful assistant");
    expect(request.messages[0].content).toContain("JSON SCHEMA");
    expect(request.messages[1].role).toBe("user");
    expect(request.messages[1].content).toContain("my question");
  });
});

// ── ContextStack Tests ──────────────────────────────────────────────

describe("ContextStack", () => {
  it("should store and retrieve messages", () => {
    const stack = new ContextStack({ maxTokens: 10000 });
    stack.push({ role: "user", content: "Hello" });
    stack.push({ role: "assistant", content: "Hi there!" });

    expect(stack.getMessages()).toHaveLength(2);
    expect(stack.length).toBe(2);
  });

  it("should prune old non-system messages when over token limit", () => {
    const stack = new ContextStack({ maxTokens: 50 }); // ~200 chars
    stack.push({ role: "system", content: "You are an assistant." });
    stack.push({ role: "user", content: "A".repeat(100) });
    stack.push({ role: "assistant", content: "B".repeat(100) });
    stack.push({ role: "user", content: "C".repeat(100) });

    // After pruning, system message should remain
    const messages = stack.getMessages();
    expect(messages[0].role).toBe("system");
    // Some non-system messages should have been pruned
    expect(messages.length).toBeLessThan(4);
  });

  it("should preserve system messages during pruning", () => {
    const stack = new ContextStack({ maxTokens: 30 });
    stack.push({ role: "system", content: "System prompt" });
    stack.push({ role: "user", content: "X".repeat(200) });

    const messages = stack.getMessages();
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
  });

  it("should clear all messages", () => {
    const stack = new ContextStack();
    stack.push({ role: "user", content: "hello" });
    stack.push({ role: "assistant", content: "hi" });
    stack.clear();

    expect(stack.length).toBe(0);
    expect(stack.getMessages()).toEqual([]);
  });

  it("should estimate token count", () => {
    const stack = new ContextStack();
    stack.push({ role: "user", content: "a".repeat(400) }); // ~100 tokens

    expect(stack.getTokenCount()).toBe(100);
  });
});

// ── Pipeline Tests ──────────────────────────────────────────────────

describe("Pipeline", () => {
  const Step1Schema = z.object({ summary: z.string() });
  const Step2Schema = z.object({ rating: z.number(), comment: z.string() });

  const step1Fn: LScriptFunction<string, typeof Step1Schema> = {
    name: "Summarizer",
    model: "test-model",
    system: "Summarize the input.",
    prompt: (input: string) => `Summarize: ${input}`,
    schema: Step1Schema,
  };

  const step2Fn: LScriptFunction<z.infer<typeof Step1Schema>, typeof Step2Schema> = {
    name: "Rater",
    model: "test-model",
    system: "Rate the summary.",
    prompt: (input) => `Rate this summary: ${input.summary}`,
    schema: Step2Schema,
  };

  it("should execute a 2-step pipeline with mock provider", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({ summary: "A brief summary" }),
            usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
          };
        }
        return {
          content: JSON.stringify({ rating: 8, comment: "Good summary" }),
          usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
        };
      }),
    };

    const runtime = new LScriptRuntime({ provider });
    const pipeline = Pipeline.from(step1Fn).pipe(step2Fn);

    const result = await pipeline.execute(runtime, "Some long text to summarize");

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("Summarizer");
    expect(result.steps[0].data).toEqual({ summary: "A brief summary" });
    expect(result.steps[1].name).toBe("Rater");
    expect(result.finalData).toEqual({ rating: 8, comment: "Good summary" });
    expect(result.totalUsage.totalTokens).toBe(55);
    expect(result.totalUsage.promptTokens).toBe(22);
    expect(result.totalUsage.completionTokens).toBe(33);
  });

  it("should pass output of step 1 as input to step 2", async () => {
    let capturedStep2Input = "";
    const step2WithCapture: LScriptFunction<z.infer<typeof Step1Schema>, typeof Step2Schema> = {
      ...step2Fn,
      prompt: (input) => {
        capturedStep2Input = input.summary;
        return `Rate this summary: ${input.summary}`;
      },
    };

    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (): Promise<LLMResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            content: JSON.stringify({ summary: "step1-output" }),
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          };
        }
        return {
          content: JSON.stringify({ rating: 9, comment: "excellent" }),
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }),
    };

    const runtime = new LScriptRuntime({ provider });
    const pipeline = Pipeline.from(step1Fn).pipe(step2WithCapture);

    await pipeline.execute(runtime, "initial input");

    expect(capturedStep2Input).toBe("step1-output");
  });
});

// ── Few-Shot Examples Tests ─────────────────────────────────────────

describe("Few-Shot Examples", () => {
  it("should inject examples as user/assistant pairs before the real prompt", async () => {
    const ExampleSchema = z.object({ answer: z.string() });

    const fnWithExamples: LScriptFunction<string, typeof ExampleSchema> = {
      name: "WithExamples",
      model: "test-model",
      system: "You answer questions.",
      prompt: (input: string) => `Question: ${input}`,
      schema: ExampleSchema,
      examples: [
        { input: "What is 1+1?", output: { answer: "2" } },
        { input: "What is 2+2?", output: { answer: "4" } },
      ],
    };

    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: JSON.stringify({ answer: "6" }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })),
    };

    const runtime = new LScriptRuntime({ provider });
    await runtime.execute(fnWithExamples, "What is 3+3?");

    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    const request = chatFn.mock.calls[0][0] as LLMRequest;

    // Messages should be: system, example1-user, example1-assistant, example2-user, example2-assistant, real-user
    expect(request.messages).toHaveLength(6);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].role).toBe("user");
    expect(request.messages[1].content).toContain("What is 1+1?");
    expect(request.messages[2].role).toBe("assistant");
    expect(request.messages[2].content).toBe(JSON.stringify({ answer: "2" }));
    expect(request.messages[3].role).toBe("user");
    expect(request.messages[3].content).toContain("What is 2+2?");
    expect(request.messages[4].role).toBe("assistant");
    expect(request.messages[4].content).toBe(JSON.stringify({ answer: "4" }));
    expect(request.messages[5].role).toBe("user");
    expect(request.messages[5].content).toContain("What is 3+3?");
  });
});

// ── Summarize Pruning Tests ─────────────────────────────────────────

describe("ContextStack Summarize Pruning", () => {
  it("should invoke summarizer and replace old messages with summary", async () => {
    const summarizer = vi.fn(async () => "This is a summary of the conversation.");

    const stack = new ContextStack({
      maxTokens: 50, // low limit to trigger pruning
      pruneStrategy: "summarize",
    });
    stack.setSummarizer(summarizer);

    await stack.push({ role: "system", content: "You are helpful." });
    await stack.push({ role: "user", content: "A".repeat(100) });
    await stack.push({ role: "assistant", content: "B".repeat(100) });
    await stack.push({ role: "user", content: "C".repeat(100) });

    // Summarizer should have been called
    expect(summarizer).toHaveBeenCalled();

    // The messages passed to summarizer should be non-system messages
    const summarizedMessages = (summarizer.mock.calls as any[][])[0][0] as Array<{ role: string }>;
    expect(summarizedMessages.every((m) => m.role !== "system")).toBe(true);

    // The result should contain a summary system message
    const messages = stack.getMessages();
    const summaryMsg = messages.find((m) =>
      m.content.includes("Previous conversation summary:")
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.role).toBe("system");
  });

  it("should fall back to FIFO when no summarizer is set", async () => {
    const stack = new ContextStack({
      maxTokens: 50,
      pruneStrategy: "summarize",
    });
    // No summarizer set — should fall back to FIFO

    await stack.push({ role: "system", content: "System prompt" });
    await stack.push({ role: "user", content: "X".repeat(200) });
    await stack.push({ role: "assistant", content: "Y".repeat(200) });

    const messages = stack.getMessages();
    // System message should be preserved
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
    // Some messages should have been pruned via FIFO
    expect(messages.length).toBeLessThan(3);
  });
});

// ── Streaming Tests ─────────────────────────────────────────────────

describe("Streaming (executeStream)", () => {
  it("should return a StreamResult with stream and result", async () => {
    // Create a provider that supports chatStream
    const provider: LLMProvider = {
      name: "mock-stream",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: JSON.stringify({ answer: "full", confidence: 0.9 }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      })),
      async *chatStream(_req: LLMRequest): AsyncIterable<string> {
        yield '{"answer":';
        yield ' "streamed"';
        yield ', "confidence":';
        yield " 0.85}";
      },
    };

    const runtime = new LScriptRuntime({ provider });
    const streamResult = runtime.executeStream(SimpleFunction, "test");

    // Should have both stream and result
    expect(streamResult).toHaveProperty("stream");
    expect(streamResult).toHaveProperty("result");

    // Consume the stream
    const chunks: string[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("streamed");

    // Result should resolve to validated data
    const result = await streamResult.result;
    expect(result.data.answer).toBe("streamed");
    expect(result.data.confidence).toBe(0.85);
    expect(result.attempts).toBe(1);
  });

  it("should fall back to execute() when provider doesn't support chatStream", async () => {
    const provider = createMockProvider(
      JSON.stringify({ answer: "fallback", confidence: 0.7 })
    );
    // provider does NOT have chatStream

    const runtime = new LScriptRuntime({ provider });
    const streamResult = runtime.executeStream(SimpleFunction, "test");

    // Should still return a StreamResult
    expect(streamResult).toHaveProperty("stream");
    expect(streamResult).toHaveProperty("result");

    // Consume the stream — should yield one chunk with full result
    const chunks: string[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.answer).toBe("fallback");

    // Result should resolve to validated data
    const result = await streamResult.result;
    expect(result.data.answer).toBe("fallback");
    expect(result.data.confidence).toBe(0.7);
  });

  it("should reject result promise when accumulated stream content fails schema validation", async () => {
    const provider: LLMProvider = {
      name: "mock-stream-bad",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: "{}",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })),
      async *chatStream(_req: LLMRequest): AsyncIterable<string> {
        yield '{"invalid":';
        yield " true}";
      },
    };

    const runtime = new LScriptRuntime({ provider });
    const streamResult = runtime.executeStream(SimpleFunction, "test");

    // Consume the stream
    const chunks: string[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    // Result should reject with validation error
    await expect(streamResult.result).rejects.toThrow(/validation failed/i);
  });
});

// ── Tool Calling Tests ──────────────────────────────────────────────

describe("Tool Calling", () => {
  const ToolSchema = z.object({ result: z.string() });

  const calculatorTool: ToolDefinition = {
    name: "calculator",
    description: "Performs arithmetic",
    parameters: z.object({
      expression: z.string(),
    }),
    execute: (params: { expression: string }) => {
      return { value: `calculated: ${params.expression}` };
    },
  };

  it("should pass tools to the provider in the request", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: JSON.stringify({ result: "done" }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })),
    };

    const fnWithTools: LScriptFunction<string, typeof ToolSchema> = {
      name: "WithTools",
      model: "test-model",
      system: "You have tools.",
      prompt: (input: string) => `Do: ${input}`,
      schema: ToolSchema,
      tools: [calculatorTool],
    };

    const runtime = new LScriptRuntime({ provider });
    await runtime.execute(fnWithTools, "calculate 2+2");

    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    const request = chatFn.mock.calls[0][0] as LLMRequest;

    expect(request.tools).toBeDefined();
    expect(request.tools).toHaveLength(1);
    expect(request.tools![0].name).toBe("calculator");
    expect(request.tools![0].description).toBe("Performs arithmetic");
  });

  it("should execute tools and feed results back to the LLM", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
        callCount++;
        if (callCount === 1) {
          // First call: LLM requests a tool call
          return {
            content: "",
            toolCalls: [
              {
                id: "call_1",
                name: "calculator",
                arguments: JSON.stringify({ expression: "2+2" }),
              },
            ],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        }
        // Second call: LLM returns final result after receiving tool output
        return {
          content: JSON.stringify({ result: "The answer is 4" }),
          usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
        };
      }),
    };

    const fnWithTools: LScriptFunction<string, typeof ToolSchema> = {
      name: "WithTools",
      model: "test-model",
      system: "You have tools.",
      prompt: (input: string) => `Do: ${input}`,
      schema: ToolSchema,
      tools: [calculatorTool],
    };

    const runtime = new LScriptRuntime({ provider });
    const result = await runtime.execute(fnWithTools, "calculate 2+2");

    expect(result.data.result).toBe("The answer is 4");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("calculator");
    expect(result.toolCalls![0].result).toEqual({ value: "calculated: 2+2" });

    // Provider should have been called twice (once for tool call, once for final)
    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should record tool calls in ExecutionResult.toolCalls", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (): Promise<LLMResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "call_a",
                name: "calculator",
                arguments: JSON.stringify({ expression: "10*5" }),
              },
            ],
          };
        }
        return {
          content: JSON.stringify({ result: "50" }),
        };
      }),
    };

    const fnWithTools: LScriptFunction<string, typeof ToolSchema> = {
      name: "ToolTracking",
      model: "test-model",
      system: "You have tools.",
      prompt: (input: string) => `Compute: ${input}`,
      schema: ToolSchema,
      tools: [calculatorTool],
    };

    const runtime = new LScriptRuntime({ provider });
    const result = await runtime.execute(fnWithTools, "10*5");

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("calculator");
    expect(result.toolCalls![0].arguments).toEqual({ expression: "10*5" });
    expect(result.toolCalls![0].result).toEqual({ value: "calculated: 10*5" });
  });

  it("should prevent infinite tool call loops with max depth limit", async () => {
    // Provider always returns tool calls, never a final response
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: "",
        toolCalls: [
          {
            id: "call_loop",
            name: "calculator",
            arguments: JSON.stringify({ expression: "loop" }),
          },
        ],
      })),
    };

    const fnWithTools: LScriptFunction<string, typeof ToolSchema> = {
      name: "InfiniteTools",
      model: "test-model",
      system: "You have tools.",
      prompt: (input: string) => `Do: ${input}`,
      schema: ToolSchema,
      maxRetries: 0,
      tools: [calculatorTool],
    };

    const runtime = new LScriptRuntime({ provider });

    await expect(runtime.execute(fnWithTools, "loop")).rejects.toThrow(
      /Maximum tool call depth.*exceeded|Compilation failed/
    );
  });
});

// ── Middleware Tests ─────────────────────────────────────────────────

describe("Middleware / Hooks", () => {
  const MiddlewareSchema = z.object({ answer: z.string(), confidence: z.number() });

  const middlewareTestFn: LScriptFunction<string, typeof MiddlewareSchema> = {
    name: "MiddlewareTest",
    model: "test-model",
    system: "You are a helpful assistant.",
    prompt: (input: string) => `Answer: ${input}`,
    schema: MiddlewareSchema,
    temperature: 0.5,
  };

  it("onBeforeExecute and onComplete hooks are called in order", async () => {
    const callOrder: string[] = [];

    const hooks1: MiddlewareHooks = {
      onBeforeExecute: () => { callOrder.push("before-1"); },
      onComplete: () => { callOrder.push("complete-1"); },
    };
    const hooks2: MiddlewareHooks = {
      onBeforeExecute: () => { callOrder.push("before-2"); },
      onComplete: () => { callOrder.push("complete-2"); },
    };

    const middleware = new MiddlewareManager();
    middleware.use(hooks1);
    middleware.use(hooks2);

    const provider = createMockProvider(
      JSON.stringify({ answer: "hello", confidence: 0.9 })
    );
    const runtime = new LScriptRuntime({ provider, middleware });

    await runtime.execute(middlewareTestFn, "test");

    expect(callOrder).toEqual(["before-1", "before-2", "complete-1", "complete-2"]);
  });

  it("onRetry hook fires on validation failure + retry", async () => {
    const retryErrors: string[] = [];

    const hooks: MiddlewareHooks = {
      onRetry: (_ctx, error) => { retryErrors.push(error.message); },
    };

    const middleware = new MiddlewareManager();
    middleware.use(hooks);

    const provider = createMockProvider(
      JSON.stringify({ answer: "hello", confidence: 0.9 }),
      1 // fail first call with invalid data
    );
    const runtime = new LScriptRuntime({ provider, middleware });

    const result = await runtime.execute(middlewareTestFn, "test");

    expect(result.attempts).toBe(2);
    expect(retryErrors.length).toBe(1);
    expect(retryErrors[0]).toBeTruthy();
  });

  it("errors in hooks don't crash execution", async () => {
    const hooks: MiddlewareHooks = {
      onBeforeExecute: () => { throw new Error("hook explosion"); },
      onComplete: () => { throw new Error("another hook explosion"); },
    };

    const middleware = new MiddlewareManager();
    middleware.use(hooks);

    const provider = createMockProvider(
      JSON.stringify({ answer: "still works", confidence: 0.8 })
    );
    const runtime = new LScriptRuntime({ provider, middleware });

    // Should NOT throw — hook errors are caught internally
    const result = await runtime.execute(middlewareTestFn, "test");
    expect(result.data.answer).toBe("still works");
  });
});

// ── Cache Tests ─────────────────────────────────────────────────────

describe("Execution Cache", () => {
  const CacheSchema = z.object({ answer: z.string(), confidence: z.number() });

  const cacheFn: LScriptFunction<string, typeof CacheSchema> = {
    name: "CacheTest",
    model: "test-model",
    system: "You are a helper.",
    prompt: (input: string) => `Answer: ${input}`,
    schema: CacheSchema,
    temperature: 0.5,
  };

  it("cache hit returns cached result with attempts: 0", async () => {
    const backend = new MemoryCacheBackend();
    const cache = new ExecutionCache(backend);

    const provider = createMockProvider(
      JSON.stringify({ answer: "first", confidence: 0.9 })
    );
    const runtime = new LScriptRuntime({ provider, cache });

    // First call — cache miss, executes normally
    const result1 = await runtime.execute(cacheFn, "hello");
    expect(result1.data.answer).toBe("first");
    expect(result1.attempts).toBe(1);

    // Second call — cache hit
    const result2 = await runtime.execute(cacheFn, "hello");
    expect(result2.data.answer).toBe("first");
    expect(result2.attempts).toBe(0); // indicates cache hit

    // Provider should only have been called once
    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("cache miss executes normally and stores result", async () => {
    const backend = new MemoryCacheBackend();
    const cache = new ExecutionCache(backend);

    const provider = createMockProvider(
      JSON.stringify({ answer: "computed", confidence: 0.7 })
    );
    const runtime = new LScriptRuntime({ provider, cache });

    const result = await runtime.execute(cacheFn, "new-input");
    expect(result.data.answer).toBe("computed");
    expect(result.attempts).toBe(1);

    // Verify it was stored in the cache
    const cached = await cache.getCached(cacheFn, "new-input");
    expect(cached).not.toBeNull();
    expect(cached!.data).toEqual({ answer: "computed", confidence: 0.7 });
  });

  it("computeKey produces different keys for different inputs", () => {
    const backend = new MemoryCacheBackend();
    const cache = new ExecutionCache(backend);

    const key1 = cache.computeKey(cacheFn, "input-a");
    const key2 = cache.computeKey(cacheFn, "input-b");

    expect(key1).not.toBe(key2);
  });
});

// ── Cost Tracking Tests ─────────────────────────────────────────────

describe("Cost Tracking & Budgets", () => {
  const CostSchema = z.object({ answer: z.string(), confidence: z.number() });

  const costFn: LScriptFunction<string, typeof CostSchema> = {
    name: "CostTest",
    model: "test-model",
    system: "You are a helper.",
    prompt: (input: string) => `Answer: ${input}`,
    schema: CostSchema,
    temperature: 0.5,
  };

  const anotherFn: LScriptFunction<string, typeof CostSchema> = {
    name: "AnotherFn",
    model: "test-model",
    system: "You are another helper.",
    prompt: (input: string) => `Do: ${input}`,
    schema: CostSchema,
    temperature: 0.5,
  };

  it("tracks cumulative token usage across executions", async () => {
    const costTracker = new CostTracker();
    const provider = createMockProvider(
      JSON.stringify({ answer: "yes", confidence: 0.9 })
    );
    const runtime = new LScriptRuntime({ provider, costTracker });

    await runtime.execute(costFn, "first");
    await runtime.execute(costFn, "second");

    // Each call returns usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    expect(costTracker.getTotalTokens()).toBe(60);
  });

  it("getUsageByFunction groups by function name", async () => {
    const costTracker = new CostTracker();

    const provider1 = createMockProvider(
      JSON.stringify({ answer: "a", confidence: 0.5 })
    );
    const provider2 = createMockProvider(
      JSON.stringify({ answer: "b", confidence: 0.6 })
    );

    // Use same tracker with two different runtimes (same provider is fine)
    const runtime = new LScriptRuntime({ provider: provider1, costTracker });

    await runtime.execute(costFn, "x");
    await runtime.execute(anotherFn, "y");

    const byFn = costTracker.getUsageByFunction();
    expect(byFn.has("CostTest")).toBe(true);
    expect(byFn.has("AnotherFn")).toBe(true);
    expect(byFn.get("CostTest")!.calls).toBe(1);
    expect(byFn.get("AnotherFn")!.calls).toBe(1);
    expect(byFn.get("CostTest")!.totalTokens).toBe(30);
  });

  it("BudgetExceededError thrown when token budget exceeded", async () => {
    const costTracker = new CostTracker();
    const provider = createMockProvider(
      JSON.stringify({ answer: "ok", confidence: 0.9 })
    );
    const runtime = new LScriptRuntime({
      provider,
      costTracker,
      budget: { maxTotalTokens: 50 },
    });

    // First call uses 30 tokens — within budget
    await runtime.execute(costFn, "first");
    expect(costTracker.getTotalTokens()).toBe(30);

    // Second call would push to 60 tokens — but budget check happens AFTER tracking
    // The post-execution budget check should throw
    await expect(runtime.execute(costFn, "second")).rejects.toThrow(BudgetExceededError);
  });
});

// ── Structured Logger Tests ─────────────────────────────────────────

describe("Structured Logger", () => {
  it("creates entries with correct level and sends to transports", () => {
    const entries: LogEntry[] = [];
    const transport: LogTransport = {
      write(entry: LogEntry) {
        entries.push(entry);
      },
    };

    const logger = new Logger({ level: LogLevel.DEBUG, transports: [transport] });
    logger.debug("debug msg", { key: "d" });
    logger.info("info msg", { key: "i" });
    logger.warn("warn msg", { key: "w" });
    logger.error("error msg", { key: "e" });

    expect(entries).toHaveLength(4);
    expect(entries[0].level).toBe(LogLevel.DEBUG);
    expect(entries[0].message).toBe("debug msg");
    expect(entries[0].context).toEqual({ key: "d" });
    expect(entries[1].level).toBe(LogLevel.INFO);
    expect(entries[2].level).toBe(LogLevel.WARN);
    expect(entries[3].level).toBe(LogLevel.ERROR);

    // All entries should have a timestamp
    for (const e of entries) {
      expect(typeof e.timestamp).toBe("number");
      expect(e.timestamp).toBeGreaterThan(0);
    }
  });

  it("startSpan creates span with ID, end() returns duration", async () => {
    const entries: LogEntry[] = [];
    const transport: LogTransport = {
      write(entry: LogEntry) {
        entries.push(entry);
      },
    };

    const logger = new Logger({ level: LogLevel.DEBUG, transports: [transport] });
    const span = logger.startSpan("test-span");

    expect(span.id).toBeTruthy();
    expect(typeof span.id).toBe("string");
    expect(span.id.length).toBe(16); // 8 bytes = 16 hex chars
    expect(span.name).toBe("test-span");
    expect(span.startTime).toBeGreaterThan(0);

    // Small delay so duration > 0
    await new Promise((resolve) => setTimeout(resolve, 5));

    span.log(LogLevel.INFO, "span log", { detail: true });
    const result = span.end();

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe("number");

    // Span log should have spanId
    const spanEntries = entries.filter((e) => e.spanId === span.id);
    expect(spanEntries.length).toBeGreaterThanOrEqual(1);
    expect(spanEntries[0].message).toBe("span log");
  });

  it("custom transport receives entries", () => {
    const received: LogEntry[] = [];
    const customTransport: LogTransport = {
      write(entry: LogEntry) {
        received.push(entry);
      },
    };

    const logger = new Logger({ level: LogLevel.INFO, transports: [] });
    logger.addTransport(customTransport);
    logger.info("test message");

    expect(received).toHaveLength(1);
    expect(received[0].message).toBe("test message");
    expect(received[0].level).toBe(LogLevel.INFO);
  });

  it("default SILENT logger produces no output", () => {
    const entries: LogEntry[] = [];
    const transport: LogTransport = {
      write(entry: LogEntry) {
        entries.push(entry);
      },
    };

    const logger = new Logger({ level: LogLevel.SILENT, transports: [transport] });
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should not appear");
    logger.error("should not appear");

    expect(entries).toHaveLength(0);
  });
});

// ── CLI Tests ───────────────────────────────────────────────────────

describe("CLI Utilities", () => {
  const CliSchema = z.object({ answer: z.string(), confidence: z.number() });

  const testFn: LScriptFunction<string, typeof CliSchema> = {
    name: "TestFunc",
    model: "gpt-4",
    system: "You are a test assistant that answers questions concisely.",
    prompt: (input: string) => `Q: ${input}`,
    schema: CliSchema,
    temperature: 0.3,
    examples: [
      { input: "hi", output: { answer: "hello", confidence: 1.0 } },
    ],
  };

  it("generateManifest returns correct manifest for an LScriptFunction", () => {
    const manifest = generateManifest(testFn as LScriptFunction<unknown, z.ZodType>);

    expect(manifest.name).toBe("TestFunc");
    expect(manifest.model).toBe("gpt-4");
    expect(manifest.system).toBe("You are a test assistant that answers questions concisely.");
    expect(manifest.temperature).toBe(0.3);
    expect(manifest.exampleCount).toBe(1);
    expect(manifest.toolCount).toBe(0);
    expect(manifest.schema).toBeDefined();
    expect(typeof manifest.schema).toBe("object");
  });

  it("extractFunctions finds LScriptFunction exports from a module object", () => {
    const mockModule = {
      testFn: testFn,
      notAFunction: "just a string",
      alsoNot: 42,
      anotherFn: {
        name: "Another",
        model: "claude-sonnet-4-20250514",
        system: "Another system prompt",
        prompt: (s: string) => s,
        schema: z.object({ x: z.string() }),
      },
    };

    const fns = extractFunctions(mockModule as Record<string, unknown>);

    expect(fns.length).toBe(2);
    expect(fns.map((f) => f.key).sort()).toEqual(["anotherFn", "testFn"]);
  });
});

// ── Gemini Provider Tests ───────────────────────────────────────────

describe("GeminiProvider", () => {
  it("buildRequestBody formats messages in Gemini format", () => {
    const provider = new GeminiProvider({ apiKey: "test-key" });
    const request: LLMRequest = {
      model: "gemini-1.5-pro",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ],
      temperature: 0.7,
      jsonMode: true,
    };

    // Access protected method via any cast
    const body = (provider as any).buildRequestBody(request);

    // System message should be in systemInstruction
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "You are helpful." }],
    });

    // Non-system messages should be in contents
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({
      parts: [{ text: "Hello" }],
      role: "user",
    });
    expect(body.contents[1]).toEqual({
      parts: [{ text: "Hi there!" }],
      role: "model",
    });
    expect(body.contents[2]).toEqual({
      parts: [{ text: "How are you?" }],
      role: "user",
    });

    // generationConfig
    expect(body.generationConfig.temperature).toBe(0.7);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("parseResponse extracts content and usage", () => {
    const provider = new GeminiProvider({ apiKey: "test-key" });
    const json = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"answer": "42"}' }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    };

    const response = (provider as any).parseResponse(json);

    expect(response.content).toBe('{"answer": "42"}');
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });
});

// ── Ollama Provider Tests ───────────────────────────────────────────

describe("OllamaProvider", () => {
  it("buildRequestBody formats with Ollama structure", () => {
    const provider = new OllamaProvider({ apiKey: "" });
    const request: LLMRequest = {
      model: "llama3",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
      temperature: 0.5,
      jsonMode: true,
    };

    const body = (provider as any).buildRequestBody(request);

    expect(body.model).toBe("llama3");
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options).toEqual({ temperature: 0.5 });
  });

  it("parseResponse extracts content", () => {
    const provider = new OllamaProvider({ apiKey: "" });
    const json = {
      message: { content: '{"result": "hello"}' },
      eval_count: 15,
      prompt_eval_count: 10,
    };

    const response = (provider as any).parseResponse(json);

    expect(response.content).toBe('{"result": "hello"}');
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 15,
      totalTokens: 25,
    });
  });
});

// ── Model Router Tests ──────────────────────────────────────────────

describe("ModelRouter", () => {
  function createSimpleProvider(providerName: string): LLMProvider {
    return {
      name: providerName,
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: `response from ${providerName}`,
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })),
    };
  }

  it("string match routes to correct provider", async () => {
    const openaiProvider = createSimpleProvider("openai");
    const anthropicProvider = createSimpleProvider("anthropic");
    const defaultProvider = createSimpleProvider("default");

    const router = new ModelRouter({
      rules: [
        { match: "gpt-4", provider: openaiProvider },
        { match: "claude-sonnet-4-20250514", provider: anthropicProvider },
      ],
      defaultProvider,
    });

    const request: LLMRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      jsonMode: false,
    };

    const response = await router.chat(request);

    expect(response.content).toBe("response from openai");
    expect(openaiProvider.chat).toHaveBeenCalledTimes(1);
    expect(anthropicProvider.chat).not.toHaveBeenCalled();
    expect(defaultProvider.chat).not.toHaveBeenCalled();
  });

  it("RegExp match routes correctly", async () => {
    const geminiProvider = createSimpleProvider("gemini");
    const defaultProvider = createSimpleProvider("default");

    const router = new ModelRouter({
      rules: [
        { match: /^gemini-/, provider: geminiProvider },
      ],
      defaultProvider,
    });

    const request: LLMRequest = {
      model: "gemini-1.5-pro",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      jsonMode: false,
    };

    const response = await router.chat(request);

    expect(response.content).toBe("response from gemini");
    expect(geminiProvider.chat).toHaveBeenCalledTimes(1);
    expect(defaultProvider.chat).not.toHaveBeenCalled();
  });

  it("falls back to default provider when no rules match", async () => {
    const openaiProvider = createSimpleProvider("openai");
    const defaultProvider = createSimpleProvider("default");

    const router = new ModelRouter({
      rules: [
        { match: "gpt-4", provider: openaiProvider },
      ],
      defaultProvider,
    });

    const request: LLMRequest = {
      model: "unknown-model",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      jsonMode: false,
    };

    const response = await router.chat(request);

    expect(response.content).toBe("response from default");
    expect(defaultProvider.chat).toHaveBeenCalledTimes(1);
    expect(openaiProvider.chat).not.toHaveBeenCalled();
  });
});

// ── Fallback Provider Tests ─────────────────────────────────────────

describe("FallbackProvider", () => {
  it("first provider succeeds — uses it", async () => {
    const provider1: LLMProvider = {
      name: "provider1",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: "from provider1",
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })),
    };
    const provider2: LLMProvider = {
      name: "provider2",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: "from provider2",
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })),
    };

    const fallback = new FallbackProvider([provider1, provider2]);
    const request: LLMRequest = {
      model: "test",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.5,
      jsonMode: false,
    };

    const response = await fallback.chat(request);

    expect(response.content).toBe("from provider1");
    expect(provider1.chat).toHaveBeenCalledTimes(1);
    expect(provider2.chat).not.toHaveBeenCalled();
  });

  it("first provider fails — falls back to second", async () => {
    const provider1: LLMProvider = {
      name: "provider1",
      chat: vi.fn(async (): Promise<LLMResponse> => {
        throw new Error("provider1 rate limited");
      }),
    };
    const provider2: LLMProvider = {
      name: "provider2",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: "from provider2",
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      })),
    };

    const fallback = new FallbackProvider([provider1, provider2]);
    const request: LLMRequest = {
      model: "test",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.5,
      jsonMode: false,
    };

    const response = await fallback.chat(request);

    expect(response.content).toBe("from provider2");
    expect(provider1.chat).toHaveBeenCalledTimes(1);
    expect(provider2.chat).toHaveBeenCalledTimes(1);
  });

  it("all providers fail — throws AllProvidersFailedError", async () => {
    const provider1: LLMProvider = {
      name: "provider1",
      chat: vi.fn(async (): Promise<LLMResponse> => {
        throw new Error("provider1 down");
      }),
    };
    const provider2: LLMProvider = {
      name: "provider2",
      chat: vi.fn(async (): Promise<LLMResponse> => {
        throw new Error("provider2 down");
      }),
    };

    const fallback = new FallbackProvider([provider1, provider2]);
    const request: LLMRequest = {
      model: "test",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.5,
      jsonMode: false,
    };

    try {
      await fallback.chat(request);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      const error = err as AllProvidersFailedError;
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0].provider).toBe("provider1");
      expect(error.errors[0].error.message).toBe("provider1 down");
      expect(error.errors[1].provider).toBe("provider2");
      expect(error.errors[1].error.message).toBe("provider2 down");
    }
  });
});

// ── Mock Provider (testing utility) Tests ───────────────────────────

describe("MockProvider (testing utility)", () => {
  it("records requests and asserts call count", async () => {
    const { MockProvider } = await import("../src/testing/mock-provider.js");
    const mock = new MockProvider({
      defaultResponse: JSON.stringify({ answer: "mock", confidence: 0.5 }),
      recordRequests: true,
    });

    const runtime = new LScriptRuntime({ provider: mock });
    await runtime.execute(SimpleFunction, "question 1");
    await runtime.execute(SimpleFunction, "question 2");

    expect(mock.getRequestCount()).toBe(2);
    mock.assertCallCount(2);

    const recorded = mock.getRecordedRequests();
    expect(recorded).toHaveLength(2);

    // After reset, count should be 0
    mock.reset();
    expect(mock.getRequestCount()).toBe(0);
  });

  it("matches responses by pattern", async () => {
    const { MockProvider } = await import("../src/testing/mock-provider.js");
    const responses = new Map<string | RegExp, string>();
    responses.set("weather", JSON.stringify({ answer: "sunny", confidence: 0.9 }));
    responses.set(/math/i, JSON.stringify({ answer: "42", confidence: 1.0 }));

    const mock = new MockProvider({
      defaultResponse: JSON.stringify({ answer: "default", confidence: 0.5 }),
      responses,
    });

    const runtime = new LScriptRuntime({ provider: mock });

    // Should match "weather" string
    const weatherResult = await runtime.execute(SimpleFunction, "What is the weather?");
    expect(weatherResult.data.answer).toBe("sunny");

    // Should match /math/i regex
    const mathResult = await runtime.execute(SimpleFunction, "Do some Math");
    expect(mathResult.data.answer).toBe("42");

    // Should fall back to default
    const defaultResult = await runtime.execute(SimpleFunction, "random question");
    expect(defaultResult.data.answer).toBe("default");

    mock.assertCalledWith("weather");
    mock.assertCalledWith(/Math/);
  });

  it("simulates failures at configured rate", async () => {
    const { MockProvider } = await import("../src/testing/mock-provider.js");
    const mock = new MockProvider({
      defaultResponse: JSON.stringify({ answer: "ok", confidence: 0.5 }),
      failureRate: 1.0, // 100% failure rate
    });

    await expect(
      mock.chat({
        model: "test",
        messages: [{ role: "user", content: "test" }],
        temperature: 0.5,
        jsonMode: true,
      })
    ).rejects.toThrow(/Simulated failure/);
  });
});

// ── Schema Diff Tests ───────────────────────────────────────────────

describe("Schema Diff", () => {
  it("detects missing fields", async () => {
    const { diffSchemaResult } = await import("../src/testing/schema-diff.js");

    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string(),
    });

    const actual = { name: "John" };

    const diffs = diffSchemaResult(schema, actual);

    const missingDiffs = diffs.filter((d) => d.issue === "missing");
    expect(missingDiffs.length).toBe(2);

    const missingPaths = missingDiffs.map((d) => d.path);
    expect(missingPaths).toContain(".age");
    expect(missingPaths).toContain(".email");
  });

  it("detects type mismatches", async () => {
    const { diffSchemaResult } = await import("../src/testing/schema-diff.js");

    const schema = z.object({
      score: z.number(),
      tags: z.array(z.string()),
      active: z.boolean(),
    });

    const actual = {
      score: "not a number",
      tags: "not an array",
      active: 42,
    };

    const diffs = diffSchemaResult(schema, actual);

    const typeMismatches = diffs.filter((d) => d.issue === "type_mismatch");
    expect(typeMismatches.length).toBe(3);

    const scoreDiff = typeMismatches.find((d) => d.path === ".score");
    expect(scoreDiff).toBeDefined();
    expect(scoreDiff!.expected).toBe("number");
    expect(scoreDiff!.actual).toBe("string");
  });

  it("formats diff as readable string", async () => {
    const { diffSchemaResult, formatSchemaDiff } = await import("../src/testing/schema-diff.js");

    const schema = z.object({
      score: z.number(),
      tags: z.array(z.string()),
    });

    const actual = { score: "wrong", extra: true };

    const diffs = diffSchemaResult(schema, actual);
    const formatted = formatSchemaDiff(diffs);

    expect(formatted).toContain("Schema Validation Diff:");
    expect(formatted).toContain(".score");
    expect(formatted).toContain("type_mismatch");
    expect(formatted).toContain(".tags");
    expect(formatted).toContain("missing");
    expect(formatted).toContain(".extra");
    expect(formatted).toContain("extra_field");
    // Should contain table characters
    expect(formatted).toContain("┌");
    expect(formatted).toContain("┘");
  });
});

// ── Prompt Snapshot Tests ───────────────────────────────────────────

describe("Prompt Snapshot", () => {
  it("captures snapshot with correct fields", async () => {
    const { captureSnapshot } = await import("../src/testing/prompt-snapshot.js");

    const snapshot = captureSnapshot(SimpleFunction, "test input");

    expect(snapshot.fnName).toBe("SimpleTest");
    expect(snapshot.model).toBe("test-model");
    expect(snapshot.systemPrompt).toContain("helpful assistant");
    expect(snapshot.systemPrompt).toContain("JSON SCHEMA");
    expect(snapshot.userPrompt).toContain("test input");
    expect(snapshot.schemaJson).toBeDefined();
    expect(typeof snapshot.schemaJson).toBe("object");
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it("compares snapshots and detects changes", async () => {
    const { captureSnapshot, compareSnapshots, formatSnapshotDiff } = await import("../src/testing/prompt-snapshot.js");

    const baseline = captureSnapshot(SimpleFunction, "baseline input");

    // Create a modified function
    const ModifiedFunction: LScriptFunction<string, typeof SimpleSchema> = {
      ...SimpleFunction,
      model: "new-model",
      system: "You are a different assistant.",
    };

    const current = captureSnapshot(ModifiedFunction, "baseline input");

    const diff = compareSnapshots(baseline, current);

    expect(diff.changed).toBe(true);
    expect(diff.diffs.length).toBeGreaterThanOrEqual(2);

    const changedFields = diff.diffs.map((d) => d.field);
    expect(changedFields).toContain("model");
    expect(changedFields).toContain("systemPrompt");

    // Format should produce readable output
    const formatted = formatSnapshotDiff(diff);
    expect(formatted).toContain("Prompt Snapshot Diff:");
    expect(formatted).toContain("model");

    // No-change scenario
    const same = compareSnapshots(baseline, baseline);
    expect(same.changed).toBe(false);
    expect(same.diffs).toHaveLength(0);
  });
});

// ── Chaos Provider Tests ────────────────────────────────────────────

describe("Chaos Provider", () => {
  it("passes through to wrapped provider when no chaos", async () => {
    const { ChaosProvider } = await import("../src/testing/chaos.js");

    const innerProvider: LLMProvider = {
      name: "inner",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: JSON.stringify({ answer: "real response", confidence: 0.95 }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      })),
    };

    const chaos = new ChaosProvider({
      provider: innerProvider,
      // All rates at 0 — no chaos
      malformedJsonRate: 0,
      partialResponseRate: 0,
      timeoutRate: 0,
      wrongSchemaRate: 0,
    });

    const runtime = new LScriptRuntime({ provider: chaos });
    const result = await runtime.execute(SimpleFunction, "test");

    expect(result.data.answer).toBe("real response");
    expect(result.data.confidence).toBe(0.95);
    expect(innerProvider.chat).toHaveBeenCalledTimes(1);
  });

  it("injects malformed JSON when configured", async () => {
    const { ChaosProvider } = await import("../src/testing/chaos.js");

    const innerProvider: LLMProvider = {
      name: "inner",
      chat: vi.fn(async (): Promise<LLMResponse> => ({
        content: JSON.stringify({ answer: "real", confidence: 0.5 }),
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      })),
    };

    const chaos = new ChaosProvider({
      provider: innerProvider,
      malformedJsonRate: 1.0, // 100% malformed
    });

    const response = await chaos.chat({
      model: "test",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      jsonMode: true,
    });

    // Should return malformed JSON
    expect(() => JSON.parse(response.content)).toThrow();
  });
});

// ── Parallel Execution Tests ────────────────────────────────────────

describe("Parallel Execution", () => {
  const ParSchema = z.object({ answer: z.string(), confidence: z.number() });

  const parFn: LScriptFunction<string, typeof ParSchema> = {
    name: "ParallelTest",
    model: "test-model",
    system: "You are a helpful assistant.",
    prompt: (input: string) => `Answer: ${input}`,
    schema: ParSchema,
    temperature: 0.5,
  };

  it("executeAll runs tasks concurrently and returns results with correct names", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: JSON.stringify({ answer: "parallel", confidence: 0.9 }),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      })),
    };

    const runtime = new LScriptRuntime({ provider });
    const result = await runtime.executeAll([
      { name: "task-a", fn: parFn, input: "first" },
      { name: "task-b", fn: parFn, input: "second" },
      { name: "task-c", fn: parFn, input: "third" },
    ]);

    expect(result.tasks).toHaveLength(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.tasks[0].name).toBe("task-a");
    expect(result.tasks[1].name).toBe("task-b");
    expect(result.tasks[2].name).toBe("task-c");
    expect(result.tasks[0].status).toBe("fulfilled");
    expect(result.tasks[0].result?.data).toEqual({ answer: "parallel", confidence: 0.9 });
    expect(result.totalUsage.totalTokens).toBe(90);
    expect(result.totalUsage.promptTokens).toBe(30);
    expect(result.totalUsage.completionTokens).toBe(60);
  });

  it("executeAll handles mixed success/failure", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
        callCount++;
        // Fail on second call
        if (callCount === 2) {
          throw new Error("provider error");
        }
        return {
          content: JSON.stringify({ answer: "ok", confidence: 0.8 }),
          usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        };
      }),
    };

    const failFn: LScriptFunction<string, typeof ParSchema> = {
      ...parFn,
      name: "WillFail",
      maxRetries: 0,
    };

    const runtime = new LScriptRuntime({ provider });
    const result = await runtime.executeAll([
      { name: "success-task", fn: parFn, input: "a" },
      { name: "fail-task", fn: failFn, input: "b" },
    ]);

    expect(result.tasks).toHaveLength(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);

    const successTask = result.tasks.find((t) => t.name === "success-task");
    const failTask = result.tasks.find((t) => t.name === "fail-task");

    expect(successTask?.status).toBe("fulfilled");
    expect(successTask?.result?.data).toEqual({ answer: "ok", confidence: 0.8 });
    expect(failTask?.status).toBe("rejected");
    expect(failTask?.error).toBeDefined();
  });

  it("executeBatch runs same function against multiple inputs", async () => {
    let callIdx = 0;
    const responses = ["alpha", "beta", "gamma"];
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
        const answer = responses[callIdx++] || "default";
        return {
          content: JSON.stringify({ answer, confidence: 0.7 }),
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }),
    };

    const runtime = new LScriptRuntime({ provider });
    const results = await runtime.executeBatch(parFn, ["input1", "input2", "input3"]);

    expect(results).toHaveLength(3);
    // All should succeed
    for (const r of results) {
      expect(r.attempts).toBe(1);
      expect(r.data.confidence).toBe(0.7);
    }
    // Check the provider was called 3 times
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });
});

// ── Session Tests ───────────────────────────────────────────────────

describe("Conversational Sessions", () => {
  const SessionSchema = z.object({ reply: z.string() });

  const sessionFn: LScriptFunction<string, typeof SessionSchema> = {
    name: "SessionTest",
    model: "test-model",
    system: "You are a conversational assistant.",
    prompt: (input: string) => input,
    schema: SessionSchema,
    temperature: 0.5,
  };

  it("Session maintains conversation history across send() calls", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
        callCount++;
        return {
          content: JSON.stringify({ reply: `response-${callCount}` }),
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        };
      }),
    };

    const runtime = new LScriptRuntime({ provider });
    const session = runtime.createSession(sessionFn, { maxTokens: 10000 });

    const r1 = await session.send("Hello");
    expect(r1.data.reply).toBe("response-1");

    const r2 = await session.send("How are you?");
    expect(r2.data.reply).toBe("response-2");

    // History should have 4 messages: user1, assistant1, user2, assistant2
    const history = session.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Hello");
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("user");
    expect(history[2].content).toBe("How are you?");
    expect(history[3].role).toBe("assistant");
  });

  it("Session passes history to the provider in messages", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: JSON.stringify({ reply: "ok" }),
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      })),
    };

    const runtime = new LScriptRuntime({ provider });
    const session = runtime.createSession(sessionFn, { maxTokens: 10000 });

    // First call
    await session.send("First message");

    // Second call — should include history
    await session.send("Second message");

    const chatFn = provider.chat as ReturnType<typeof vi.fn>;
    const secondCallRequest = chatFn.mock.calls[1][0] as LLMRequest;

    // Messages should contain: system, history(user + assistant from first call), current user
    // system + first_user + first_assistant + second_user = at least 4 messages
    expect(secondCallRequest.messages.length).toBeGreaterThanOrEqual(4);

    // The system message comes first
    expect(secondCallRequest.messages[0].role).toBe("system");

    // There should be a user message with "First message" in the history
    const historyUserMsg = secondCallRequest.messages.find(
      (m) => m.role === "user" && m.content === "First message"
    );
    expect(historyUserMsg).toBeDefined();

    // Last message should be the current user prompt
    const lastMsg = secondCallRequest.messages[secondCallRequest.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("Second message");
  });

  it("clearHistory() resets the context", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: JSON.stringify({ reply: "ok" }),
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      })),
    };

    const runtime = new LScriptRuntime({ provider });
    const session = runtime.createSession(sessionFn, { maxTokens: 10000 });

    await session.send("Hello");
    expect(session.getHistory()).toHaveLength(2); // user + assistant

    session.clearHistory();
    expect(session.getHistory()).toHaveLength(0);
    expect(session.getTokenCount()).toBe(0);
  });
});

// ── Output Transformer Tests ────────────────────────────────────────

describe("Output Transformers", () => {
  const TransformSchema = z.object({ name: z.string(), value: z.number() });

  const transformFn: LScriptFunction<string, typeof TransformSchema> = {
    name: "TransformTest",
    model: "test-model",
    system: "You produce structured data.",
    prompt: (input: string) => `Process: ${input}`,
    schema: TransformSchema,
    temperature: 0.5,
  };

  it("executeWithTransform applies transformer to validated output", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: JSON.stringify({ name: "test", value: 42 }),
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      })),
    };

    const runtime = new LScriptRuntime({ provider });
    const result = await runtime.executeWithTransform(
      transformFn,
      "input",
      (data: { name: string; value: number }) => ({ label: data.name.toUpperCase(), doubled: data.value * 2 })
    );

    expect(result.data).toEqual({ label: "TEST", doubled: 84 });
    expect(result.attempts).toBe(1);
    expect(result.usage?.totalTokens).toBe(20);
  });

  it("composeTransformers chains multiple transforms", async () => {
    const addPrefix = (data: any) => ({
      ...data,
      name: `prefix_${data.name}`,
    });
    const doubleValue = (data: any) => ({
      ...data,
      value: data.value * 2,
    });

    const composed = composeTransformers(addPrefix, doubleValue);

    const input = { name: "test", value: 5 };
    const output = await composed(input);

    expect(output.name).toBe("prefix_test");
    expect(output.value).toBe(10);
  });

  it("trimStringsTransformer trims all string fields", async () => {
    const data = {
      name: "  hello  ",
      nested: {
        title: "  world  ",
        count: 42,
      },
      tags: ["  a  ", "  b  "],
    };

    const result = trimStringsTransformer(data) as any;

    expect(result.name).toBe("hello");
    expect(result.nested.title).toBe("world");
    expect(result.nested.count).toBe(42);
    expect(result.tags).toEqual(["a", "b"]);
  });
});

// ── DSL Lexer Tests ─────────────────────────────────────────────────

describe("DSL Lexer", () => {
  it("tokenizes keywords, identifiers, and symbols correctly", () => {
    const source = `type Critique = { score: number }`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    // Filter out EOF
    const meaningful = tokens.filter((t: Token) => t.type !== TokenType.EOF);

    expect(meaningful[0].type).toBe(TokenType.TYPE);
    expect(meaningful[0].value).toBe("type");
    expect(meaningful[1].type).toBe(TokenType.IDENTIFIER);
    expect(meaningful[1].value).toBe("Critique");
    expect(meaningful[2].type).toBe(TokenType.EQUALS);
    expect(meaningful[3].type).toBe(TokenType.LBRACE);
    expect(meaningful[4].type).toBe(TokenType.IDENTIFIER);
    expect(meaningful[4].value).toBe("score");
    expect(meaningful[5].type).toBe(TokenType.COLON);
    expect(meaningful[6].type).toBe(TokenType.IDENTIFIER);
    expect(meaningful[6].value).toBe("number");
    expect(meaningful[7].type).toBe(TokenType.RBRACE);
  });

  it("tokenizes strings and triple-quoted strings", () => {
    const source = `model: "gpt-4o"\nprompt:\n  """\n  Hello world\n  """`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const strings = tokens.filter(
      (t: Token) => t.type === TokenType.STRING || t.type === TokenType.TRIPLE_STRING
    );

    expect(strings.length).toBe(2);
    expect(strings[0].type).toBe(TokenType.STRING);
    expect(strings[0].value).toBe("gpt-4o");
    expect(strings[1].type).toBe(TokenType.TRIPLE_STRING);
    expect(strings[1].value).toContain("Hello world");
  });

  it("handles template variables {{name}}", () => {
    const source = `"""Review: {{code}} and {{name}}"""`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    // The triple string is consumed as one token (template vars inside triple strings
    // are not separately tokenized — they're part of the string content)
    const tripleStr = tokens.find((t: Token) => t.type === TokenType.TRIPLE_STRING);
    expect(tripleStr).toBeDefined();
    expect(tripleStr!.value).toContain("{{code}}");
    expect(tripleStr!.value).toContain("{{name}}");

    // But standalone template vars are tokenized
    const source2 = `{{myVar}}`;
    const lexer2 = new Lexer(source2);
    const tokens2 = lexer2.tokenize();
    const templateVars = tokens2.filter((t: Token) => t.type === TokenType.TEMPLATE_VAR);
    expect(templateVars.length).toBe(1);
    expect(templateVars[0].value).toBe("myVar");
  });
});

// ── DSL Parser Tests ────────────────────────────────────────────────

describe("DSL Parser", () => {
  it("parses type declaration with fields, constraints, and enums", () => {
    const source = `
type Analysis = {
  sentiment: "positive" | "negative" | "neutral",
  summary: string(maxLength=100),
  score: number(min=1, max=10),
  tags: string[]
}`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();

    expect(program.declarations.length).toBe(1);
    const decl = program.declarations[0];
    expect(decl.kind).toBe("TypeDeclaration");

    if (decl.kind === "TypeDeclaration") {
      expect(decl.name).toBe("Analysis");
      expect(decl.fields.length).toBe(4);

      // Enum field
      const sentiment = decl.fields[0];
      expect(sentiment.name).toBe("sentiment");
      expect(sentiment.type).toBe("enum");
      expect(sentiment.enumValues).toEqual(["positive", "negative", "neutral"]);

      // String with maxLength
      const summary = decl.fields[1];
      expect(summary.name).toBe("summary");
      expect(summary.type).toBe("string");
      expect(summary.constraints).toEqual({ maxLength: 100 });

      // Number with min/max
      const score = decl.fields[2];
      expect(score.name).toBe("score");
      expect(score.type).toBe("number");
      expect(score.constraints).toEqual({ min: 1, max: 10 });

      // Array
      const tags = decl.fields[3];
      expect(tags.name).toBe("tags");
      expect(tags.type).toBe("string");
      expect(tags.isArray).toBe(true);
    }
  });

  it("parses LLM function declaration with all body fields", () => {
    const source = `
llm SecurityReviewer(code: string) -> Critique {
  model: "gpt-4o"
  temperature: 0.2
  system: "You are a security expert."
  prompt:
    """
    Review this code: {{code}}
    """
}`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();

    expect(program.declarations.length).toBe(1);
    const decl = program.declarations[0];
    expect(decl.kind).toBe("LLMFunction");

    if (decl.kind === "LLMFunction") {
      expect(decl.name).toBe("SecurityReviewer");
      expect(decl.parameters).toEqual([{ name: "code", type: "string" }]);
      expect(decl.returnType).toBe("Critique");
      expect(decl.body.model).toBe("gpt-4o");
      expect(decl.body.temperature).toBe(0.2);
      expect(decl.body.system).toBe("You are a security expert.");
      expect(decl.body.prompt).toContain("Review this code: {{code}}");
    }
  });

  it("reports error on malformed input", () => {
    const source = `llm Broken( -> {`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);

    expect(() => parser.parse()).toThrow(ParseError);
  });
});

// ── DSL Compiler Tests ──────────────────────────────────────────────

describe("DSL Compiler", () => {
  it("compiles type to valid Zod schema", () => {
    const source = `
type Review = {
  score: number(min=1, max=10),
  comments: string[],
  verdict: "pass" | "fail"
}`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const module = compile(program);

    expect(module.types.size).toBe(1);
    const schema = module.types.get("Review")!;
    expect(schema).toBeDefined();

    // Valid data should pass
    const validResult = schema.safeParse({
      score: 5,
      comments: ["looks good"],
      verdict: "pass",
    });
    expect(validResult.success).toBe(true);

    // Invalid score (out of range) should fail
    const invalidResult = schema.safeParse({
      score: 15,
      comments: ["bad"],
      verdict: "pass",
    });
    expect(invalidResult.success).toBe(false);

    // Invalid enum value should fail
    const invalidEnum = schema.safeParse({
      score: 5,
      comments: [],
      verdict: "maybe",
    });
    expect(invalidEnum.success).toBe(false);
  });

  it("compiles LLM function to LScriptFunction with correct fields", () => {
    const source = `
type Output = {
  result: string
}

llm MyFunc(input: string) -> Output {
  model: "gpt-4o"
  temperature: 0.5
  system: "You are helpful."
  prompt:
    """
    Process: {{input}}
    """
}`;
    const module = compileFile(source);

    expect(module.functions.size).toBe(1);
    const fn = module.functions.get("MyFunc")!;
    expect(fn).toBeDefined();
    expect(fn.name).toBe("MyFunc");
    expect(fn.model).toBe("gpt-4o");
    expect(fn.temperature).toBe(0.5);
    expect(fn.system).toBe("You are helpful.");
    expect(fn.prompt("hello world")).toContain("hello world");
    expect(fn.prompt("hello world")).toContain("Process:");
    expect(fn.schema).toBeDefined();
  });

  it("compileFile end-to-end: source → CompiledModule with working functions", () => {
    const source = `
type Critique = {
  score: number(min=1, max=10),
  issues: string[]
}

llm Reviewer(code: string) -> Critique {
  model: "gpt-4o"
  temperature: 0.2
  system: "Review code."
  prompt: "Review: {{code}}"
}`;
    const module = compileFile(source);

    expect(module.types.size).toBe(1);
    expect(module.functions.size).toBe(1);

    const fn = module.functions.get("Reviewer")!;
    expect(fn.prompt("const x = 1")).toBe("Review: const x = 1");

    const schema = module.types.get("Critique")!;
    const result = schema.safeParse({ score: 7, issues: ["none"] });
    expect(result.success).toBe(true);
  });
});

// ── DSL Integration Test ────────────────────────────────────────────

describe("DSL Integration", () => {
  it("full round-trip: parse example .ls content, compile, verify schemas", () => {
    const source = `
// Security Review Agent — L-Script v0.1

type Critique = {
  score: number(min=1, max=10),
  vulnerabilities: string[],
  suggested_fix: string
}

type Analysis = {
  sentiment: "positive" | "negative" | "neutral",
  summary: string(maxLength=100),
  action_items: string[]
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

llm AnalyzeFeedback(raw_text: string) -> Analysis {
  model: "gpt-4o"
  temperature: 0.3
  system: "You are a Senior Product Manager."
  prompt:
    """
    Review this customer feedback: {{raw_text}}
    Focus specifically on technical debt and UI friction.
    """
}
`;
    const module = compileFile(source);

    // Verify types
    expect(module.types.size).toBe(2);
    expect(module.types.has("Critique")).toBe(true);
    expect(module.types.has("Analysis")).toBe(true);

    // Verify functions
    expect(module.functions.size).toBe(2);
    expect(module.functions.has("SecurityReviewer")).toBe(true);
    expect(module.functions.has("AnalyzeFeedback")).toBe(true);

    // Verify SecurityReviewer function
    const reviewer = module.functions.get("SecurityReviewer")!;
    expect(reviewer.model).toBe("gpt-4o");
    expect(reviewer.temperature).toBe(0.2);
    expect(reviewer.system).toContain("security researcher");
    expect(reviewer.prompt("function login() {}")).toContain("function login() {}");

    // Verify Critique schema validates correctly
    const critiqueSchema = module.types.get("Critique")!;
    const validCritique = critiqueSchema.safeParse({
      score: 8,
      vulnerabilities: ["SQL injection", "XSS"],
      suggested_fix: "Use parameterized queries",
    });
    expect(validCritique.success).toBe(true);

    const invalidCritique = critiqueSchema.safeParse({
      score: 15,  // out of range
      vulnerabilities: "not an array",
      suggested_fix: 42,
    });
    expect(invalidCritique.success).toBe(false);

    // Verify Analysis schema validates correctly
    const analysisSchema = module.types.get("Analysis")!;
    const validAnalysis = analysisSchema.safeParse({
      sentiment: "positive",
      summary: "Great product",
      action_items: ["Fix bug #123"],
    });
    expect(validAnalysis.success).toBe(true);

    const invalidSentiment = analysisSchema.safeParse({
      sentiment: "unknown",  // not in enum
      summary: "test",
      action_items: [],
    });
    expect(invalidSentiment.success).toBe(false);

    // Verify AnalyzeFeedback function
    const analyzer = module.functions.get("AnalyzeFeedback")!;
    expect(analyzer.model).toBe("gpt-4o");
    expect(analyzer.temperature).toBe(0.3);
    expect(analyzer.prompt("The UI is slow")).toContain("The UI is slow");
  });
});
