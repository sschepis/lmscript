/**
 * Production Stack Demo — LM Studio variant
 *
 * Runs the production-stack example against an LM Studio server.
 *
 * Usage:
 *   npx tsx src/examples/production-stack-lmstudio.ts
 */

import { z } from "zod";
import {
  LScriptRuntime,
  LMStudioProvider,
  FallbackProvider,
  ModelRouter,
  MiddlewareManager,
  MemoryCacheBackend,
  ExecutionCache,
  CostTracker,
  Logger,
  LogLevel,
  ConsoleTransport,
  Pipeline,
  trimStringsTransformer,
} from "../index.js";
import type {
  LScriptFunction,
  MiddlewareHooks,
  ExecutionContext,
  ExecutionResult,
  BudgetConfig,
  LogTransport,
  LogEntry,
} from "../index.js";

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════

const LM_STUDIO_BASE_URL = "http://192.168.4.79:1234/v1/chat/completions";
const LM_STUDIO_MODEL = "qwen2.5-coder-32b-instruct-uncensored";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const IntentClassificationSchema = z.object({
  intent: z.enum([
    "question",
    "complaint",
    "feature_request",
    "praise",
    "bug_report",
    "general",
  ]),
  confidence: z.number().min(0).max(1),
  sub_category: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  suggested_department: z.string(),
});

const EntityExtractionSchema = z.object({
  entities: z.array(
    z.object({
      text: z.string(),
      type: z.enum([
        "person",
        "organization",
        "location",
        "product",
        "date",
        "amount",
        "technical_term",
      ]),
      confidence: z.number().min(0).max(1),
    })
  ),
  relationships: z.array(
    z.object({
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
    })
  ),
});

const DraftResponseSchema = z.object({
  subject_line: z.string(),
  body: z.string(),
  tone: z.enum(["professional", "friendly", "empathetic", "technical"]),
  suggested_actions: z.array(z.string()),
  escalation_needed: z.boolean(),
});

type IntentClassification = z.infer<typeof IntentClassificationSchema>;
type EntityExtraction = z.infer<typeof EntityExtractionSchema>;
type DraftResponse = z.infer<typeof DraftResponseSchema>;

// ══════════════════════════════════════════════════════════════════════
// FUNCTIONS — all using the LM Studio model
// ══════════════════════════════════════════════════════════════════════

const ClassifyIntent: LScriptFunction<string, typeof IntentClassificationSchema> = {
  name: "ClassifyIntent",
  model: LM_STUDIO_MODEL,
  system:
    "You are an intent classification engine for a customer support system. " +
    "Classify the user's message into the correct intent category with high accuracy. " +
    "Assess priority based on urgency indicators in the text.",
  prompt: (text: string) =>
    `Classify the intent of this customer message:\n\n"${text}"`,
  schema: IntentClassificationSchema,
  temperature: 0.2,
  maxRetries: 2,
};

const ExtractEntities: LScriptFunction<string, typeof EntityExtractionSchema> = {
  name: "ExtractEntities",
  model: LM_STUDIO_MODEL,
  system:
    "You are a named entity recognition and relationship extraction engine. " +
    "Extract all notable entities and their relationships from the text. " +
    "Be thorough but precise — only extract entities you're confident about.",
  prompt: (text: string) =>
    `Extract entities and relationships from:\n\n"${text}"`,
  schema: EntityExtractionSchema,
  temperature: 0.2,
  maxRetries: 2,
};

const GenerateDraft: LScriptFunction<string, typeof DraftResponseSchema> = {
  name: "GenerateDraft",
  model: LM_STUDIO_MODEL,
  system:
    "You are a customer support response drafting assistant. Generate professional, " +
    "empathetic responses that address the customer's concerns. Include specific " +
    "action items and flag if escalation is needed.",
  prompt: (text: string) =>
    `Draft a support response for this customer message:\n\n"${text}"`,
  schema: DraftResponseSchema,
  temperature: 0.7,
  maxRetries: 2,
};

// ══════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE SETUP
// ══════════════════════════════════════════════════════════════════════

