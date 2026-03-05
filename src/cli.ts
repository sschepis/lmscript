#!/usr/bin/env node

// ── lsc: L-Script CLI Tool ──────────────────────────────────────────

import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { LScriptFunction } from "./types.js";
import { compileFile } from "./dsl/index.js";

// ── Manifest generation (exported for testing) ──────────────────────

export interface FunctionManifest {
  name: string;
  model: string;
  system: string;
  temperature: number | undefined;
  schema: object;
  exampleCount: number;
  toolCount: number;
}

/**
 * Generate an execution manifest for an LScriptFunction.
 */
export function generateManifest(fn: LScriptFunction<unknown, z.ZodType>): FunctionManifest {
  const schema = zodToJsonSchema(fn.schema, { target: "openApi3" }) as object;
  return {
    name: fn.name,
    model: fn.model,
    system: fn.system.length > 100 ? fn.system.slice(0, 100) + "…" : fn.system,
    temperature: fn.temperature,
    schema,
    exampleCount: fn.examples?.length ?? 0,
    toolCount: fn.tools?.length ?? 0,
  };
}

/**
 * Extract all exported LScriptFunction objects from a module.
 */
export function extractFunctions(mod: Record<string, unknown>): Array<{ key: string; fn: LScriptFunction<unknown, z.ZodType> }> {
  const results: Array<{ key: string; fn: LScriptFunction<unknown, z.ZodType> }> = [];

  for (const [key, value] of Object.entries(mod)) {
    if (isLScriptFunction(value)) {
      results.push({ key, fn: value as LScriptFunction<unknown, z.ZodType> });
    }
  }

  return results;
}

/**
 * Check if a value looks like an LScriptFunction.
 */
function isLScriptFunction(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.model === "string" &&
    typeof obj.system === "string" &&
    typeof obj.prompt === "function" &&
    obj.schema != null &&
    typeof (obj.schema as any).safeParse === "function"
  );
}

// ── CLI Commands ────────────────────────────────────────────────────

async function loadModule(filePath: string): Promise<Record<string, unknown>> {
  const resolved = filePath.startsWith("/") || filePath.startsWith(".")
    ? filePath
    : `./${filePath}`;

  try {
    const mod = await import(resolved);
    return mod as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to load file "${filePath}": ${message}`);
    process.exit(1);
  }
}

async function cmdCompile(filePath: string): Promise<void> {
  const mod = await loadModule(filePath);
  const fns = extractFunctions(mod);

  if (fns.length === 0) {
    console.log(`No LScriptFunction exports found in "${filePath}".`);
    return;
  }

  console.log(`\n📋 Execution Manifest for "${filePath}"\n`);
  console.log(`Found ${fns.length} function(s):\n`);

  for (const { key, fn } of fns) {
    const manifest = generateManifest(fn);
    console.log(`── ${key} ${"─".repeat(Math.max(0, 50 - key.length))}`);
    console.log(`  Name:         ${manifest.name}`);
    console.log(`  Model:        ${manifest.model}`);
    console.log(`  System:       ${manifest.system}`);
    console.log(`  Temperature:  ${manifest.temperature ?? "(default)"}`);
    console.log(`  Examples:     ${manifest.exampleCount}`);
    console.log(`  Tools:        ${manifest.toolCount}`);
    console.log(`  Schema:       ${JSON.stringify(manifest.schema, null, 2).split("\n").join("\n                ")}`);
    console.log();
  }
}

async function cmdList(filePath: string): Promise<void> {
  const mod = await loadModule(filePath);
  const fns = extractFunctions(mod);

  if (fns.length === 0) {
    console.log(`No LScriptFunction exports found in "${filePath}".`);
    return;
  }

  console.log(`\nLScriptFunction exports in "${filePath}":\n`);
  for (const { key, fn } of fns) {
    console.log(`  • ${key} (name: "${fn.name}", model: "${fn.model}")`);
  }
  console.log();
}

async function cmdValidate(filePath: string): Promise<void> {
  const mod = await loadModule(filePath);
  const fns = extractFunctions(mod);

  if (fns.length === 0) {
    console.log(`No LScriptFunction exports found in "${filePath}".`);
    return;
  }

  console.log(`\nValidating ${fns.length} function(s) in "${filePath}":\n`);

  let allValid = true;

  for (const { key, fn } of fns) {
    try {
      // Validate that the Zod schema is well-formed by testing it can parse
      const result = fn.schema.safeParse(undefined);
      // We don't care if parsing succeeds — we just want to ensure safeParse doesn't throw
      // The schema is valid if safeParse runs without exception
      void result;

      // Also validate that zodToJsonSchema doesn't throw
      zodToJsonSchema(fn.schema, { target: "openApi3" });

      console.log(`  ✓ ${key} — schema is valid`);
    } catch (err) {
      allValid = false;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${key} — schema error: ${message}`);
    }
  }

  console.log();
  if (allValid) {
    console.log("All functions have valid schemas. ✓");
  } else {
    console.log("Some functions have invalid schemas. ✗");
    process.exit(1);
  }
}

