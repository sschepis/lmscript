/**
 * Example: Multi-Agent Code Critique Pipeline
 *
 * Demonstrates a 3-agent pipeline:
 *   CodeGenerator → SecurityReviewer → CodeRefiner
 *
 * Features:
 *   - 3 separate LScriptFunction definitions with distinct schemas
 *   - Pipeline.from().pipe().pipe() chaining
 *   - Different temperatures per agent (creative vs analytical)
 *   - Typed data flowing between agents via JSON serialization
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/multi-agent-critique.ts
 *   npx tsx src/examples/multi-agent-critique.ts "Build a rate limiter middleware for Express"
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider, Pipeline } from "../index.js";
import type { LScriptFunction } from "../index.js";

// ── 1. Define schemas for each pipeline stage ───────────────────────

// Generator output
const GeneratedCodeSchema = z.object({
  language: z.string(),
  code: z.string(),
  explanation: z.string(),
});

type GeneratedCode = z.infer<typeof GeneratedCodeSchema>;

// Reviewer output (receives stringified GeneratedCode)
const SecurityReviewSchema = z.object({
  score: z.number().min(1).max(10),
  vulnerabilities: z.array(
    z.object({
      severity: z.enum(["critical", "high", "medium", "low"]),
      description: z.string(),
      line_hint: z.string(),
    })
  ),
  recommendation: z.string(),
});

type SecurityReview = z.infer<typeof SecurityReviewSchema>;

// Refiner output (receives stringified SecurityReview)
const RefinedCodeSchema = z.object({
  original_score: z.number(),
  refined_code: z.string(),
  changes_made: z.array(z.string()),
  estimated_new_score: z.number().min(1).max(10),
});

type RefinedCode = z.infer<typeof RefinedCodeSchema>;

// ── 2. Define the three agents ──────────────────────────────────────

const CodeGenerator: LScriptFunction<string, typeof GeneratedCodeSchema> = {
  name: "CodeGenerator",
  model: "gpt-4o",
  temperature: 0.8,
  system:
    "You are a creative senior developer who writes clean, functional code. " +
    "When given a task description, produce a complete implementation. " +
    "Focus on readability and correctness. Use TypeScript unless otherwise specified.",
  prompt: (task: string) =>
    `Write a complete implementation for the following task:\n\n${task}`,
  schema: GeneratedCodeSchema,
  maxRetries: 2,
};

const SecurityReviewer: LScriptFunction<GeneratedCode, typeof SecurityReviewSchema> = {
  name: "SecurityReviewer",
  model: "gpt-4o",
  temperature: 0.2,
  system:
    "You are a pedantic security auditor with 15 years of experience in application security. " +
    "You review code for vulnerabilities including injection attacks, authentication flaws, " +
    "data exposure, insecure dependencies, and logic errors. " +
    "Score from 1 (critical vulnerabilities) to 10 (production-ready secure code). " +
    "Be thorough and skeptical — assume the worst-case scenario for every input.",
  prompt: (generated: GeneratedCode) =>
    `Review the following ${generated.language} code for security vulnerabilities:\n\n` +
    `\`\`\`${generated.language}\n${generated.code}\n\`\`\`\n\n` +
    `Author's explanation: ${generated.explanation}`,
  schema: SecurityReviewSchema,
  maxRetries: 2,
};

const CodeRefiner: LScriptFunction<SecurityReview, typeof RefinedCodeSchema> = {
  name: "CodeRefiner",
  model: "gpt-4o",
  temperature: 0.4,
  system:
    "You are a pragmatic tech lead who takes security review feedback and produces " +
    "refined, hardened code. You address every vulnerability identified while keeping " +
    "the code clean and maintainable. Provide the complete refined code, list every " +
    "change you made, and estimate the new security score after your fixes.",
  prompt: (review: SecurityReview) =>
    `The security review gave a score of ${review.score}/10.\n\n` +
    `Vulnerabilities found:\n${review.vulnerabilities
      .map(
        (v, i) =>
          `  ${i + 1}. [${v.severity.toUpperCase()}] ${v.description} (hint: ${v.line_hint})`
      )
      .join("\n")}\n\n` +
    `Reviewer recommendation: ${review.recommendation}\n\n` +
    `Please produce the refined, hardened code addressing all issues.`,
  schema: RefinedCodeSchema,
  maxRetries: 2,
};

// ── 3. Build and execute the pipeline ───────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("╔═══════════════════════════════════════════════════╗");
    console.error("║  OPENAI_API_KEY is required to run this demo     ║");
    console.error("║                                                   ║");
    console.error("║  export OPENAI_API_KEY=sk-...                     ║");
    console.error("║  npx tsx src/examples/multi-agent-critique.ts     ║");
    console.error("╚═══════════════════════════════════════════════════╝");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  const taskDescription =
    process.argv[2] ??
    "Build a user authentication function that accepts a username and password, " +
    "queries a PostgreSQL database, and returns a JWT token. Include input validation " +
    "and error handling.";

  console.log("\n🏗️  Multi-Agent Code Critique Pipeline");
  console.log("═".repeat(60));
  console.log(`\n📋 Task: "${taskDescription}"\n`);
  console.log("Pipeline: CodeGenerator → SecurityReviewer → CodeRefiner\n");

  // Build the pipeline
  const pipeline = Pipeline.from(CodeGenerator)
    .pipe(SecurityReviewer)
    .pipe(CodeRefiner);

  try {
    const result = await pipeline.execute(runtime, taskDescription);

    // ── Step 1: Generated Code ──
    const step1 = result.steps[0];
    const generatedCode = step1.data as GeneratedCode;
    console.log("\n" + "═".repeat(60));
    console.log("🤖 STEP 1: Code Generator (temperature: 0.8)");
    console.log("─".repeat(60));
    console.log(`  Language: ${generatedCode.language}`);
    console.log(`  Attempts: ${step1.attempts}`);
    console.log(`  Tokens:   ${step1.usage?.totalTokens ?? "N/A"}`);
    console.log(`\n  📝 Explanation:\n  ${generatedCode.explanation}`);
    console.log(`\n  💻 Code:\n${"─".repeat(40)}`);
    console.log(indent(generatedCode.code, 4));
    console.log("─".repeat(40));

    // ── Step 2: Security Review ──
    const step2 = result.steps[1];
    const review = step2.data as SecurityReview;
    console.log("\n" + "═".repeat(60));
    console.log("🔒 STEP 2: Security Reviewer (temperature: 0.2)");
    console.log("─".repeat(60));
    console.log(`  Score:    ${review.score}/10 ${scoreBar(review.score)}`);
    console.log(`  Attempts: ${step2.attempts}`);
    console.log(`  Tokens:   ${step2.usage?.totalTokens ?? "N/A"}`);
    console.log(`\n  🐛 Vulnerabilities (${review.vulnerabilities.length}):`);
    review.vulnerabilities.forEach((v, i) => {
      const icon =
        v.severity === "critical" ? "🔴" :
        v.severity === "high" ? "🟠" :
        v.severity === "medium" ? "🟡" : "🟢";
      console.log(`    ${i + 1}. ${icon} [${v.severity.toUpperCase()}] ${v.description}`);
      console.log(`       📍 Hint: ${v.line_hint}`);
    });
    console.log(`\n  💡 Recommendation:\n  ${review.recommendation}`);

    // ── Step 3: Refined Code ──
    const step3 = result.steps[2];
    const refined = step3.data as RefinedCode;
    console.log("\n" + "═".repeat(60));
    console.log("✨ STEP 3: Code Refiner (temperature: 0.4)");
    console.log("─".repeat(60));
    console.log(`  Original Score:  ${refined.original_score}/10`);
    console.log(`  Estimated New:   ${refined.estimated_new_score}/10 ${scoreBar(refined.estimated_new_score)}`);
    console.log(`  Attempts: ${step3.attempts}`);
    console.log(`  Tokens:   ${step3.usage?.totalTokens ?? "N/A"}`);
    console.log(`\n  🔧 Changes Made (${refined.changes_made.length}):`);
    refined.changes_made.forEach((c, i) => {
      console.log(`    ${i + 1}. ✅ ${c}`);
    });
    console.log(`\n  💻 Refined Code:\n${"─".repeat(40)}`);
    console.log(indent(refined.refined_code, 4));
    console.log("─".repeat(40));

    // ── Summary ──
    console.log("\n" + "═".repeat(60));
    console.log("📊 Pipeline Summary");
    console.log("─".repeat(60));
    console.log(`  Total steps:     ${result.steps.length}`);
    console.log(`  Total tokens:    ${result.totalUsage.totalTokens}`);
    console.log(`  Prompt tokens:   ${result.totalUsage.promptTokens}`);
    console.log(`  Output tokens:   ${result.totalUsage.completionTokens}`);
    console.log(`  Score change:    ${refined.original_score}/10 → ${refined.estimated_new_score}/10`);

    const improvement = refined.estimated_new_score - refined.original_score;
    if (improvement > 0) {
      console.log(`  Improvement:     +${improvement} points 📈`);
    } else if (improvement === 0) {
      console.log(`  Improvement:     No change ➡️`);
    } else {
      console.log(`  Improvement:     ${improvement} points 📉`);
    }
    console.log("═".repeat(60));

  } catch (err) {
    console.error("\n❌ Pipeline execution failed:", err);
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function scoreBar(score: number): string {
  const filled = Math.round(score);
  const empty = 10 - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

main();