function buildProductionStack() {
  // ── 1. Custom Log Transport ─────────────────────────────────────

  const logBuffer: LogEntry[] = [];

  const bufferTransport: LogTransport = {
    write(entry: LogEntry): void {
      logBuffer.push(entry);
    },
  };

  const logger = new Logger({
    level: LogLevel.DEBUG,
    transports: [new ConsoleTransport(), bufferTransport],
  });

  // ── 2. Providers ────────────────────────────────────────────────

  const lmstudio = new LMStudioProvider({
    baseUrl: LM_STUDIO_BASE_URL,
  });

  const fallbackProvider = new FallbackProvider([lmstudio], {
    retryDelay: 1000,
  });

  // ── 3. Model Router ────────────────────────────────────────────

  const router = new ModelRouter({
    rules: [
      {
        match: /extract|classify/i,
        provider: lmstudio,
        modelOverride: LM_STUDIO_MODEL,
      },
      {
        match: /review|analyze/i,
        provider: lmstudio,
        modelOverride: LM_STUDIO_MODEL,
      },
      {
        match: /draft|generate/i,
        provider: fallbackProvider,
        modelOverride: LM_STUDIO_MODEL,
      },
    ],
    defaultProvider: fallbackProvider,
  });

  // ── 4. Cache ────────────────────────────────────────────────────

  const cacheBackend = new MemoryCacheBackend();
  const cache = new ExecutionCache(cacheBackend);

  // ── 5. Cost Tracker & Budget ────────────────────────────────────

  const costTracker = new CostTracker();

  const budget: BudgetConfig = {
    maxTotalTokens: 100_000,
    maxTokensPerExecution: 10_000,
  };

  // ── 6. Middleware ───────────────────────────────────────────────

  const middleware = new MiddlewareManager();

  const timingLog: Array<{ fn: string; duration: number; tokens: number }> = [];
  let errorCount = 0;

  const loggingHooks: MiddlewareHooks = {
    onBeforeExecute: (ctx: ExecutionContext) => {
      const inputPreview = typeof ctx.input === "string"
        ? ctx.input.slice(0, 50)
        : JSON.stringify(ctx.input).slice(0, 50);
      console.log(`  🔄 [middleware] Starting: ${ctx.fn.name} | Input: "${inputPreview}..."`);
    },
    onComplete: (ctx: ExecutionContext, result: ExecutionResult<unknown>) => {
      const duration = Date.now() - ctx.startTime;
      const tokens = result.usage?.totalTokens ?? 0;
      timingLog.push({ fn: ctx.fn.name, duration, tokens });
      console.log(
        `  ✅ [middleware] Complete: ${ctx.fn.name} | ` +
        `${duration}ms | ${tokens} tokens | ${result.attempts} attempt(s)`
      );
    },
    onRetry: (ctx: ExecutionContext, error: Error) => {
      console.log(
        `  🔁 [middleware] Retry: ${ctx.fn.name} attempt ${ctx.attempt} | ` +
        `Error: ${error.message.slice(0, 80)}`
      );
    },
    onError: (_ctx: ExecutionContext, error: Error) => {
      errorCount++;
      console.error(`  ❌ [middleware] Error #${errorCount}: ${error.message.slice(0, 100)}`);
    },
  };

  middleware.use(loggingHooks);

  // ── 7. Create Runtime ───────────────────────────────────────────

  const runtime = new LScriptRuntime({
    provider: router,
    verbose: true,
    middleware,
    cache,
    costTracker,
    budget,
    logger,
  });

  return {
    runtime,
    router,
    costTracker,
    cache,
    cacheBackend,
    timingLog,
    logBuffer,
    getErrorCount: () => errorCount,
  };
}

// ══════════════════════════════════════════════════════════════════════
// EXECUTION
// ══════════════════════════════════════════════════════════════════════

