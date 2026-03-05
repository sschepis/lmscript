import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  BudgetConfig,
  ChatMessage,
  ContextStackOptions,
  ExecutionContext,
  ExecutionResult,
  LLMProvider,
  LLMRequest,
  LScriptFunction,
  ParallelResult,
  ParallelTaskResult,
  RuntimeConfig,
  StreamResult,
  ToolCall,
  ToolDefinition,
} from "./types.js";
import { MiddlewareManager } from "./middleware.js";
import type { ExecutionCache } from "./cache.js";
import { BudgetExceededError } from "./cost-tracker.js";
import type { CostTracker } from "./cost-tracker.js";
import { Logger, LogLevel } from "./logger.js";
import { diffSchemaResult, formatSchemaDiff } from "./testing/schema-diff.js";
import { ContextStack } from "./context.js";
import { Session } from "./session.js";
import type { OutputTransformer } from "./transformer.js";

const MAX_TOOL_CALL_DEPTH = 5;

/**
 * LScriptRuntime is the core execution engine.
 *
 * It "compiles" an LScriptFunction into a structured LLM call by:
 * 1. Injecting the Zod schema as JSON Schema into system instructions
 * 2. Building the prompt from the input via the template function
 * 3. Validating the LLM's JSON response against the schema
 * 4. Retrying with error feedback if validation fails
 */
export class LScriptRuntime {
  private provider: LLMProvider;
  private defaultTemperature: number;
  private defaultMaxRetries: number;
  private verbose: boolean;

  /** Middleware manager for hooking into the execution lifecycle. */
  readonly middleware: MiddlewareManager;

  /** Optional execution cache for memoizing LLM responses. */
  private cache?: ExecutionCache;

  /** Optional cost tracker for token usage tracking. */
  private costTracker?: CostTracker;

  /** Optional budget configuration for limiting token/cost usage. */
  private budget?: BudgetConfig;

  /** Structured logger for execution tracing. */
  private logger: Logger;

  constructor(config: RuntimeConfig) {
    this.provider = config.provider;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
    this.defaultMaxRetries = config.defaultMaxRetries ?? 2;
    this.verbose = config.verbose ?? false;
    this.middleware = config.middleware ?? new MiddlewareManager();
    this.cache = config.cache;
    this.costTracker = config.costTracker;
    this.budget = config.budget;
    this.logger = config.logger ?? new Logger({ level: LogLevel.SILENT });
  }

