/**
 * Example: Circuit Breaker + FallbackProvider
 *
 * Demonstrates:
 *   - CircuitBreaker standalone for manual state management
 *   - State transitions: closed → open → half-open → closed
 *   - FallbackProvider with circuit breaker integration
 *   - getProviderHealth() for monitoring provider status
 *   - Automatic failover between providers
 *
 * Usage:
 *   npx tsx src/examples/circuit-breaker-demo.ts
 */

import {
  CircuitBreaker,
  FallbackProvider,
} from "../index.js";
import type { CircuitBreakerConfig, CircuitState } from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── Helper: print circuit breaker state ─────────────────────────────

function printState(label: string, breaker: CircuitBreaker): void {
  const stateEmoji: Record<CircuitState, string> = {
    closed: "🟢",
    open: "🔴",
    "half-open": "🟡",
  };
  const state = breaker.getState();
  console.log(
    `   ${stateEmoji[state]} ${label}: state=${state}, failures=${breaker.getFailureCount()}`
  );
}

// ── Demo 1: Standalone Circuit Breaker ──────────────────────────────

async function demoStandalone() {
  console.log("🔌 Demo 1: Standalone Circuit Breaker");
  console.log("─".repeat(50));

  const config: CircuitBreakerConfig = {
    failureThreshold: 3,     // Open after 3 consecutive failures
    resetTimeout: 100,       // Short timeout for demo (100ms instead of 30s)
    successThreshold: 2,     // Need 2 successes in half-open to close
  };

  const breaker = new CircuitBreaker(config);

  // Initial state: closed
  printState("Initial", breaker);

  // Simulate failures to trip the circuit
  console.log("\n   Simulating 3 consecutive failures...");
  for (let i = 1; i <= 3; i++) {
    breaker.recordFailure();
    printState(`After failure ${i}`, breaker);
  }

  // Circuit should now be open — requests blocked
  console.log(`\n   Is request allowed? ${breaker.isAllowed()}`);

  // Wait for reset timeout
  console.log("\n   ⏳ Waiting 150ms for reset timeout...");
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should transition to half-open
  printState("After timeout", breaker);
  console.log(`   Is request allowed? ${breaker.isAllowed()}`);

  // Record successes to close the circuit
  console.log("\n   Recording 2 successes in half-open state...");
  breaker.recordSuccess();
  printState("After 1 success", breaker);
  breaker.recordSuccess();
  printState("After 2 successes", breaker);

  // Manual reset
  console.log("\n   Manual reset:");
  breaker.reset();
  printState("After reset", breaker);
  console.log();
}

// ── Demo 2: FallbackProvider with Circuit Breakers ──────────────────

async function demoFallbackProvider() {
  console.log("🔄 Demo 2: FallbackProvider with Circuit Breakers");
  console.log("─".repeat(50));

  // Primary provider — configured to always fail
  const primary = new MockProvider({
    defaultResponse: "primary response",
    failureRate: 1.0, // 100% failure rate
  });
  // Override the name for display
  Object.defineProperty(primary, "name", { value: "primary" });

  // Fallback provider — always succeeds
  const fallback = new MockProvider({
    defaultResponse: JSON.stringify({ result: "fallback response" }),
  });
  Object.defineProperty(fallback, "name", { value: "fallback" });

  // Create FallbackProvider with circuit breaker
  const provider = new FallbackProvider([primary, fallback], {
    retryDelay: 10,
    circuitBreaker: {
      failureThreshold: 2,
      resetTimeout: 200,
      successThreshold: 1,
    },
  });

  // Show initial health
  console.log("\n   📊 Initial provider health:");
  printHealth(provider);

  // Make requests — primary will fail, fallback succeeds
  console.log("\n   Making 3 requests (primary always fails, fallback succeeds):");
  for (let i = 1; i <= 3; i++) {
    try {
      const response = await provider.chat({
        model: "test",
        messages: [{ role: "user", content: `Request ${i}` }],
        temperature: 0.7,
        jsonMode: false,
      });
      console.log(`   Request ${i}: ✅ "${response.content.slice(0, 40)}"`);
    } catch (err) {
      console.log(`   Request ${i}: ❌ ${(err as Error).message}`);
    }
  }

  // Show health after failures
  console.log("\n   📊 Provider health after requests:");
  printHealth(provider);

  // The primary's circuit should be open now
  console.log("\n   ⏳ Waiting 250ms for primary circuit reset timeout...");
  await new Promise((resolve) => setTimeout(resolve, 250));

  console.log("\n   📊 Provider health after timeout:");
  printHealth(provider);

  console.log();
}

function printHealth(provider: FallbackProvider): void {
  const health = provider.getProviderHealth();
  for (const h of health) {
    const emoji: Record<CircuitState, string> = {
      closed: "🟢",
      open: "🔴",
      "half-open": "🟡",
    };
    console.log(
      `     ${emoji[h.state]} ${h.name}: state=${h.state}, failures=${h.failureCount}`
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("⚡ Circuit Breaker Demo");
  console.log("═".repeat(60));
  console.log();

  await demoStandalone();
  await demoFallbackProvider();

  console.log("═".repeat(60));
  console.log("Demo complete.\n");
}

main();
