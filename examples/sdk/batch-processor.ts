/**
 * Example: Batch Document Processor — Parallel Execution
 *
 * Demonstrates:
 *   - runtime.executeBatch() with concurrency limit
 *   - runtime.executeAll() with named tasks running different functions
 *   - Aggregated token usage reporting
 *   - Timing comparisons
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/batch-processor.ts
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "../index.js";
import type { LScriptFunction, ExecutionResult } from "../index.js";

// ── 1. Define the output schema ─────────────────────────────────────

const DocumentAnalysisSchema = z.object({
  title: z.string(),
  word_count: z.number(),
  reading_level: z.enum(["elementary", "middle_school", "high_school", "college", "graduate"]),
  key_topics: z.array(z.string()),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
  language: z.string(),
});

type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

// ── 2. Additional schemas for executeAll demo ───────────────────────

const SummarySchema = z.object({
  one_sentence: z.string(),
  three_bullet_points: z.array(z.string()),
  target_audience: z.string(),
});

const KeywordExtractionSchema = z.object({
  primary_keywords: z.array(z.string()),
  secondary_keywords: z.array(z.string()),
  named_entities: z.array(z.object({
    entity: z.string(),
    type: z.enum(["person", "organization", "location", "product", "date", "other"]),
  })),
});

const ToneAnalysisSchema = z.object({
  primary_tone: z.string(),
  formality: z.enum(["very_informal", "informal", "neutral", "formal", "very_formal"]),
  persuasiveness: z.number().min(0).max(1),
  emotional_valence: z.number().min(-1).max(1),
  writing_style: z.string(),
});

// ── 3. Define the L-Script functions ────────────────────────────────

const DocumentAnalyzer: LScriptFunction<string, typeof DocumentAnalysisSchema> = {
  name: "DocumentAnalyzer",
  model: "gpt-4o",
  system:
    "You are a document analysis engine. Analyze the given text and extract metadata. " +
    "Estimate the word count accurately. Determine reading level based on vocabulary " +
    "complexity and sentence structure.",
  prompt: (text: string) =>
    `Analyze the following document:\n\n---\n${text}\n---`,
  schema: DocumentAnalysisSchema,
  temperature: 0.3,
  maxRetries: 2,
};

const Summarizer: LScriptFunction<string, typeof SummarySchema> = {
  name: "Summarizer",
  model: "gpt-4o",
  system:
    "You are a concise summarization engine. Create clear, accurate summaries " +
    "while preserving the key information and intent of the original text.",
  prompt: (text: string) =>
    `Summarize the following text:\n\n---\n${text}\n---`,
  schema: SummarySchema,
  temperature: 0.3,
  maxRetries: 2,
};

const KeywordExtractor: LScriptFunction<string, typeof KeywordExtractionSchema> = {
  name: "KeywordExtractor",
  model: "gpt-4o",
  system:
    "You are a keyword and entity extraction engine. Extract the most relevant " +
    "keywords and identify all named entities in the text. Primary keywords are " +
    "the main themes; secondary keywords are supporting concepts.",
  prompt: (text: string) =>
    `Extract keywords and named entities from:\n\n---\n${text}\n---`,
  schema: KeywordExtractionSchema,
  temperature: 0.2,
  maxRetries: 2,
};

const ToneAnalyzer: LScriptFunction<string, typeof ToneAnalysisSchema> = {
  name: "ToneAnalyzer",
  model: "gpt-4o",
  system:
    "You are a linguistic tone analyzer. Determine the tone, formality level, " +
    "persuasiveness score, emotional valence, and overall writing style of text.",
  prompt: (text: string) =>
    `Analyze the tone and style of:\n\n---\n${text}\n---`,
  schema: ToneAnalysisSchema,
  temperature: 0.3,
  maxRetries: 2,
};

// ── 4. Sample documents ─────────────────────────────────────────────

const sampleDocuments: string[] = [
  // Product description
  `Introducing the AeroMax Pro X1 — the next generation of wireless earbuds engineered for 
audiophiles who demand studio-quality sound on the go. Featuring our proprietary HiFi-Tune 
driver technology and adaptive noise cancellation, the X1 delivers crystal-clear audio 
across all frequencies. With 12 hours of battery life and IPX7 water resistance, these 
earbuds are your perfect companion for workouts, commutes, and everything in between.`,

  // News article
  `Global climate negotiations reached a breakthrough yesterday as 195 nations agreed to a 
landmark framework for reducing methane emissions by 40% before 2035. The agreement, forged 
during heated late-night sessions at the Geneva Climate Summit, includes binding commitments 
from the world's top 20 emitters and establishes a $50 billion green technology fund for 
developing nations. Environmental groups cautiously welcomed the deal while noting significant 
enforcement challenges remain.`,

  // Academic abstract
  `This paper presents a novel approach to protein folding prediction using graph neural 
networks enhanced with attention mechanisms. Our method, ProteoGNN, achieves state-of-the-art 
performance on the CASP15 benchmark, improving GDT-TS scores by 12.3% compared to existing 
approaches. We demonstrate that incorporating evolutionary coupling data as edge features 
significantly improves the model's ability to predict long-range interactions. The 
computational requirements are reduced by 3x compared to AlphaFold3 while maintaining 
comparable accuracy for proteins under 500 residues.`,

  // Customer review
  `I've been using this standing desk for three months and it's completely transformed my 
work-from-home setup. The electric motor is whisper-quiet, the memory presets save me time 
every day, and the bamboo surface looks gorgeous. My only complaint is the cable management 
tray could be deeper — my power strip barely fits. Customer support was incredibly helpful 
when I had questions about assembly. Would definitely recommend to anyone tired of sitting 
all day!`,

  // Legal notice
  `NOTICE OF DATA BREACH: Pursuant to Section 1798.82 of the California Civil Code, TechCorp 
Inc. hereby notifies affected individuals that an unauthorized third party gained access to 
certain customer records between March 15 and April 2, 2026. Compromised data may include 
names, email addresses, and hashed passwords. No financial information or Social Security 
numbers were affected. Affected individuals are advised to reset their passwords immediately 
and monitor their accounts for suspicious activity. A dedicated helpline has been established 
at 1-800-555-0199.`,

  // Recipe
  `Classic French Onion Soup: Thinly slice 6 large yellow onions. In a heavy Dutch oven, melt 
4 tablespoons butter over medium heat. Add onions with a pinch of salt and cook, stirring 
occasionally, for 45-60 minutes until deeply caramelized to a rich mahogany color. Deglaze 
with 1/2 cup dry white wine, then add 6 cups beef broth and 2 sprigs fresh thyme. Simmer 
20 minutes. Ladle into oven-safe bowls, top with thick slices of crusty bread, and pile on 
generous amounts of Gruyère cheese. Broil until bubbly and golden. Serves 4.`,
];

// ── 5. Execute ──────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("╔═══════════════════════════════════════════════════╗");
    console.error("║  OPENAI_API_KEY is required to run this demo     ║");
    console.error("║                                                   ║");
    console.error("║  export OPENAI_API_KEY=sk-...                     ║");
    console.error("║  npx tsx src/examples/batch-processor.ts          ║");
    console.error("╚═══════════════════════════════════════════════════╝");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  // ── Part 1: executeBatch with concurrency limit ─────────────────

  console.log("\n📦 Batch Document Processing Demo");
  console.log("═".repeat(60));
  console.log(`Processing ${sampleDocuments.length} documents with concurrency: 2\n`);

  const batchStart = Date.now();

  const batchResults: Array<ExecutionResult<DocumentAnalysis>> = await runtime.executeBatch(
    DocumentAnalyzer,
    sampleDocuments,
    { concurrency: 2 }
  );

  const batchDuration = Date.now() - batchStart;

  // Display results in a formatted table
  console.log("\n📊 Batch Analysis Results");
  console.log("─".repeat(90));
  console.log(
    "  #  │ Title".padEnd(35) +
    "│ Level".padEnd(16) +
    "│ Sentiment".padEnd(12) +
    "│ Words".padEnd(9) +
    "│ Language"
  );
  console.log("─────┼" + "─".repeat(32) + "┼" + "─".repeat(14) + "┼" + "─".repeat(10) + "┼" + "─".repeat(7) + "┼" + "─".repeat(10));

  batchResults.forEach((result: ExecutionResult<DocumentAnalysis>, i: number) => {
    const d = result.data;
    const sentimentIcon =
      d.sentiment === "positive" ? "🟢" :
      d.sentiment === "negative" ? "🔴" :
      d.sentiment === "mixed" ? "🟠" : "🟡";

    console.log(
      `  ${(i + 1).toString().padStart(1)}  │ ${truncate(d.title, 30).padEnd(31)}│ ${d.reading_level.padEnd(13)}│ ${sentimentIcon} ${d.sentiment.padEnd(7)}│ ${d.word_count.toString().padStart(5)} │ ${d.language}`
    );
  });

  console.log("─".repeat(90));

  // Per-document details
  console.log("\n📝 Document Details");
  console.log("─".repeat(60));

  batchResults.forEach((result: ExecutionResult<DocumentAnalysis>, i: number) => {
    const d = result.data;
    console.log(`\n  📄 Document ${i + 1}: ${d.title}`);
    console.log(`     Key Topics: ${d.key_topics.join(", ")}`);
    console.log(`     Tokens: ${result.usage?.totalTokens ?? "N/A"} | Attempts: ${result.attempts}`);
  });

  // Batch stats
  const batchTotalTokens = batchResults.reduce(
    (sum: number, r: ExecutionResult<DocumentAnalysis>) => sum + (r.usage?.totalTokens ?? 0),
    0
  );

  console.log(`\n\n⚡ Batch Stats`);
  console.log("─".repeat(40));
  console.log(`  📄 Documents processed: ${batchResults.length}`);
  console.log(`  ⏱️  Total time:         ${(batchDuration / 1000).toFixed(2)}s`);
  console.log(`  ⏱️  Avg per document:   ${(batchDuration / batchResults.length / 1000).toFixed(2)}s`);
  console.log(`  🪙 Total tokens:        ${batchTotalTokens}`);
  console.log(`  🪙 Avg tokens/doc:      ${Math.round(batchTotalTokens / batchResults.length)}`);

  // ── Part 2: executeAll with different analysis functions ─────────

  console.log("\n\n🔀 Multi-Analysis Demo (executeAll)");
  console.log("═".repeat(60));

  // Pick one document to run through multiple analyses
  const targetDoc = sampleDocuments[1]; // The news article
  console.log(`Analyzing one document with 3 different analysis functions...`);
  console.log(`Document: "${truncate(targetDoc, 60)}"\n`);

  const allStart = Date.now();

  const allResult = await runtime.executeAll([
    { name: "Summary", fn: Summarizer, input: targetDoc },
    { name: "Keywords", fn: KeywordExtractor, input: targetDoc },
    { name: "Tone", fn: ToneAnalyzer, input: targetDoc },
  ]);

  const allDuration = Date.now() - allStart;

  // Display executeAll results
  console.log("\n📋 Multi-Analysis Results");
  console.log("─".repeat(60));

  for (const task of allResult.tasks) {
    if (task.status === "fulfilled" && task.result) {
      console.log(`\n  ✅ ${task.name}:`);
      const data = task.result.data as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          if (value.length > 0 && typeof value[0] === "object") {
            console.log(`     ${key}:`);
            value.forEach((item: unknown) => {
              const obj = item as Record<string, string>;
              console.log(`       • ${obj.entity ?? obj.name ?? JSON.stringify(obj)} (${obj.type ?? ""})`);
            });
          } else {
            console.log(`     ${key}: ${(value as string[]).join(", ")}`);
          }
        } else {
          console.log(`     ${key}: ${value}`);
        }
      }
      console.log(`     [tokens: ${task.result.usage?.totalTokens ?? "N/A"}, attempts: ${task.result.attempts}]`);
    } else if (task.status === "rejected") {
      console.log(`\n  ❌ ${task.name}: ${task.error?.message}`);
    }
  }

  // Aggregated stats
  console.log("\n\n📊 Aggregated Statistics");
  console.log("═".repeat(60));
  console.log(`  ✅ Successful:  ${allResult.successCount}/${allResult.tasks.length}`);
  console.log(`  ❌ Failed:      ${allResult.failureCount}/${allResult.tasks.length}`);
  console.log(`  ⏱️  Total time:  ${(allDuration / 1000).toFixed(2)}s`);
  console.log(`  🪙 Total tokens: ${allResult.totalUsage.totalTokens}`);
  console.log(`     • Prompt:     ${allResult.totalUsage.promptTokens}`);
  console.log(`     • Completion: ${allResult.totalUsage.completionTokens}`);

  // Grand total
  const grandTotalTokens = batchTotalTokens + allResult.totalUsage.totalTokens;
  const grandTotalTime = batchDuration + allDuration;

  console.log("\n\n🏆 Grand Total");
  console.log("─".repeat(40));
  console.log(`  🪙 All tokens:  ${grandTotalTokens}`);
  console.log(`  ⏱️  All time:    ${(grandTotalTime / 1000).toFixed(2)}s`);
  console.log(`  📄 Operations:  ${batchResults.length + allResult.tasks.length}`);

  console.log("\n✅ Batch processing demo complete!");
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

main();