  /**
   * Execute a typed LLM function against the configured provider.
   *
   * @returns A validated, fully-typed result matching the function's Zod schema.
   * @throws If the LLM output fails validation after all retries.
   */
  async execute<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I
  ): Promise<ExecutionResult<z.infer<O>>> {
    // ── Create execution span ──
    const span = this.logger.startSpan(`execute:${fn.name}`);

    // ── Check cache ──
    if (this.cache) {
      const cached = await this.cache.getCached<z.infer<O>>(fn, input);
      if (cached) {
        this.logger.debug(`Cache hit for: ${fn.name}`, { fn: fn.name });
        span.end();
        return { ...cached, attempts: 0 };
      }
    }

    // ── Check budget before execution ──
    if (this.costTracker && this.budget) {
      this.costTracker.checkBudget(this.budget);
    }

    const maxRetries = fn.maxRetries ?? this.defaultMaxRetries;
    const temperature = fn.temperature ?? this.defaultTemperature;

    const jsonSchema = zodToJsonSchema(fn.schema, { target: "openApi3" });

    const schemaInstruction = [
      "YOU MUST RESPOND ONLY WITH VALID JSON.",
      "YOUR RESPONSE MUST CONFORM TO THIS JSON SCHEMA:",
      JSON.stringify(jsonSchema, null, 2),
      "DO NOT include any text outside the JSON object.",
    ].join("\n");

    const systemContent = `${fn.system}\n\n${schemaInstruction}`;
    const userContent = fn.prompt(input);

    this.logger.info(`Compiling prompt for: ${fn.name}`, { fn: fn.name, model: fn.model });
    this.logger.debug(`Target model: ${fn.model}`, { model: fn.model });

    // Build few-shot example messages if provided
    const exampleMessages: ChatMessage[] = [];
    if (fn.examples && fn.examples.length > 0) {
      for (const example of fn.examples) {
        exampleMessages.push({
          role: "user",
          content: fn.prompt(example.input),
        });
        exampleMessages.push({
          role: "assistant",
          content: JSON.stringify(example.output),
        });
      }
    }

    // Build tool definitions for the request if provided
    const requestTools = this.buildRequestTools(fn.tools);

    // Build initial messages for middleware context
    const initialMessages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...exampleMessages,
      { role: "user", content: userContent },
    ];

    // Create execution context for middleware
    const execCtx: ExecutionContext = {
      fn: fn as LScriptFunction<unknown, any>,
      input,
      messages: initialMessages,
      attempt: 0,
      startTime: Date.now(),
    };

    // ── Run onBeforeExecute hooks ──
    await this.middleware.runBeforeExecute(execCtx);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      execCtx.attempt = attempt;
      span.log(LogLevel.DEBUG, `Attempt ${attempt}/${maxRetries + 1}`, { fn: fn.name, model: fn.model, attempt });

      const messages: ChatMessage[] = [
        { role: "system", content: systemContent },
        ...exampleMessages,
        { role: "user", content: userContent },
      ];

      // On retry, append the validation error as feedback
      if (lastError) {
        messages.push({
          role: "user",
          content: [
            "Your previous response did not match the required schema.",
            `Error: ${lastError.message}`,
            "Please fix your response and try again. Return ONLY valid JSON.",
          ].join("\n"),
        });
      }

      try {
        const request: LLMRequest = {
          model: fn.model,
          messages,
          temperature,
          jsonMode: true,
          ...(requestTools ? { tools: requestTools } : {}),
        };

        // Execute with tool calling loop
        const { response, toolCalls: recordedToolCalls } =
          await this.executeWithToolLoop(request, fn.tools);

        const parsed = this.parseJSON(response.content);
        const validated = fn.schema.safeParse(parsed);

        if (validated.success) {
          span.log(LogLevel.INFO, `Schema validation passed on attempt ${attempt}`, { fn: fn.name, attempt });

          // ── Run onAfterValidation hooks ──
          await this.middleware.runAfterValidation(execCtx, validated.data);

          const result: ExecutionResult<z.infer<O>> = {
            data: validated.data,
            attempts: attempt,
            usage: response.usage,
          };
          if (recordedToolCalls.length > 0) {
            result.toolCalls = recordedToolCalls;
          }

          // ── Track usage ──
          if (this.costTracker && response.usage) {
            this.costTracker.trackUsage(fn.name, response.usage);
          }

          // ── Check budget after execution ──
          if (this.costTracker && this.budget) {
            this.costTracker.checkBudget(this.budget);
          }

          // ── Store in cache ──
          if (this.cache) {
            await this.cache.setCached(fn, input, result);
          }

          // ── Run onComplete hooks ──
          await this.middleware.runComplete(execCtx, result);

          span.end();
          return result;
        }

        // Validation failed — format the error for retry
        const zodErrorMsg = validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");

        // Generate schema diff for verbose/debug logging
        if (this.verbose || this.logger.getLevel() <= LogLevel.DEBUG) {
          try {
            const schemaDiffs = diffSchemaResult(fn.schema, parsed);
            if (schemaDiffs.length > 0) {
              const diffReport = formatSchemaDiff(schemaDiffs);
              this.logger.debug(`Schema diff report:\n${diffReport}`, { fn: fn.name, attempt });
              lastError = new Error(`${zodErrorMsg}\n${diffReport}`);
            } else {
              lastError = new Error(zodErrorMsg);
            }
          } catch {
            lastError = new Error(zodErrorMsg);
          }
        } else {
          lastError = new Error(zodErrorMsg);
        }
        span.log(LogLevel.WARN, `Schema validation failed: ${zodErrorMsg}`, { fn: fn.name, attempt });

        // ── Run onRetry hooks (if not the last attempt) ──
        if (attempt < maxRetries + 1) {
          await this.middleware.runRetry(execCtx, lastError);
        }
      } catch (err) {
        // Re-throw BudgetExceededError immediately — not retryable
        if (err instanceof BudgetExceededError) {
          throw err;
        }

        lastError =
          err instanceof Error ? err : new Error(String(err));
        span.log(LogLevel.ERROR, `Execution error: ${lastError.message}`, { fn: fn.name, attempt });

        // ── Run onError hooks ──
        await this.middleware.runError(execCtx, lastError);
      }
    }

    const finalError = new Error(
      `[lmscript] Compilation failed for "${fn.name}" after ${maxRetries + 1} attempts. ` +
        `Last error: ${lastError?.message}`
    );

    // ── Run onError hooks for final failure ──
    await this.middleware.runError(execCtx, finalError);

    span.end();
    throw finalError;
  }

  /**
   * Execute a typed LLM function with streaming support.
   *
   * Returns a StreamResult with an async iterable of partial tokens and
   * a promise that resolves to the validated result once streaming completes.
   *
   * If the provider doesn't support chatStream, falls back to execute()
   * and yields the full result as a single chunk.
   */
  executeStream<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I
  ): StreamResult<z.infer<O>> {
    // Check if provider supports streaming
    if (!this.provider.chatStream) {
      // Fallback: execute normally and yield full result as one chunk
      return this.executeStreamFallback(fn, input);
    }

    const temperature = fn.temperature ?? this.defaultTemperature;
    const jsonSchema = zodToJsonSchema(fn.schema, { target: "openApi3" });

    const schemaInstruction = [
      "YOU MUST RESPOND ONLY WITH VALID JSON.",
      "YOUR RESPONSE MUST CONFORM TO THIS JSON SCHEMA:",
      JSON.stringify(jsonSchema, null, 2),
      "DO NOT include any text outside the JSON object.",
    ].join("\n");

    const systemContent = `${fn.system}\n\n${schemaInstruction}`;
    const userContent = fn.prompt(input);

    const exampleMessages: ChatMessage[] = [];
    if (fn.examples && fn.examples.length > 0) {
      for (const example of fn.examples) {
        exampleMessages.push({
          role: "user",
          content: fn.prompt(example.input),
        });
        exampleMessages.push({
          role: "assistant",
          content: JSON.stringify(example.output),
        });
      }
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...exampleMessages,
      { role: "user", content: userContent },
    ];

    const request: LLMRequest = {
      model: fn.model,
      messages,
      temperature,
      jsonMode: true,
    };

    let accumulated = "";
    let resolveResult: (value: ExecutionResult<z.infer<O>>) => void;
    let rejectResult: (reason: Error) => void;

    const resultPromise = new Promise<ExecutionResult<z.infer<O>>>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const provider = this.provider;
    const schema = fn.schema;
    const parseJSON = this.parseJSON.bind(this);

    async function* streamGenerator(): AsyncGenerator<string> {
      try {
        for await (const chunk of provider.chatStream!(request)) {
          accumulated += chunk;
          yield chunk;
        }

        // Validate accumulated content
        const parsed = parseJSON(accumulated);
        const validated = schema.safeParse(parsed);

        if (validated.success) {
          resolveResult!({
            data: validated.data,
            attempts: 1,
          });
        } else {
          const errorMsg = validated.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          rejectResult!(
            new Error(`[lmscript] Stream validation failed: ${errorMsg}`)
          );
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        rejectResult!(error);
        throw error;
      }
    }

    return {
      stream: streamGenerator(),
      result: resultPromise,
    };
  }

  /**
   * Fallback for executeStream when provider doesn't support chatStream.
   * Executes normally and yields the full JSON result as a single chunk.
   */
  private executeStreamFallback<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I
  ): StreamResult<z.infer<O>> {
    let resolveResult: (value: ExecutionResult<z.infer<O>>) => void;
    let rejectResult: (reason: Error) => void;

    const resultPromise = new Promise<ExecutionResult<z.infer<O>>>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const self = this;

    async function* fallbackGenerator(): AsyncGenerator<string> {
      try {
        const result = await self.execute(fn, input);
        const content = JSON.stringify(result.data);
        yield content;
        resolveResult!(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        rejectResult!(error);
        throw error;
      }
    }

    return {
      stream: fallbackGenerator(),
      result: resultPromise,
    };
  }

  /**
   * Execute an LLM request with tool calling loop support.
   * Handles up to MAX_TOOL_CALL_DEPTH rounds of tool calls.
   */
  private async executeWithToolLoop(
    request: LLMRequest,
    tools?: ToolDefinition[]
  ): Promise<{
    response: { content: string; usage?: ExecutionResult<unknown>["usage"] };
    toolCalls: ToolCall[];
  }> {
    const recordedToolCalls: ToolCall[] = [];
    let currentMessages = [...request.messages];
    let lastUsage: ExecutionResult<unknown>["usage"] = undefined;

    for (let depth = 0; depth <= MAX_TOOL_CALL_DEPTH; depth++) {
      const response = await this.provider.chat({
        ...request,
        messages: currentMessages,
      });

      lastUsage = response.usage;

      // If no tool calls in response, return the final response
      if (!response.toolCalls || response.toolCalls.length === 0 || !tools || tools.length === 0) {
        return {
          response: { content: response.content, usage: lastUsage },
          toolCalls: recordedToolCalls,
        };
      }

      // Process tool calls
      // Add assistant message with tool calls indication
      currentMessages.push({
        role: "assistant",
        content: response.content || JSON.stringify(response.toolCalls),
      });

      for (const tc of response.toolCalls) {
        const toolDef = tools.find((t) => t.name === tc.name);
        if (!toolDef) {
          this.logger.warn(`Unknown tool called: ${tc.name}`, { tool: tc.name });
          continue;
        }

        try {
          const parsedArgs = JSON.parse(tc.arguments);
          const validatedArgs = toolDef.parameters.parse(parsedArgs);
          const toolResult = await Promise.resolve(toolDef.execute(validatedArgs));

          recordedToolCalls.push({
            name: tc.name,
            arguments: parsedArgs,
            result: toolResult,
          });

          // Append tool result as a user message for the next round
          currentMessages.push({
            role: "user",
            content: JSON.stringify({
              tool_call_id: tc.id,
              tool_name: tc.name,
              result: toolResult,
            }),
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.logger.error(`Tool execution error for ${tc.name}: ${error.message}`, { tool: tc.name });

          recordedToolCalls.push({
            name: tc.name,
            arguments: tc.arguments,
            result: { error: error.message },
          });

          currentMessages.push({
            role: "user",
            content: JSON.stringify({
              tool_call_id: tc.id,
              tool_name: tc.name,
              error: error.message,
            }),
          });
        }
      }

      // If we've hit max depth, throw
      if (depth === MAX_TOOL_CALL_DEPTH) {
        throw new Error(
          `[lmscript] Maximum tool call depth (${MAX_TOOL_CALL_DEPTH}) exceeded`
        );
      }
    }

    // Should not reach here, but just in case
    throw new Error("[lmscript] Tool call loop terminated unexpectedly");
  }

  /**
   * Build request-compatible tool definitions from ToolDefinition array.
   */
  private buildRequestTools(
    tools?: ToolDefinition[]
  ): LLMRequest["tools"] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters, { target: "openApi3" }) as object,
    }));
  }

  /**
   * Parse a string as JSON, handling common LLM quirks like
   * markdown code fences wrapping the JSON.
   */
  private parseJSON(content: string): unknown {
    let cleaned = content.trim();

    // Strip markdown code fences if present
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(
        `[lmscript] Failed to parse LLM response as JSON. Raw content:\n${content}`
      );
    }
  }

  // ── Parallel Execution ──────────────────────────────────────────────

  /**
   * Execute multiple named tasks concurrently.
   * Returns results for all tasks (including failures) plus aggregated usage.
   */
  async executeAll(
    tasks: Array<{ name: string; fn: LScriptFunction<any, any>; input: any }>
  ): Promise<ParallelResult> {
    const settled = await Promise.allSettled(
      tasks.map(async (task) => {
        const result = await this.execute(task.fn, task.input);
        return { name: task.name, result };
      })
    );

    const taskResults: ParallelTaskResult[] = [];
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        successCount++;
        const { name, result } = outcome.value;
        if (result.usage) {
          totalUsage.promptTokens += result.usage.promptTokens;
          totalUsage.completionTokens += result.usage.completionTokens;
          totalUsage.totalTokens += result.usage.totalTokens;
        }
        taskResults.push({ name, status: "fulfilled", result });
      } else {
        failureCount++;
        const error = outcome.reason instanceof Error
          ? outcome.reason
          : new Error(String(outcome.reason));
        taskResults.push({ name: tasks[i].name, status: "rejected", error });
      }
    }

    return { tasks: taskResults, totalUsage, successCount, failureCount };
  }

  /**
   * Execute the same function against multiple inputs in parallel.
   * Optionally limit concurrency with `options.concurrency`.
   */
  async executeBatch<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    inputs: I[],
    options?: { concurrency?: number }
  ): Promise<Array<ExecutionResult<z.infer<O>>>> {
    const concurrency = options?.concurrency;

    if (!concurrency || concurrency >= inputs.length) {
      // Run all at once
      return Promise.all(inputs.map((input) => this.execute(fn, input)));
    }

    // Semaphore-based concurrency limiting
    const results: Array<ExecutionResult<z.infer<O>>> = new Array(inputs.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < inputs.length) {
        const currentIndex = index++;
        results[currentIndex] = await this.execute(fn, inputs[currentIndex]);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }

  // ── Output Transformers ─────────────────────────────────────────────

  /**
   * Execute a function and apply a transformer to the validated output.
   */
  async executeWithTransform<I, O extends z.ZodType, U>(
    fn: LScriptFunction<I, O>,
    input: I,
    transformer: OutputTransformer<z.infer<O>, U>
  ): Promise<ExecutionResult<U>> {
    const result = await this.execute(fn, input);
    const transformed = await Promise.resolve(transformer(result.data));
    return {
      data: transformed,
      attempts: result.attempts,
      usage: result.usage,
      toolCalls: result.toolCalls,
    };
  }

  // ── Conversational Sessions ─────────────────────────────────────────

  /**
   * Create a new conversational session for a function.
   * The session maintains conversation history across multiple `send()` calls.
   */
  createSession<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    contextOptions?: ContextStackOptions
  ): Session<I, O> {
    const contextStack = new ContextStack(contextOptions);
    return new Session(this, fn, contextStack);
  }

  // ── Internal: execute with conversation history ─────────────────────

  /**
   * Execute a function with additional conversation history injected
   * between the system message and the current user message.
   * Used by Session to maintain multi-turn conversations.
   * @internal
   */
  async executeWithHistory<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I,
    conversationHistory: ChatMessage[]
  ): Promise<ExecutionResult<z.infer<O>>> {
    const span = this.logger.startSpan(`executeWithHistory:${fn.name}`);

    if (this.cache) {
      const cached = await this.cache.getCached<z.infer<O>>(fn, input);
      if (cached) {
        span.end();
        return { ...cached, attempts: 0 };
      }
    }

    if (this.costTracker && this.budget) {
      this.costTracker.checkBudget(this.budget);
    }

    const maxRetries = fn.maxRetries ?? this.defaultMaxRetries;
    const temperature = fn.temperature ?? this.defaultTemperature;
    const jsonSchema = zodToJsonSchema(fn.schema, { target: "openApi3" });

    const schemaInstruction = [
      "YOU MUST RESPOND ONLY WITH VALID JSON.",
      "YOUR RESPONSE MUST CONFORM TO THIS JSON SCHEMA:",
      JSON.stringify(jsonSchema, null, 2),
      "DO NOT include any text outside the JSON object.",
    ].join("\n");

    const systemContent = `${fn.system}\n\n${schemaInstruction}`;
    const userContent = fn.prompt(input);

    const exampleMessages: ChatMessage[] = [];
    if (fn.examples && fn.examples.length > 0) {
      for (const example of fn.examples) {
        exampleMessages.push({ role: "user", content: fn.prompt(example.input) });
        exampleMessages.push({ role: "assistant", content: JSON.stringify(example.output) });
      }
    }

    const requestTools = this.buildRequestTools(fn.tools);

    const initialMessages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...exampleMessages,
      ...conversationHistory,
      { role: "user", content: userContent },
    ];

    const execCtx: ExecutionContext = {
      fn: fn as LScriptFunction<unknown, any>,
      input,
      messages: initialMessages,
      attempt: 0,
      startTime: Date.now(),
    };

    await this.middleware.runBeforeExecute(execCtx);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      execCtx.attempt = attempt;

      const messages: ChatMessage[] = [
        { role: "system", content: systemContent },
        ...exampleMessages,
        ...conversationHistory,
        { role: "user", content: userContent },
      ];

      if (lastError) {
        messages.push({
          role: "user",
          content: [
            "Your previous response did not match the required schema.",
            `Error: ${lastError.message}`,
            "Please fix your response and try again. Return ONLY valid JSON.",
          ].join("\n"),
        });
      }

      try {
        const request: LLMRequest = {
          model: fn.model,
          messages,
          temperature,
          jsonMode: true,
          ...(requestTools ? { tools: requestTools } : {}),
        };

        const { response, toolCalls: recordedToolCalls } =
          await this.executeWithToolLoop(request, fn.tools);

        const parsed = this.parseJSON(response.content);
        const validated = fn.schema.safeParse(parsed);

        if (validated.success) {
          await this.middleware.runAfterValidation(execCtx, validated.data);

          const result: ExecutionResult<z.infer<O>> = {
            data: validated.data,
            attempts: attempt,
            usage: response.usage,
          };
          if (recordedToolCalls.length > 0) {
            result.toolCalls = recordedToolCalls;
          }

          if (this.costTracker && response.usage) {
            this.costTracker.trackUsage(fn.name, response.usage);
          }
          if (this.costTracker && this.budget) {
            this.costTracker.checkBudget(this.budget);
          }
          if (this.cache) {
            await this.cache.setCached(fn, input, result);
          }

          await this.middleware.runComplete(execCtx, result);
          span.end();
          return result;
        }

        const zodErrorMsg = validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        lastError = new Error(zodErrorMsg);

        if (attempt < maxRetries + 1) {
          await this.middleware.runRetry(execCtx, lastError);
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        await this.middleware.runError(execCtx, lastError);
      }
    }

    const finalError = new Error(
      `[lmscript] Compilation failed for "${fn.name}" after ${maxRetries + 1} attempts. ` +
        `Last error: ${lastError?.message}`
    );
    await this.middleware.runError(execCtx, finalError);
    span.end();
    throw finalError;
  }

  private log(message: string): void {
    if (this.verbose) {
      // eslint-disable-next-line no-console
      console.log(message);
    }
  }
}
