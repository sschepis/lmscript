/**
 * Example: Batch Manager — Async Job Processing
 *
 * Demonstrates:
 *   - BatchManager for managed batch processing of LLM requests
 *   - Configurable concurrency and delay between requests
 *   - Progress callbacks for real-time monitoring
 *   - Job submission, tracking, and waitForCompletion()
 *   - Job listing, cancellation, and cleanup
 *
 * Usage:
 *   npx tsx src/examples/batch-manager-demo.ts
 */

import { z } from "zod";
import { LScriptRuntime, BatchManager } from "../index.js";
import type {
  LScriptFunction,
  BatchManagerConfig,
  BatchRequest,
  BatchJob,
} from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── 1. Define the function for batch processing ─────────────────────

const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  word_count: z.number(),
});

const summarizer: LScriptFunction<{ text: string; id: string }, typeof SummarySchema> = {
  name: "BatchSummarizer",
  model: "mock-model",
  system: "You are a text summarizer. Produce a concise title and summary.",
  prompt: (input) => `Summarize this text (ID: ${input.id}):\n\n${input.text}`,
  schema: SummarySchema,
  temperature: 0.3,
};

// ── 2. Prepare batch inputs ─────────────────────────────────────────

const articles = [
  { id: "article-1", text: "Machine learning is transforming healthcare with predictive diagnostics..." },
  { id: "article-2", text: "The latest advances in quantum computing show promise for cryptography..." },
  { id: "article-3", text: "Renewable energy adoption has increased by 40% globally since 2020..." },
  { id: "article-4", text: "New research in neuroscience reveals how sleep affects memory consolidation..." },
  { id: "article-5", text: "Autonomous vehicles are being tested in major cities across the world..." },
  { id: "article-6", text: "Space exploration milestones continue with Mars sample return missions..." },
];

// ── 3. Execute batch processing ─────────────────────────────────────

async function main() {
  console.log("📦 Batch Manager Demo");
  console.log("═".repeat(60));

  // Set up mock provider with latency to simulate real requests
  const mockProvider = new MockProvider({
    defaultResponse: JSON.stringify({
      title: "Article Summary",
      summary: "This article discusses important developments in its field.",
      word_count: 42,
    }),
    latency: 50, // 50ms simulated latency per request
  });

  const runtime = new LScriptRuntime({ provider: mockProvider });

  // ── Step 1: Create batch manager with progress tracking ──
  let progressUpdates = 0;

  const config: BatchManagerConfig = {
    concurrency: 2,              // Process 2 requests at a time
    delayBetweenRequests: 10,    // 10ms delay between requests
    continueOnError: true,       // Don't stop on individual failures
    onProgress: (job: BatchJob) => {
      progressUpdates++;
      const pct = Math.round((job.completedRequests / job.totalRequests) * 100);
      console.log(
        `   📊 Progress: ${job.completedRequests}/${job.totalRequests} (${pct}%) ` +
        `[${job.status}] failures=${job.failedRequests}`
      );
    },
  };

  const batchManager = new BatchManager(runtime, config);
  console.log("\n   ✅ BatchManager created (concurrency=2, delay=10ms)\n");

  // ── Step 2: Submit batch job ──
  console.log("📤 Submitting batch job...");

  const requests: BatchRequest<{ text: string; id: string }>[] = articles.map((a) => ({
    id: a.id,
    input: { text: a.text, id: a.id },
  }));

  const jobId = await batchManager.submit(summarizer, requests);
  console.log(`   Job ID: ${jobId}`);

  // ── Step 3: Check job status immediately ──
  const status = batchManager.getJob(jobId);
  console.log(`   Initial status: ${status?.status}`);
  console.log(`   Total requests: ${status?.totalRequests}\n`);

  // ── Step 4: Wait for completion ──
  console.log("⏳ Waiting for completion...\n");
  const completedJob = await batchManager.waitForCompletion(jobId);

  // ── Step 5: Display results ──
  console.log("\n" + "─".repeat(60));
  console.log("✅ Batch job completed!\n");

  console.log(`   Status:           ${completedJob.status}`);
  console.log(`   Total requests:   ${completedJob.totalRequests}`);
  console.log(`   Completed:        ${completedJob.completedRequests}`);
  console.log(`   Failed:           ${completedJob.failedRequests}`);
  console.log(`   Progress updates: ${progressUpdates}`);

  if (completedJob.completedAt) {
    const duration = completedJob.completedAt.getTime() - completedJob.createdAt.getTime();
    console.log(`   Duration:         ${duration}ms`);
  }

  console.log(`\n   Token usage:`);
  console.log(`     Prompt tokens:     ${completedJob.totalUsage.promptTokens}`);
  console.log(`     Completion tokens: ${completedJob.totalUsage.completionTokens}`);
  console.log(`     Total tokens:      ${completedJob.totalUsage.totalTokens}`);

  // Show individual results
  console.log("\n   📋 Individual results:");
  for (const result of completedJob.results) {
    const icon = result.status === "success" ? "✅" : "❌";
    if (result.status === "success" && result.data) {
      const data = result.data as z.infer<typeof SummarySchema>;
      console.log(`     ${icon} ${result.id}: "${data.title}" (${data.word_count} words)`);
    } else {
      console.log(`     ${icon} ${result.id}: ${result.error}`);
    }
  }

  // ── Step 6: Show job listing and cleanup ──
  console.log("\n📋 Job listing:");
  const allJobs = batchManager.listJobs();
  for (const job of allJobs) {
    console.log(`   [${job.id}] ${job.status} — ${job.completedRequests}/${job.totalRequests}`);
  }

  const cleaned = batchManager.cleanup();
  console.log(`\n🧹 Cleaned up ${cleaned} completed job(s).`);
  console.log(`   Remaining jobs: ${batchManager.listJobs().length}`);

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
}

main();
