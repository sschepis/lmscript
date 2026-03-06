/**
 * Example: Agent Loop — Iterative Tool Calling
 *
 * Demonstrates:
 *   - AgentLoop for multi-step tool-calling workflows
 *   - Defining ToolDefinitions with Zod parameter schemas
 *   - Callbacks (onToolCall, onIteration) for observability
 *   - runtime.executeAgent() as the underlying engine
 *   - MockProvider for deterministic, API-key-free execution
 *
 * Usage:
 *   npx tsx src/examples/agent-loop-demo.ts
 */

import { z } from "zod";
import {
  LScriptRuntime,
  AgentLoop,
} from "../index.js";
import type {
  AgentConfig,
  LScriptFunction,
  ToolDefinition,
  ToolCall,
} from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── 1. Define tools ─────────────────────────────────────────────────

/**
 * A simple calculator tool the agent can invoke to perform arithmetic.
 */
const calculatorTool: ToolDefinition = {
  name: "calculator",
  description: "Perform basic arithmetic (add, subtract, multiply, divide).",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: (params) => {
    switch (params.operation) {
      case "add":
        return { result: params.a + params.b };
      case "subtract":
        return { result: params.a - params.b };
      case "multiply":
        return { result: params.a * params.b };
      case "divide":
        if (params.b === 0) return { error: "Division by zero" };
        return { result: params.a / params.b };
    }
  },
};

/**
 * A mock weather lookup tool.
 */
const weatherTool: ToolDefinition = {
  name: "weather_lookup",
  description: "Look up the current weather for a city.",
  parameters: z.object({
    city: z.string(),
  }),
  execute: (params) => {
    // Simulated weather data
    const data: Record<string, { temp: number; condition: string }> = {
      "New York": { temp: 72, condition: "Partly Cloudy" },
      London: { temp: 59, condition: "Rainy" },
      Tokyo: { temp: 81, condition: "Sunny" },
    };
    return data[params.city] ?? { temp: 65, condition: "Unknown" };
  },
};

// ── 2. Define the agent's LScriptFunction ───────────────────────────

const AgentResultSchema = z.object({
  answer: z.string(),
  steps: z.array(z.string()),
  tool_calls_made: z.number(),
});

const assistantFn: LScriptFunction<string, typeof AgentResultSchema> = {
  name: "SmartAssistant",
  model: "mock-model",
  system:
    "You are a helpful assistant with access to a calculator and weather lookup tool. " +
    "Use the tools as needed to answer the user's question, then produce a final JSON answer.",
  prompt: (question: string) => question,
  schema: AgentResultSchema,
  temperature: 0.3,
  maxRetries: 1,
  tools: [calculatorTool, weatherTool],
};

// ── 3. Set up MockProvider with tool-call responses ─────────────────

/**
 * The MockProvider is configured to simulate a two-iteration tool-calling flow:
 *   1st call → the model returns a tool call (calculator)
 *   2nd call → the model returns the final JSON answer
 */
const mockProvider = new MockProvider({
  responses: new Map([
    // After tool results come back, the model produces the final answer
    [
      "Tool results",
      JSON.stringify({
        answer: "25 × 4 = 100. The weather in Tokyo is 81°F and Sunny.",
        steps: [
          "Used calculator to compute 25 × 4 = 100",
          "Looked up weather in Tokyo: 81°F, Sunny",
        ],
        tool_calls_made: 2,
      }),
    ],
  ]),
  // Default response simulates a tool call request (first iteration)
  defaultResponse: JSON.stringify({
    answer: "Calculating and looking up weather...",
    steps: ["Initiating tool calls"],
    tool_calls_made: 0,
  }),
});

// ── 4. Execute the agent loop ───────────────────────────────────────

async function main() {
  console.log("🤖 Agent Loop Demo");
  console.log("═".repeat(60));

  const runtime = new LScriptRuntime({
    provider: mockProvider,
    verbose: false,
  });

  // Configure callbacks so we can observe each iteration and tool call
  const agentConfig: AgentConfig = {
    maxIterations: 5,

    onToolCall: (toolCall: ToolCall) => {
      console.log(`\n  🔧 Tool called: ${toolCall.name}`);
      console.log(`     Arguments: ${JSON.stringify(toolCall.arguments)}`);
      console.log(`     Result:    ${JSON.stringify(toolCall.result)}`);
    },

    onIteration: (iteration: number, response: string) => {
      console.log(`\n  📡 Iteration ${iteration}`);
      console.log(`     Response preview: ${response.slice(0, 80)}...`);
    },
  };

  // Option A: Use AgentLoop class
  console.log("\n▶ Running agent with AgentLoop class...\n");
  const agentLoop = new AgentLoop(runtime, agentConfig);
  const result = await agentLoop.run(assistantFn, "What is 25 times 4? Also, what's the weather in Tokyo?");

  console.log("\n" + "─".repeat(60));
  console.log("✅ Agent completed!");
  console.log(`   Answer:     ${result.data.answer}`);
  console.log(`   Steps:      ${result.data.steps.join("; ")}`);
  console.log(`   Iterations: ${result.iterations}`);
  console.log(`   Tool calls: ${result.toolCalls.length}`);

  if (result.usage) {
    console.log(`   Tokens:     ${result.usage.totalTokens}`);
  }

  // List all tool calls made
  if (result.toolCalls.length > 0) {
    console.log("\n  📋 All tool calls:");
    result.toolCalls.forEach((tc, i) => {
      console.log(`     ${i + 1}. ${tc.name}(${JSON.stringify(tc.arguments)}) → ${JSON.stringify(tc.result)}`);
    });
  }

  // Option B: Use runtime.executeAgent() directly (equivalent)
  console.log("\n\n▶ Running agent with runtime.executeAgent() directly...\n");
  mockProvider.reset();

  const result2 = await runtime.executeAgent(
    assistantFn,
    "What is 25 times 4? Also, what's the weather in Tokyo?",
    { maxIterations: 5 }
  );

  console.log("✅ Direct executeAgent completed!");
  console.log(`   Answer:     ${result2.data.answer}`);
  console.log(`   Iterations: ${result2.iterations}`);

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
}

main();
