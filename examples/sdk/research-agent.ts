/**
 * Example: Research Agent with Tool Calling
 *
 * Demonstrates:
 *   - LScriptFunction with tools array
 *   - 3 tool definitions with Zod parameter schemas
 *   - Mock tool execute functions
 *   - Runtime auto-executes tools and re-prompts the LLM
 *   - Displaying result.toolCalls after execution
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/research-agent.ts
 *   npx tsx src/examples/research-agent.ts "What is the market size of electric vehicles in 2025?"
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "../index.js";
import type { LScriptFunction, ToolDefinition, ToolCall } from "../index.js";

// ── 1. Define tool schemas and implementations ──────────────────────

const webSearch: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information on any topic",
  parameters: z.object({
    query: z.string().describe("The search query"),
    max_results: z.number().optional().describe("Maximum number of results to return"),
  }),
  execute: async (params: { query: string; max_results?: number }) => {
    // Mock: return fake search results based on the query
    const maxResults = params.max_results ?? 3;
    console.log(`    🌐 [web_search] Searching: "${params.query}" (max: ${maxResults})`);
    return [
      {
        title: `Comprehensive Analysis: ${params.query}`,
        url: "https://example.com/analysis/1",
        snippet:
          "Recent studies indicate significant growth in this sector, with a compound annual growth rate " +
          "of 23.4% projected through 2030. Key drivers include regulatory changes and consumer demand.",
      },
      {
        title: `Industry Report: ${params.query} - Market Trends`,
        url: "https://example.com/report/2",
        snippet:
          "The global market reached $287 billion in 2024, with North America and Europe accounting " +
          "for 62% of total revenue. Emerging markets are expected to grow fastest.",
      },
      {
        title: `Expert Opinions on ${params.query}`,
        url: "https://example.com/experts/3",
        snippet:
          "Leading analysts predict transformative shifts by 2027, citing technological breakthroughs " +
          "in battery efficiency and declining production costs as primary catalysts.",
      },
    ].slice(0, maxResults);
  },
};

const queryDatabase: ToolDefinition = {
  name: "query_database",
  description: "Query the product database for pricing, inventory, and market data",
  parameters: z.object({
    table: z.string().describe("The database table to query"),
    filter: z.string().describe("SQL-like filter condition"),
  }),
  execute: async (params: { table: string; filter: string }) => {
    console.log(`    🗄️  [query_database] Table: ${params.table}, Filter: ${params.filter}`);
    // Mock: return structured DB results
    return {
      rows: [
        { id: 1, name: "Product Alpha", market_share: "34.2%", revenue: "$98.2B", yoy_growth: "+18.5%" },
        { id: 2, name: "Product Beta", market_share: "22.8%", revenue: "$65.4B", yoy_growth: "+24.1%" },
        { id: 3, name: "Product Gamma", market_share: "15.3%", revenue: "$43.9B", yoy_growth: "+31.7%" },
        { id: 4, name: "Others", market_share: "27.7%", revenue: "$79.5B", yoy_growth: "+12.3%" },
      ],
      count: 4,
      query_time_ms: 42,
    };
  },
};

const calculate: ToolDefinition = {
  name: "calculate",
  description: "Perform mathematical calculations for data analysis",
  parameters: z.object({
    expression: z.string().describe("Mathematical expression to evaluate (e.g., '287 * 1.234')"),
  }),
  execute: async (params: { expression: string }) => {
    console.log(`    🧮 [calculate] Expression: ${params.expression}`);
    // Simple safe eval for basic math operations
    try {
      // Only allow numbers, operators, parentheses, and decimal points
      const sanitized = params.expression.replace(/[^0-9+\-*/().%\s]/g, "");
      if (sanitized !== params.expression.replace(/\s/g, "")) {
        return { expression: params.expression, result: "Error: invalid characters", error: true };
      }
      // Use Function constructor for basic math (safe with sanitized input)
      const result = new Function(`return (${sanitized})`)() as number;
      return { expression: params.expression, result: Number(result.toFixed(4)) };
    } catch {
      return { expression: params.expression, result: "Error: could not evaluate", error: true };
    }
  },
};

// ── 2. Define the output schema ─────────────────────────────────────

const ResearchReportSchema = z.object({
  topic: z.string(),
  findings: z.array(
    z.object({
      source: z.string(),
      fact: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    })
  ),
  conclusion: z.string(),
  data_points: z.array(
    z.object({
      metric: z.string(),
      value: z.string(),
    })
  ),
});

type ResearchReport = z.infer<typeof ResearchReportSchema>;