// ── Parse .ls DSL files ─────────────────────────────────────────────

async function cmdParse(filePath: string): Promise<void> {
  const fs = await import("fs");

  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to read file "${filePath}": ${message}`);
    process.exit(1);
  }

  try {
    const module = compileFile(source);

    console.log(`\n📋 Parsed L-Script file "${filePath}"\n`);

    // Display types
    if (module.types.size > 0) {
      console.log(`Types (${module.types.size}):\n`);
      for (const [name, schema] of module.types) {
        const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });
        console.log(`  📦 ${name}`);
        console.log(`     Schema: ${JSON.stringify(jsonSchema, null, 2).split("\n").join("\n     ")}`);
        console.log();
      }
    }

    // Display functions
    if (module.functions.size > 0) {
      console.log(`Functions (${module.functions.size}):\n`);
      for (const [name, fn] of module.functions) {
        console.log(`  ⚡ ${name}`);
        console.log(`     Model:       ${fn.model}`);
        console.log(`     System:      ${fn.system.length > 80 ? fn.system.slice(0, 80) + "…" : fn.system}`);
        console.log(`     Temperature: ${fn.temperature ?? "(default)"}`);
        console.log(`     Prompt:      ${fn.prompt("(sample input)").length > 80 ? fn.prompt("(sample input)").slice(0, 80) + "…" : fn.prompt("(sample input)")}`);
        console.log();
      }
    }

    if (module.types.size === 0 && module.functions.size === 0) {
      console.log("No types or functions found in the file.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Parse error: ${message}`);
    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
lsc — L-Script CLI Tool

Usage:
  lsc compile <file>   Dry-run compilation: show execution manifest
  lsc list <file>      List all exported LScriptFunction names
  lsc validate <file>  Validate that all exported functions have valid schemas
  lsc parse <file.ls>  Parse an .ls DSL file and display types/functions

Examples:
  lsc compile src/examples/security-reviewer.ts
  lsc list src/examples/security-reviewer.ts
  lsc validate src/examples/security-reviewer.ts
  lsc parse examples/security-review.ls
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const filePath = args[1];

  if (!filePath) {
    console.error(`Error: Missing file argument for "${command}" command.`);
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "compile":
      await cmdCompile(filePath);
      break;
    case "list":
      await cmdList(filePath);
      break;
    case "validate":
      await cmdValidate(filePath);
      break;
    case "parse":
      await cmdParse(filePath);
      break;
    default:
      console.error(`Error: Unknown command "${command}".`);
      printUsage();
      process.exit(1);
  }
}

// Export main for programmatic use
export { main };

// Only run when executed directly as a CLI tool
// When imported as a module (e.g., in tests), this block is skipped
// because the file path won't match argv[1]
if (process.argv[1] && (
  process.argv[1].endsWith("/cli.ts") ||
  process.argv[1].endsWith("/cli.js") ||
  process.argv[1].endsWith("\\cli.ts") ||
  process.argv[1].endsWith("\\cli.js")
)) {
  main().catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
