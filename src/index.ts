// ── L-Script: Typed LLM Orchestration Runtime ──────────────────────

// Core types
export type {
  ChatMessage,
  Role,
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  LScriptFunction,
  RuntimeConfig,
  ContextStackOptions,
  ExecutionResult,
  PipelineResult,
  PipelineStepResult,
  StreamResult,
  ToolDefinition,
  ToolCall,
  ExecutionContext,
  MiddlewareHooks,
  CacheBackend,
  ModelPricing,
  BudgetConfig,
  ParallelResult,
  ParallelTaskResult,
} from "./types.js";

// Runtime
export { LScriptRuntime } from "./runtime.js";

// Context management
export { ContextStack } from "./context.js";
export type { SummarizerFn } from "./context.js";

// Session
export { Session } from "./session.js";

// Pipeline
export { Pipeline } from "./pipeline.js";

// Transformers
export {
  withTransform,
  dateStringTransformer,
  trimStringsTransformer,
  composeTransformers,
} from "./transformer.js";
export type { OutputTransformer } from "./transformer.js";

// Providers
export { BaseLLMProvider } from "./providers/base.js";
export { OpenAIProvider } from "./providers/openai.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export { GeminiProvider } from "./providers/gemini.js";
export { OllamaProvider } from "./providers/ollama.js";
export { LMStudioProvider } from "./providers/lmstudio.js";
export { FallbackProvider, AllProvidersFailedError } from "./providers/fallback.js";

// Router
export { ModelRouter } from "./router.js";
export type { RoutingRule } from "./router.js";

// Middleware
export { MiddlewareManager } from "./middleware.js";

// Cache
export { MemoryCacheBackend, ExecutionCache } from "./cache.js";

// Cost tracking
export { CostTracker, BudgetExceededError } from "./cost-tracker.js";

// Structured logging
export { Logger, Span, ConsoleTransport, LogLevel } from "./logger.js";
export type { LogEntry, LogTransport, LoggerOptions } from "./logger.js";

// CLI utilities
export { generateManifest, extractFunctions } from "./cli.js";
export type { FunctionManifest } from "./cli.js";

// DSL (L-Script parser/compiler)
export {
  TokenType,
  Lexer,
  LexerError,
  Parser,
  ParseError,
  compile,
  compileFile,
  CompileError,
} from "./dsl/index.js";
export type {
  Token,
  TypeFieldNode,
  TypeDeclarationNode,
  LLMFunctionNode,
  ASTNode,
  Program,
  CompiledModule,
} from "./dsl/index.js";

// Testing utilities
export {
  MockProvider,
  createMockProvider,
  diffSchemaResult,
  formatSchemaDiff,
  captureSnapshot,
  compareSnapshots,
  formatSnapshotDiff,
  ChaosProvider,
  generateFuzzInputs,
} from "./testing/index.js";
export type {
  MockProviderConfig,
  SchemaDiff,
  PromptSnapshot,
  SnapshotDiff,
  ChaosConfig,
} from "./testing/index.js";