// ── 3. Define the research agent function ───────────────────────────

const ResearchAgent: LScriptFunction<string, typeof ResearchReportSchema> = {
  name: "ResearchAgent",
  model: "gpt-4o",
  temperature: 0.5,
  system:
    "You are a meticulous research analyst. When given a research topic, you MUST " +
    "use the available tools to gather data before composing your report:\n\n" +
    "1. Use web_search to find current information and trends\n" +
    "2. Use query_database to pull structured market/product data\n" +
    "3. Use calculate to perform any numerical analysis\n\n" +
    "Do NOT make up data — rely on tool results to populate your findings. " +
    "Cite the source for each finding. Rate your confidence based on the quality " +
    "of the data source (web_search results = medium, database = high, calculations = high).",
  prompt: (topic: string) =>
    `Research the following topic and produce a comprehensive report:\n\n"${topic}"\n\n` +
    "Use all available tools to gather data before writing the report.",
  schema: ResearchReportSchema,
  maxRetries: 2,
  tools: [webSearch, queryDatabase, calculate],
};

// ── 4. Execute ──────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("╔════════════════════════════════════════════════════╗");
    console.error("║  OPENAI_API_KEY is required to run this demo      ║");
    console.error("║                                                    ║");
    console.error("║  export OPENAI_API_KEY=sk-...                      ║");
    console.error("║  npx tsx src/examples/research-agent.ts            ║");
    console.error("╚════════════════════════════════════════════════════╝");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  const topic =
    process.argv[2] ??
    "What is the current market landscape for electric vehicles, including major players, " +
    "market share, and projected growth rates?";

  console.log("\n🔬 Research Agent with Tool Calling");
  console.log("═".repeat(60));
  console.log(`\n📋 Topic: "${topic}"\n`);
  console.log("Available tools: web_search, query_database, calculate");
  console.log("─".repeat(60));
  console.log("\n🔧 Tool executions:\n");

  try {
    const result = await runtime.execute(ResearchAgent, topic);
    const report = result.data;

    // ── Display the report ──
    console.log("\n" + "═".repeat(60));
    console.log("📄 RESEARCH REPORT");
    console.log("═".repeat(60));

    console.log(`\n📌 Topic: ${report.topic}\n`);

    // Findings
    console.log("📊 Findings:");
    console.log("─".repeat(50));
    report.findings.forEach((f, i) => {
      const icon =
        f.confidence === "high" ? "🟢" :
        f.confidence === "medium" ? "🟡" : "🔴";
      console.log(`  ${i + 1}. ${icon} [${f.confidence}] ${f.fact}`);
      console.log(`     📎 Source: ${f.source}`);
    });

    // Data Points
    console.log(`\n📈 Key Data Points:`);
    console.log("─".repeat(50));
    console.log("  Metric".padEnd(35) + "│ Value");
    console.log("  " + "─".repeat(33) + "┼" + "─".repeat(20));
    report.data_points.forEach((dp) => {
      console.log(`  ${dp.metric.padEnd(33)}│ ${dp.value}`);
    });

    // Conclusion
    console.log(`\n💡 Conclusion:`);
    console.log("─".repeat(50));
    console.log(`  ${report.conclusion}`);

    // Tool Calls Summary
    console.log("\n" + "═".repeat(60));
    console.log("🔧 Tool Calls Made During Execution");
    console.log("─".repeat(60));

    if (result.toolCalls && result.toolCalls.length > 0) {
      result.toolCalls.forEach((tc: ToolCall, i: number) => {
        console.log(`\n  Call #${i + 1}: ${tc.name}`);
        console.log(`    Arguments: ${JSON.stringify(tc.arguments, null, 2).split("\n").join("\n    ")}`);
        console.log(`    Result:    ${truncate(JSON.stringify(tc.result), 120)}`);
      });
    } else {
      console.log("  No tool calls were made (LLM may have answered directly).");
    }

    // Execution stats
    console.log("\n" + "═".repeat(60));
    console.log("📊 Execution Stats");
    console.log("─".repeat(60));
    console.log(`  Attempts:    ${result.attempts}`);
    console.log(`  Tool calls:  ${result.toolCalls?.length ?? 0}`);
    if (result.usage) {
      console.log(`  Tokens:      ${result.usage.totalTokens} total`);
      console.log(`    ├─ Prompt:  ${result.usage.promptTokens}`);
      console.log(`    └─ Output:  ${result.usage.completionTokens}`);
    }
    console.log("═".repeat(60));

  } catch (err) {
    console.error("\n❌ Research agent execution failed:", err);
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}

main();
