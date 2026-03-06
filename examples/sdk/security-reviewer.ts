/**
 * Example: Security Reviewer Agent
 *
 * Demonstrates how to define and execute an LScriptFunction that
 * reviews code for security vulnerabilities with typed output.
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/security-reviewer.ts
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "../index.js";
import type { LScriptFunction } from "../index.js";

// ── 1. Define the output schema ─────────────────────────────────────

const CritiqueSchema = z.object({
  score: z
    .number()
    .min(1)
    .max(10)
    .describe("Security score from 1 (critical) to 10 (secure)"),
  vulnerabilities: z
    .array(z.string())
    .describe("List of identified security vulnerabilities"),
  suggested_fix: z
    .string()
    .describe("A code-level suggestion to remediate the worst issue"),
});

type Critique = z.infer<typeof CritiqueSchema>;

// ── 2. Define the L-Script function ─────────────────────────────────

const SecurityReviewer: LScriptFunction<string, typeof CritiqueSchema> = {
  name: "SecurityReviewer",
  model: "gpt-4o",
  system:
    "You are a senior security researcher specializing in web application security. " +
    "Focus on SQL injection, XSS, CSRF, and authentication bypasses. " +
    "Be pedantic and skeptical.",
  prompt: (code: string) =>
    `Review the following function for security flaws:\n\n${code}`,
  schema: CritiqueSchema,
  temperature: 0.2,
  maxRetries: 2,
};

// ── 3. Execute ──────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY environment variable to run this example.");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  const sampleCode = `
function login(username, password) {
  const query = "SELECT * FROM users WHERE name = '" + username + "' AND pass = '" + password + "'";
  const user = db.execute(query);
  if (user) {
    req.session.user = user;
    return true;
  }
  return false;
}
  `.trim();

  try {
    const result = await runtime.execute(SecurityReviewer, sampleCode);

    console.log("\n═══ Security Audit Result ═══");
    console.log(`Score: ${result.data.score}/10`);
    console.log(`Attempts: ${result.attempts}`);
    console.log(`\nVulnerabilities:`);
    result.data.vulnerabilities.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
    console.log(`\nSuggested Fix:\n  ${result.data.suggested_fix}`);

    if (result.data.score < 5) {
      console.log("\n🚨 CRITICAL: This code should NOT be deployed.");
    }
  } catch (err) {
    console.error("Execution failed:", err);
    process.exit(1);
  }
}

main();
