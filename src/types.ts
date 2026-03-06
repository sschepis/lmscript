import { z } from "zod";
import type { MiddlewareManager } from "./middleware.js";
import type { ExecutionCache } from "./cache.js";
import type { CostTracker } from "./cost-tracker.js";
import type { Logger } from "./logger.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { TokenCounter } from "./tokenizer.js";

// ── Chat message types ──────────────────────────────────────────────

export type Role = "system" | "user" | "assistant";

/** A text content block */
export interface TextContent {
  type: "text";
  text: string;
}

/** An image content block from a URL */
export interface ImageUrlContent {
  type: "image_url";
  image_url: {
    url: string;
    /** How the model should process the image. Default varies by provider. */
    detail?: "auto" | "low" | "high";
  };
}

/** An image content block from base64-encoded data */
export interface ImageBase64Content {
  type: "image_base64";
  /** MIME type (e.g., "image/png", "image/jpeg") */
  mediaType: string;
  /** Base64-encoded image data */
  data: string;
}

/** A content block in a multi-modal message */
export type ContentBlock = TextContent | ImageUrlContent | ImageBase64Content;

/** Message content can be a simple string or an array of content blocks */
export type MessageContent = string | ContentBlock[];

export interface ChatMessage {
  role: Role;
  content: MessageContent;
}

// ── LLM Provider abstraction ────────────────────────────────────────

export interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  jsonMode: boolean;
  /** Optional JSON Schema for native structured output. When provided, providers
   * that support it will use response_format with json_schema type. */
  jsonSchema?: {
    name: string;
    schema: object;
    strict?: boolean;
  };
  tools?: Array<{ name: string; description: string; parameters: object }>;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface LLMProvider {
  readonly name: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
  chatStream?(request: LLMRequest): AsyncIterable<string>;
  /** Whether this provider supports native JSON Schema structured output */
  readonly supportsStructuredOutput?: boolean;
}

// ── L-Script Function definition ────────────────────────────────────

/**
 * An LScriptFunction defines a typed, compiled LLM call.
 *
 * @template I - The input type for the prompt template
 * @template O - A Zod schema describing the expected output shape
 */
export interface LScriptFunction<I, O extends z.ZodType> {
  /** Human-readable name for logging and debugging */
  name: string;

  /** Target model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514", "gemini-1.5-pro") */
  model: string;

  /** System instructions that set the LLM's persona and constraints */
  system: string;

  /** A function that takes the input and produces the user prompt string */
  prompt: (input: I) => string;

  /** Zod schema that validates and types the LLM's JSON output */
  schema: O;

  /** Sampling temperature (0 = deterministic, 1 = creative). Default: 0.7 */
  temperature?: number;

  /** Maximum retries on schema validation failure. Default: 2 */
  maxRetries?: number;

  /** Optional few-shot examples for in-context learning */
  examples?: Array<{ input: I; output: z.infer<O> }>;

  /** Optional tool definitions for LLM function calling */
  tools?: ToolDefinition[];

  /** Optional per-function retry backoff configuration */
  retryConfig?: RetryConfig;
}

// ── Retry configuration ─────────────────────────────────────────────

export interface RetryConfig {
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelay?: number;
  /** Maximum delay in ms. Default: 30000 */
  maxDelay?: number;
  /** Jitter factor (0-1). Adds randomness to prevent thundering herd. Default: 0.2 */
  jitterFactor?: number;
}

// ── Runtime configuration ───────────────────────────────────────────

export interface RuntimeConfig {
  /** The LLM provider to use */
  provider: LLMProvider;

  /** Default temperature if not specified per-function */
  defaultTemperature?: number;

  /** Default max retries if not specified per-function */
  defaultMaxRetries?: number;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Optional middleware manager for execution lifecycle hooks */
  middleware?: MiddlewareManager;

  /** Optional execution cache for memoizing LLM responses */
  cache?: ExecutionCache;