async function main() {
  console.log("\n🏗️  Production Stack Demo (LM Studio)");
  console.log("═".repeat(60));
  console.log(`Provider: LM Studio @ ${LM_STUDIO_BASE_URL}`);
  console.log(`Model:    ${LM_STUDIO_MODEL}`);
  console.log("Full-featured setup with routing, caching, cost tracking,");
  console.log("middleware, logging, and structured error handling.\n");

  const {
    runtime,
    router,
    costTracker,
    timingLog,
    logBuffer,
    getErrorCount,
  } = buildProductionStack();

  // ── Test Input ──────────────────────────────────────────────────

  const testMessage =
    "Hi, I've been a loyal customer of TechCorp for 3 years now. " +
    "The latest update to your CloudSync Pro product completely broke the " +
    "file synchronization feature. I've lost access to my project files " +
    "since Tuesday and our team of 15 people at Innovate Labs cannot work. " +
    "This is costing us thousands of dollars per day. I need immediate " +
    "assistance from your engineering team — not a chatbot. Please escalate " +
    "this to a senior engineer. Contact me at john.doe@innovatelabs.com " +
    "or call +1-555-0123.";

  console.log("📨 Test Message:");
  console.log("─".repeat(60));
  wrapText(testMessage, 58).forEach((line: string) => console.log(`  ${line}`));
  console.log("─".repeat(60));

  // ── Execute All Three Functions ─────────────────────────────────

  console.log("\n\n🚀 Phase 1: Execute All Functions (First Run)");
  console.log("═".repeat(60));

  // Show routing info
  console.log("\n  📡 Routing decisions:");
  for (const fn of [ClassifyIntent, ExtractEntities, GenerateDraft]) {
    const resolved = router.resolveProvider(fn);
    console.log(
      `    ${fn.name} → ${resolved.provider.name}` +
      (resolved.modelOverride ? ` (model: ${resolved.modelOverride})` : "")
    );
  }
  console.log();

  // 1. Classify Intent
  console.log("  ── ClassifyIntent ──");
  const classifyResult = await runtime.execute(ClassifyIntent, testMessage);
  printIntent(classifyResult.data);

  // 2. Extract Entities
  console.log("\n  ── ExtractEntities ──");
  const entityResult = await runtime.execute(ExtractEntities, testMessage);
  printEntities(entityResult.data);

  // 3. Generate Draft
  console.log("\n  ── GenerateDraft ──");
  const draftResult = await runtime.executeWithTransform(
    GenerateDraft,
    testMessage,
    trimStringsTransformer as (data: DraftResponse) => DraftResponse
  );
  printDraft(draftResult.data as DraftResponse);

  // ── Cache Demo ──────────────────────────────────────────────────

  console.log("\n\n🗄️  Phase 2: Cache Demonstration (Second Run)");
  console.log("═".repeat(60));
  console.log("  Running the same functions again — should hit cache...\n");

  const cacheStart = Date.now();
  const cachedClassify = await runtime.execute(ClassifyIntent, testMessage);
  const cachedEntity = await runtime.execute(ExtractEntities, testMessage);
  const cachedDraft = await runtime.execute(GenerateDraft, testMessage);
  const cacheDuration = Date.now() - cacheStart;

  console.log(`  ⚡ Cache results (${cacheDuration}ms total):`);
  console.log(`    ClassifyIntent: attempts=${cachedClassify.attempts} (0 = from cache)`);
  console.log(`    ExtractEntities: attempts=${cachedEntity.attempts} (0 = from cache)`);
  console.log(`    GenerateDraft: attempts=${cachedDraft.attempts} (0 = from cache)`);

  // ── Pipeline Demo ───────────────────────────────────────────────

  console.log("\n\n🔗 Phase 3: Pipeline Demonstration");
  console.log("═".repeat(60));
  console.log("  Chaining ClassifyIntent → GenerateDraft via Pipeline\n");

  const ClassifyForPipeline: LScriptFunction<string, typeof IntentClassificationSchema> = {
    ...ClassifyIntent,
    name: "ClassifyForPipeline",
  };

  const DraftFromClassification: LScriptFunction<IntentClassification, typeof DraftResponseSchema> = {
    name: "DraftFromClassification",
    model: LM_STUDIO_MODEL,
    system: GenerateDraft.system,
    schema: GenerateDraft.schema,
    temperature: GenerateDraft.temperature,
    maxRetries: GenerateDraft.maxRetries,
    prompt: (classification: IntentClassification) =>
      `Based on the following intent classification, draft an appropriate customer support response:\n\n` +
      `Intent: ${classification.intent}\n` +
      `Priority: ${classification.priority}\n` +
      `Category: ${classification.sub_category}\n` +
      `Department: ${classification.suggested_department}\n\n` +
      `Draft a response that acknowledges the customer's ${classification.intent} and addresses it with ${classification.priority} priority.`,
  };

  const pipeline = Pipeline.from(ClassifyForPipeline).pipe(DraftFromClassification);

  const pipelineResult = await pipeline.execute(runtime, testMessage);

  console.log("  📋 Pipeline Results:");
  console.log(`    Steps: ${pipelineResult.steps.length}`);
  pipelineResult.steps.forEach((step, i: number) => {
    console.log(
      `    ${i + 1}. ${step.name}: ${step.attempts} attempt(s), ` +
      `${step.usage?.totalTokens ?? 0} tokens`
    );
  });
  console.log(`    Total tokens: ${pipelineResult.totalUsage.totalTokens}`);
  console.log(`    Final draft subject: ${(pipelineResult.finalData as DraftResponse).subject_line}`);

  // ── Cost & Middleware Summary ───────────────────────────────────

  console.log("\n\n📊 Phase 4: Operational Summary");
  console.log("═".repeat(60));

  const totalTokens = costTracker.getTotalTokens();
  const usageByFn = costTracker.getUsageByFunction();
  const budgetPct = Math.round((totalTokens / 100_000) * 100);

  console.log("\n  💰 Cost Tracking:");
  console.log(`    Total tokens consumed: ${totalTokens}`);
  console.log(`    Budget used: ${budgetPct}% (${totalTokens}/100,000)`);
  if (budgetPct >= 80) {
    console.log(`    ⚠️  ALERT: Budget usage at ${budgetPct}%!`);
  }

  console.log("\n    Per-function breakdown:");
  console.log("    " + "─".repeat(50));
  console.log(
    "    Function".padEnd(30) +
    "Calls".padStart(6) +
    "Tokens".padStart(10)
  );
  console.log("    " + "─".repeat(50));
  for (const [fnName, usage] of usageByFn) {
    console.log(
      `    ${fnName.padEnd(28)}${usage.calls.toString().padStart(6)}${usage.totalTokens.toString().padStart(10)}`
    );
  }
  console.log("    " + "─".repeat(50));

  // Middleware timing summary
  console.log("\n  ⏱️  Middleware Timing Log:");
  console.log("    " + "─".repeat(50));
  timingLog.forEach((entry: { fn: string; duration: number; tokens: number }) => {
    console.log(
      `    ${entry.fn.padEnd(25)} ${entry.duration.toString().padStart(5)}ms  ${entry.tokens.toString().padStart(6)} tokens`
    );
  });
  console.log("    " + "─".repeat(50));
  const totalTime = timingLog.reduce((s: number, e: { fn: string; duration: number; tokens: number }) => s + e.duration, 0);
  console.log(`    Total execution time: ${totalTime}ms`);

  // Error count
  console.log(`\n  ❌ Errors encountered: ${getErrorCount()}`);

  // Logger buffer summary
  console.log(`\n  📝 Log entries captured: ${logBuffer.length}`);
  const levelCounts: Record<string, number> = {};
  logBuffer.forEach((entry: LogEntry) => {
    const label = LogLevel[entry.level] ?? "UNKNOWN";
    levelCounts[label] = (levelCounts[label] ?? 0) + 1;
  });
  for (const [level, count] of Object.entries(levelCounts)) {
    console.log(`    ${level}: ${count}`);
  }

  console.log("\n✅ Production stack demo complete!");
  console.log("   This example showcased: Router, Fallback, Cache, CostTracker,");
  console.log("   Middleware, Logger, Pipeline, and Output Transformers.");
}

