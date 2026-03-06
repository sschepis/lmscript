// ── L-Script: Typed LLM Orchestration Runtime ──────────────────────

// Core types
export type {
  ChatMessage,
  Role,
  TextContent,
  ImageUrlContent,
  ImageBase64Content,
  ContentBlock,
  MessageContent,
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
  RetryConfig,
} from "./types.js";

// Content helpers
export { extractText } from "./content.js";

// Runtime
export { LScriptRuntime } from "./runtime.js";

// Agent loop
export { AgentLoop } from "./agent.js";
export type { AgentConfig, AgentResult } from "./agent.js";

// Context management
export { ContextStack } from "./context.js";
export type { SummarizerFn } from "./context.js";

// Tokenizer
export { estimateTokens, simpleTokenEstimator } from "./tokenizer.js";
export type { TokenCounter } from "./tokenizer.js";

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
export { OpenRouterProvider } from "./providers/openrouter.js";
export type { OpenRouterProviderConfig } from "./providers/openrouter.js";
export { VertexAnthropicProvider } from "./providers/vertex-anthropic.js";
export type { VertexAnthropicProviderConfig } from "./providers/vertex-anthropic.js";
export { DeepSeekProvider } from "./providers/deepseek.js";
export { FallbackProvider, AllProvidersFailedError } from "./providers/fallback.js";
export type { FallbackProviderConfig } from "./providers/fallback.js";

// Circuit Breaker
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";

// Router
export { ModelRouter } from "./router.js";
export type { RoutingRule } from "./router.js";

// Middleware
export { MiddlewareManager } from "./middleware.js";

// Cache
export { MemoryCacheBackend, ExecutionCache } from "./cache.js";

// Cost tracking
export { CostTracker, BudgetExceededError } from "./cost-tracker.js";

// Rate limiting
export { RateLimiter } from "./rate-limiter.js";
export type { RateLimitConfig } from "./rate-limiter.js";

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

// Prompt versioning & A/B testing
export { PromptRegistry } from "./prompt-registry.js";
export type { PromptVariant, VariantMetrics, SelectionStrategy, PromptRegistryConfig } from "./prompt-registry.js";

// Telemetry (OpenTelemetry-compatible, no hard dependency)
export { OTelLogTransport, createTelemetryMiddleware } from "./telemetry.js";
export type {
  TelemetrySpan,
  TelemetryTracer,
  TelemetryMeter,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryConfig,
} from "./telemetry.js";

// Embeddings & RAG
export { MemoryVectorStore, cosineSimilarity } from "./embeddings.js";
export type { EmbeddingProvider, VectorDocument, VectorSearchResult, VectorStore } from "./embeddings.js";
export { RAGPipeline } from "./rag.js";
export type { RAGConfig, RAGResult } from "./rag.js";
export { OpenAIEmbeddingProvider } from "./providers/openai-embeddings.js";

// Batch processing
export { BatchManager } from "./batch.js";
export type {
  BatchJobStatus,
  BatchRequest,
  BatchRequestResult,
  BatchJob,
  BatchManagerConfig,
} from "./batch.js";
