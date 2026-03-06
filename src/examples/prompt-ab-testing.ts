/**
 * Example: Prompt Registry — A/B Testing Prompt Variants
 *
 * Demonstrates:
 *   - PromptRegistry for managing prompt variants
 *   - Weighted variant selection (A/B testing)
 *   - Recording success/failure metrics
 *   - getBestVariant() for identifying winners
 *   - applyVariant() to create modified LScriptFunctions
 *
 * Usage:
 *   npx tsx src/examples/prompt-ab-testing.ts
 */

import { z } from "zod";
import { PromptRegistry } from "../index.js";
import type {
  PromptVariant,
  LScriptFunction,
  ExecutionResult,
} from "../index.js";

// ── 1. Define a base function for summarization ─────────────────────

const SummarySchema = z.object({
  summary: z.string(),
  word_count: z.number(),
});

const summarizer: LScriptFunction<string, typeof SummarySchema> = {
  name: "Summarizer",
  model: "gpt-4o",
  system: "You are a text summarizer. Produce concise summaries.",
  prompt: (text: string) => `Summarize this text:\n\n${text}`,
  schema: SummarySchema,
  temperature: 0.5,
};

// ── 2. Define prompt variants ───────────────────────────────────────

const variants: PromptVariant<string>[] = [
  {
    name: "control",
    system: "You are a text summarizer. Produce concise summaries.",
    weight: 1,
  },
  {
    name: "detailed",
    system: "You are an expert summarizer. Produce thorough, detailed summaries " +
      "capturing all key points while remaining concise.",
    temperature: 0.3,
    weight: 2, // Higher weight → selected more often
  },
  {
    name: "brief",
    system: "You are a text summarizer. Produce extremely brief, tweet-length summaries.",
    prompt: (text: string) => `Summarize in under 50 words:\n\n${text}`,
    temperature: 0.7,
    weight: 1,
  },
];

// ── 3. Run A/B test simulation ──────────────────────────────────────

async function main() {
  console.log("🧪 Prompt A/B Testing Demo");
  console.log("═".repeat(60));

  // Create a weighted registry
  const registry = new PromptRegistry({ strategy: "weighted" });
  registry.registerVariants("Summarizer", variants);

  // ── Step 1: Show selection distribution ──
  console.log("\n📊 Selection distribution (1000 samples, weighted strategy):");
  const counts: Record<string, number> = { control: 0, detailed: 0, brief: 0 };

  for (let i = 0; i < 1000; i++) {
    const selected = registry.selectVariant("Summarizer");
    if (selected) {
      counts[selected.name]++;
    }
  }

  for (const [name, count] of Object.entries(counts)) {
    const bar = "█".repeat(Math.round(count / 20));
    const pct = ((count / 1000) * 100).toFixed(1);
    console.log(`   ${name.padEnd(10)} ${bar} ${pct}% (${count})`);
  }

  // ── Step 2: Simulate execution results ──
  console.log("\n📈 Simulating 50 executions per variant...");

  // Simulate results for each variant with different success rates
  const simulatedResults: Record<string, { successRate: number; avgTokens: number }> = {
    control: { successRate: 0.85, avgTokens: 200 },
    detailed: { successRate: 0.92, avgTokens: 350 },
    brief: { successRate: 0.78, avgTokens: 120 },
  };

  registry.resetMetrics();

  for (const variant of variants) {
    const sim = simulatedResults[variant.name];
    for (let i = 0; i < 50; i++) {
      if (Math.random() < sim.successRate) {
        // Simulate a successful execution result
        const mockResult: ExecutionResult<unknown> = {
          data: { summary: "...", word_count: 42 },
          attempts: Math.random() < 0.8 ? 1 : 2,
          usage: {
            promptTokens: Math.round(sim.avgTokens * 0.6),
            completionTokens: Math.round(sim.avgTokens * 0.4),
            totalTokens: sim.avgTokens + Math.round(Math.random() * 50 - 25),
          },
        };
        registry.recordResult("Summarizer", variant.name, mockResult);
      } else {
        registry.recordFailure("Summarizer", variant.name);
      }
    }
  }

  // ── Step 3: Display metrics ──
  console.log("\n📋 Variant Metrics:");
  console.log("─".repeat(60));
  console.log(
    "  Variant    │ Execs │ Success │ Rate   │ Avg Tokens │ Avg Attempts"
  );
  console.log(
    "─────────────┼───────┼─────────┼────────┼────────────┼─────────────"
  );

  const metrics = registry.getMetrics("Summarizer");
  for (const m of metrics) {
    console.log(
      `  ${m.name.padEnd(11)}│ ${String(m.executions).padStart(5)} │ ${String(m.successes).padStart(7)} │ ${(m.successRate * 100).toFixed(1).padStart(5)}% │ ${m.avgTokens.toFixed(0).padStart(10)} │ ${m.avgAttempts.toFixed(2).padStart(12)}`
    );
  }

  // ── Step 4: Identify the best variant ──
  const best = registry.getBestVariant("Summarizer");
  if (best) {
    console.log(`\n🏆 Best variant: "${best.name}"`);
    console.log(`   Success rate: ${(best.successRate * 100).toFixed(1)}%`);
    console.log(`   Avg tokens:   ${best.avgTokens.toFixed(0)}`);
    console.log(`   Total tokens: ${best.totalTokens}`);
  }

  // ── Step 5: Show how to apply a variant ──
  console.log("\n🔧 Applying the 'detailed' variant to the base function:");
  const detailedVariant = variants.find((v) => v.name === "detailed")!;
  const modifiedFn = registry.applyVariant(summarizer, detailedVariant);
  console.log(`   Original name:  ${summarizer.name}`);
  console.log(`   Modified name:  ${modifiedFn.name}`);
  console.log(`   Original temp:  ${summarizer.temperature}`);
  console.log(`   Modified temp:  ${modifiedFn.temperature}`);

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
}

main();
