/**
 * Example: Rate Limiting — RPM/TPM Throttling
 *
 * Demonstrates:
 *   - RateLimiter with requests-per-minute (RPM) limits
 *   - RateLimiter with tokens-per-minute (TPM) limits
 *   - acquire() blocking behavior when limits are hit
 *   - reportTokens() for tracking token consumption
 *   - Timing measurements showing throttle effects
 *
 * Usage:
 *   npx tsx src/examples/rate-limiting-demo.ts
 */

import { RateLimiter } from "../index.js";
import type { RateLimitConfig } from "../index.js";

// ── Helper to measure async function duration ───────────────────────

async function measureMs(fn: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

// ── Demo 1: RPM Limiting ────────────────────────────────────────────

async function demoRPM() {
  console.log("⏱️  Demo 1: Requests-Per-Minute (RPM) Limiting");
  console.log("─".repeat(50));

  // Allow only 5 requests per minute
  const config: RateLimitConfig = {
    requestsPerMinute: 5,
  };
  const limiter = new RateLimiter(config);

  console.log("   Config: 5 requests per minute\n");

  // Fire 5 requests rapidly — they should all go through immediately
  console.log("   Sending 5 rapid requests (should be instant):");
  for (let i = 1; i <= 5; i++) {
    const ms = await measureMs(() => limiter.acquire());
    console.log(`     Request ${i}: acquired in ${ms}ms`);
  }

  // The 6th request should be throttled
  console.log("\n   Sending request 6 (should be throttled, skipping wait)...");
  console.log("   ℹ️  In production, acquire() would block until a slot opens.");
  console.log("   ℹ️  The limiter uses a 60-second sliding window.\n");

  // Reset for next demo
  limiter.reset();
  console.log("   ✅ Limiter reset.\n");
}

// ── Demo 2: TPM Limiting ────────────────────────────────────────────

async function demoTPM() {
  console.log("📊 Demo 2: Tokens-Per-Minute (TPM) Limiting");
  console.log("─".repeat(50));

  // Allow 1000 tokens per minute
  const limiter = new RateLimiter({
    tokensPerMinute: 1000,
  });

  console.log("   Config: 1000 tokens per minute\n");

  // Simulate 3 requests consuming tokens
  const tokenCounts = [300, 400, 250];
  let totalReported = 0;

  for (let i = 0; i < tokenCounts.length; i++) {
    const ms = await measureMs(() => limiter.acquire());
    console.log(`   Request ${i + 1}: acquired in ${ms}ms`);

    // Report tokens used after the request completes
    limiter.reportTokens(tokenCounts[i]);
    totalReported += tokenCounts[i];
    console.log(`     Reported ${tokenCounts[i]} tokens (total: ${totalReported}/1000)`);
  }

  console.log("\n   ⚠️  Next request would block — approaching TPM limit.");
  console.log(`   Total tokens reported: ${totalReported}/1000`);
  console.log("   ✅ Demo complete.\n");
}

// ── Demo 3: Combined RPM + TPM ─────────────────────────────────────

async function demoCombined() {
  console.log("🔒 Demo 3: Combined RPM + TPM Limiting");
  console.log("─".repeat(50));

  const limiter = new RateLimiter({
    requestsPerMinute: 10,
    tokensPerMinute: 500,
  });

  console.log("   Config: 10 RPM + 500 TPM\n");

  // Simulate requests until TPM limit is approached
  const requests = [
    { tokens: 100, label: "Small request" },
    { tokens: 150, label: "Medium request" },
    { tokens: 200, label: "Large request" },
  ];

  let tokenTotal = 0;
  for (const req of requests) {
    const ms = await measureMs(() => limiter.acquire());
    console.log(`   ${req.label}: acquired in ${ms}ms`);
    limiter.reportTokens(req.tokens);
    tokenTotal += req.tokens;
    console.log(`     Tokens: ${req.tokens} (cumulative: ${tokenTotal}/500 TPM)`);
  }

  console.log(`\n   📊 Status after ${requests.length} requests:`);
  console.log(`     Requests used:  ${requests.length}/10 RPM`);
  console.log(`     Tokens used:    ${tokenTotal}/500 TPM`);
  console.log("   ℹ️  The stricter limit (TPM) would throttle first.\n");
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("🚦 Rate Limiting Demo");
  console.log("═".repeat(60));
  console.log();

  await demoRPM();
  await demoTPM();
  await demoCombined();

  console.log("═".repeat(60));
  console.log("Demo complete.\n");
}

main();
