/**
 * Example: Sentiment Analysis with Few-Shot Learning
 *
 * Demonstrates:
 *   - LScriptFunction with Zod schema
 *   - Few-shot examples for in-context learning
 *   - executeBatch() for parallel analysis of multiple inputs
 *   - executeWithTransform() with trimStringsTransformer
 *   - Typed, validated output
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/sentiment-analysis.ts
 *   npx tsx src/examples/sentiment-analysis.ts "Your custom feedback text here"
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider, trimStringsTransformer } from "../index.js";
import type { LScriptFunction } from "../index.js";

// ── 1. Define the output schema ─────────────────────────────────────

const SentimentSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  key_phrases: z.array(z.string()),
  tone: z.enum(["formal", "casual", "urgent", "sarcastic", "enthusiastic"]),
});

type SentimentResult = z.infer<typeof SentimentSchema>;

// ── 2. Define the L-Script function with few-shot examples ──────────

const SentimentAnalyzer: LScriptFunction<string, typeof SentimentSchema> = {
  name: "SentimentAnalyzer",
  model: "gpt-4o",
  system:
    "You are an expert sentiment analysis engine. Analyze the given customer feedback " +
    "and classify its sentiment, confidence, tone, key phrases, and provide a brief summary. " +
    "Be precise with confidence scores — only use values above 0.9 when the sentiment is unambiguous.",
  prompt: (feedback: string) =>
    `Analyze the sentiment of the following customer feedback:\n\n"${feedback}"`,
  schema: SentimentSchema,
  temperature: 0.3,
  maxRetries: 2,

  // Few-shot examples for better accuracy
  examples: [
    {
      input: "This product is absolutely amazing! The interface is intuitive and the performance blew me away.",
      output: {
        sentiment: "positive",
        confidence: 0.95,
        summary: "Customer is highly satisfied with the product's interface and performance.",
        key_phrases: ["absolutely amazing", "intuitive interface", "performance blew me away"],
        tone: "enthusiastic",
      },
    },
    {
      input: "The app crashes constantly and support never responds. I want a refund immediately.",
      output: {
        sentiment: "negative",
        confidence: 0.97,
        summary: "Customer is frustrated by app instability and unresponsive support, demanding a refund.",
        key_phrases: ["crashes constantly", "support never responds", "want a refund"],
        tone: "urgent",
      },
    },
    {
      input: "The product works as described. It would be nice to have dark mode in a future update.",
      output: {
        sentiment: "neutral",
        confidence: 0.82,
        summary: "Customer acknowledges the product works but suggests a dark mode feature.",
        key_phrases: ["works as described", "dark mode", "future update"],
        tone: "casual",
      },
    },
  ],
};

// ── 3. Sample inputs ────────────────────────────────────────────────

const sampleFeedbacks: string[] = [
  "I've been using your design tool for three months and the UX is phenomenal. " +
    "Drag-and-drop works flawlessly and the export options save me hours every week. " +
    "Best purchase I've made this year!",

  "The latest update completely broke the search functionality. Pages take 15+ seconds to load " +
    "and the memory usage has doubled. This is unacceptable for a paid product — " +
    "please roll back or fix this ASAP.",

  "Could you add support for CSV imports? Currently I have to convert everything to JSON first, " +
    "which adds an extra step to my workflow. The current JSON import works fine though.",
];

// ── 4. Execute ──────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("╔════════════════════════════════════════════════╗");
    console.error("║  OPENAI_API_KEY is required to run this demo  ║");
    console.error("║                                                ║");
    console.error("║  export OPENAI_API_KEY=sk-...                  ║");
    console.error("║  npx tsx src/examples/sentiment-analysis.ts    ║");
    console.error("╚════════════════════════════════════════════════╝");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  // Check for CLI argument (single analysis mode)
  const cliInput = process.argv[2];
  if (cliInput) {
    console.log("\n🔍 Single Sentiment Analysis");
    console.log("─".repeat(50));
    console.log(`Input: "${cliInput}"\n`);

    // Demonstrate executeWithTransform with trimStringsTransformer
    const result = await runtime.executeWithTransform(
      SentimentAnalyzer,
      cliInput,
      trimStringsTransformer as (data: SentimentResult) => SentimentResult
    );

    printResult(result.data as SentimentResult, result.attempts);
    return;
  }

  // Batch mode: analyze all sample feedbacks
  console.log("\n📊 Batch Sentiment Analysis");
  console.log("═".repeat(60));
  console.log(`Analyzing ${sampleFeedbacks.length} customer feedback entries...\n`);

  try {
    const results = await runtime.executeBatch(SentimentAnalyzer, sampleFeedbacks);

    // Display individual results
    results.forEach((result, i) => {
      console.log(`\n📝 Feedback #${i + 1}`);
      console.log("─".repeat(50));
      console.log(`"${sampleFeedbacks[i].slice(0, 80)}..."\n`);
      printResult(result.data, result.attempts);
    });

    // Summary table
    console.log("\n\n📋 Summary Table");
    console.log("═".repeat(60));
    console.log(
      "  #  │ Sentiment  │ Confidence │ Tone         │ Attempts"
    );
    console.log("─────┼────────────┼────────────┼──────────────┼─────────");

    results.forEach((result, i) => {
      const d = result.data;
      const sentimentIcon =
        d.sentiment === "positive" ? "🟢" :
        d.sentiment === "negative" ? "🔴" : "🟡";
      console.log(
        `  ${i + 1}  │ ${sentimentIcon} ${d.sentiment.padEnd(8)} │ ${d.confidence.toFixed(2).padStart(10)} │ ${d.tone.padEnd(12)} │ ${result.attempts}`
      );
    });

    // Aggregate stats
    const totalTokens = results.reduce(
      (sum, r) => sum + (r.usage?.totalTokens ?? 0),
      0
    );
    console.log("─".repeat(60));
    console.log(`Total tokens used: ${totalTokens}`);
    console.log(`Average confidence: ${(results.reduce((s, r) => s + r.data.confidence, 0) / results.length).toFixed(2)}`);

  } catch (err) {
    console.error("\n❌ Batch execution failed:", err);
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function printResult(data: SentimentResult, attempts: number): void {
  const icon =
    data.sentiment === "positive" ? "🟢" :
    data.sentiment === "negative" ? "🔴" : "🟡";

  console.log(`  ${icon} Sentiment:  ${data.sentiment}`);
  console.log(`  📊 Confidence: ${(data.confidence * 100).toFixed(1)}%`);
  console.log(`  🎭 Tone:       ${data.tone}`);
  console.log(`  📝 Summary:    ${data.summary}`);
  console.log(`  🔑 Key phrases:`);
  data.key_phrases.forEach((p) => console.log(`     • ${p}`));
  console.log(`  🔄 Attempts:   ${attempts}`);
}

main();