  /** Optional cost tracker for token usage tracking */
  costTracker?: CostTracker;

  /** Optional budget configuration for limiting token/cost usage */
  budget?: BudgetConfig;

  /** Optional structured logger for execution tracing */
  logger?: Logger;

  /** Optional retry backoff configuration */
  retryConfig?: RetryConfig;

  /** Optional rate limiter for throttling API requests */
  rateLimiter?: RateLimiter;
}

// ── Context / Memory types ──────────────────────────────────────────

export interface ContextStackOptions {
  /** Maximum number of tokens allowed in context. Default: 4096 */
  maxTokens?: number;

  /** Strategy for pruning when token limit is reached */
  pruneStrategy?: "fifo" | "summarize";

  /** Custom token counter. Defaults to built-in estimator. */
  tokenCounter?: TokenCounter;
}

// ── Execution result wrapper ────────────────────────────────────────

export interface ExecutionResult<T> {
  /** The validated, typed output */
  data: T;

  /** Number of attempts needed (1 = first try succeeded) */
  attempts: number;

  /** Token usage for this execution */
  usage?: LLMResponse["usage"];

  /** Tool calls made during execution */
  toolCalls?: ToolCall[];
}

// ── Streaming types ─────────────────────────────────────────────────

export interface StreamResult<T> {
  /** AsyncIterable of partial tokens as they arrive */
  stream: AsyncIterable<string>;

  /** Promise that resolves to the validated ExecutionResult once streaming completes */
  result: Promise<ExecutionResult<T>>;
}

// ── Tool/Function calling types ─────────────────────────────────────

export interface ToolDefinition<P extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  description: string;
  parameters: P;
  execute: (params: z.infer<P>) => Promise<R> | R;
}

export interface ToolCall {
  name: string;
  arguments: unknown;
  result: unknown;
}

// ── Pipeline types ──────────────────────────────────────────────────

export interface PipelineStepResult<T = unknown> {
  /** Name of the LScriptFunction that produced this step */
  name: string;

  /** The validated output data from this step */
  data: T;

  /** Number of attempts needed for this step */
  attempts: number;

  /** Token usage for this step */
  usage?: LLMResponse["usage"];
}

export interface PipelineResult<T = unknown> {
  /** The final output of the last pipeline step */
  finalData: T;

  /** Results from each step in order */
  steps: PipelineStepResult[];

  /** Aggregated token usage across all steps */
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ── Middleware / Hooks types ────────────────────────────────────────

export interface ExecutionContext<I = unknown, O = unknown> {
  fn: LScriptFunction<I, any>;
  input: I;
  messages: ChatMessage[];
  attempt: number;
  startTime: number;
}

export interface MiddlewareHooks {
  onBeforeExecute?: (ctx: ExecutionContext) => Promise<void> | void;
  onAfterValidation?: (ctx: ExecutionContext, result: unknown) => Promise<void> | void;
  onRetry?: (ctx: ExecutionContext, error: Error) => Promise<void> | void;
  onError?: (ctx: ExecutionContext, error: Error) => Promise<void> | void;
  onComplete?: (ctx: ExecutionContext, result: ExecutionResult<unknown>) => Promise<void> | void;
}

// ── Cache types ─────────────────────────────────────────────────────

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// ── Cost tracking types ─────────────────────────────────────────────

export type ModelPricing = Record<string, { inputPer1k: number; outputPer1k: number }>;

export interface BudgetConfig {
  maxTotalTokens?: number;
  maxTokensPerExecution?: number;
  maxTotalCost?: number;
  modelPricing?: ModelPricing;
}

// ── Parallel execution types ────────────────────────────────────────

export interface ParallelTaskResult {
  name: string;
  status: "fulfilled" | "rejected";
  result?: ExecutionResult<unknown>;
  error?: Error;
}

export interface ParallelResult {
  tasks: ParallelTaskResult[];
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  successCount: number;
  failureCount: number;
}