// ── Display Helpers ──────────────────────────────────────────────────

function printIntent(data: IntentClassification): void {
  const priorityIcon =
    data.priority === "critical" ? "🔴" :
    data.priority === "high" ? "🟠" :
    data.priority === "medium" ? "🟡" : "🟢";

  console.log(`    🏷️  Intent:     ${data.intent}`);
  console.log(`    📊 Confidence: ${(data.confidence * 100).toFixed(1)}%`);
  console.log(`    📂 Category:   ${data.sub_category}`);
  console.log(`    ${priorityIcon} Priority:   ${data.priority}`);
  console.log(`    🏢 Department: ${data.suggested_department}`);
}

function printEntities(data: EntityExtraction): void {
  console.log(`    📋 Entities found: ${data.entities.length}`);
  data.entities.forEach((e) => {
    console.log(`       • "${e.text}" [${e.type}] (${(e.confidence * 100).toFixed(0)}%)`);
  });
  if (data.relationships.length > 0) {
    console.log(`    🔗 Relationships:`);
    data.relationships.forEach((r) => {
      console.log(`       • ${r.subject} —[${r.predicate}]→ ${r.object}`);
    });
  }
}

function printDraft(data: DraftResponse): void {
  console.log(`    📧 Subject: ${data.subject_line}`);
  console.log(`    🎭 Tone:    ${data.tone}`);
  console.log(`    📝 Body:`);
  wrapText(data.body, 55).forEach((line: string) => console.log(`       ${line}`));
  console.log(`    📋 Actions:`);
  data.suggested_actions.forEach((a: string) => console.log(`       • ${a}`));
  console.log(`    🚨 Escalation: ${data.escalation_needed ? "YES" : "No"}`);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 > width) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

main();
