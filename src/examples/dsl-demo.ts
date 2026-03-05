/**
 * Example: L-Script DSL Demo — Parsing and Using .ls Files
 *
 * Demonstrates:
 *   - Reading an .ls file and compiling it with compileFile()
 *   - Inspecting compiled types and their Zod schemas
 *   - Using compiled functions with the runtime
 *   - Creating additional .ls file content inline and compiling it
 *   - Schema validation against sample data
 *
 * This example can run WITHOUT an API key — it demonstrates the DSL
 * compilation pipeline. Actual LLM execution is only attempted if
 * OPENAI_API_KEY is set.
 *
 * Usage:
 *   npx tsx src/examples/dsl-demo.ts
 *   OPENAI_API_KEY=sk-... npx tsx src/examples/dsl-demo.ts
 */

import fs from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { compileFile, LScriptRuntime, OpenAIProvider } from "../index.js";
import type { CompiledModule, LScriptFunction } from "../index.js";

// ── 1. Read and compile the security-review.ls file ─────────────────

function step1_compileFromFile(): CompiledModule {
  console.log("\n📄 Step 1: Compile .ls File from Disk");
  console.log("═".repeat(60));

  const lsFilePath = path.resolve(process.cwd(), "examples/security-review.ls");
  console.log(`  Reading: ${lsFilePath}`);

  const source = fs.readFileSync(lsFilePath, "utf-8");
  console.log(`  Source length: ${source.length} characters`);
  console.log(`  Preview:\n`);
  source.split("\n").slice(0, 10).forEach((line: string, i: number) => {
    console.log(`    ${(i + 1).toString().padStart(2)}│ ${line}`);
  });
  console.log(`    ...`);

  const compiled = compileFile(source);
  console.log(`\n  ✅ Compilation successful!`);
  console.log(`  📦 Types discovered:     ${compiled.types.size}`);
  console.log(`  📦 Functions discovered: ${compiled.functions.size}`);

  return compiled;
}

// ── 2. Inspect compiled types ───────────────────────────────────────

function step2_inspectTypes(compiled: CompiledModule): void {
  console.log("\n\n🔍 Step 2: Inspect Compiled Types");
  console.log("═".repeat(60));

  for (const [name, schema] of compiled.types) {
    console.log(`\n  📐 Type: ${name}`);
    console.log("  " + "─".repeat(50));

    const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });
    console.log(`  JSON Schema:`);
    const schemaStr = JSON.stringify(jsonSchema, null, 2);
    schemaStr.split("\n").forEach((line: string) => {
      console.log(`    ${line}`);
    });
  }
}

// ── 3. Inspect compiled functions ───────────────────────────────────

function step3_inspectFunctions(compiled: CompiledModule): void {
  console.log("\n\n⚙️  Step 3: Inspect Compiled Functions");
  console.log("═".repeat(60));

  for (const [name, fn] of compiled.functions) {
    console.log(`\n  🔧 Function: ${name}`);
    console.log("  " + "─".repeat(50));
    console.log(`    Model:       ${fn.model}`);
    console.log(`    Temperature: ${fn.temperature ?? "default"}`);
    console.log(`    System:      ${truncate(fn.system, 60)}`);

    // Test the prompt template with sample input
    const samplePrompt = fn.prompt("console.log('hello world');");
    console.log(`    Prompt (sample):`);
    samplePrompt.split("\n").forEach((line: string) => {
      console.log(`      ${line}`);
    });
  }
}

// ── 4. Compile inline .ls source ────────────────────────────────────

function step4_compileInline(): CompiledModule {
  console.log("\n\n📝 Step 4: Compile Inline L-Script Source");
  console.log("═".repeat(60));

  const inlineSource = `
type Translation = {
  original_language: string,
  target_language: string,
  translated_text: string,
  confidence: number(min=0, max=1),
  alternative_translations: string[]
}

llm Translator(text: string) -> Translation {
  model: "gpt-4o"
  temperature: 0.3
  system: "You are a professional translator. Detect the source language automatically."
  prompt:
    """
    Translate the following text to English:
    {{text}}
    """
}
`;

  console.log("  Source:");
  inlineSource.trim().split("\n").forEach((line: string, i: number) => {
    console.log(`    ${(i + 1).toString().padStart(2)}│ ${line}`);
  });

  const compiled = compileFile(inlineSource);
  console.log(`\n  ✅ Inline compilation successful!`);
  console.log(`  📦 Types:     ${compiled.types.size}`);
  console.log(`  📦 Functions: ${compiled.functions.size}`);

  return compiled;
}

// ── 5. Inspect the inline-compiled module ───────────────────────────

function step5_inspectInlineModule(compiled: CompiledModule): void {
  console.log("\n\n🔍 Step 5: Inspect Inline-Compiled Module");
  console.log("═".repeat(60));

  // Show the Translation type schema
  const translationSchema = compiled.types.get("Translation");
  if (translationSchema) {
    console.log("\n  📐 Translation Type → JSON Schema:");
    const jsonSchema = zodToJsonSchema(translationSchema, { target: "openApi3" });
    const schemaStr = JSON.stringify(jsonSchema, null, 2);
    schemaStr.split("\n").forEach((line: string) => {
      console.log(`    ${line}`);
    });
  }

  // Show the Translator function config
  const translatorFn = compiled.functions.get("Translator");
  if (translatorFn) {
    console.log(`\n  🔧 Translator Function Config:`);
    console.log(`    Name:        ${translatorFn.name}`);
    console.log(`    Model:       ${translatorFn.model}`);
    console.log(`    Temperature: ${translatorFn.temperature}`);
    console.log(`    System:      ${translatorFn.system}`);

    const samplePrompt = translatorFn.prompt("Bonjour le monde!");
    console.log(`    Prompt("Bonjour le monde!"):`);
    samplePrompt.split("\n").forEach((line: string) => {
      console.log(`      ${line}`);
    });
  }
}

// ── 6. Schema validation demo ───────────────────────────────────────

function step6_schemaValidation(compiled: CompiledModule): void {
  console.log("\n\n✅ Step 6: Schema Validation Demo");
  console.log("═".repeat(60));

  const schema = compiled.types.get("Translation");
  if (!schema) {
    console.log("  ⚠️  Translation schema not found");
    return;
  }

  // Valid data
  const validData = {
    original_language: "French",
    target_language: "English",
    translated_text: "Hello world!",
    confidence: 0.95,
    alternative_translations: ["Hello, world!", "Greetings, world!"],
  };

  console.log("\n  🧪 Test 1: Valid data");
  console.log(`    Input: ${JSON.stringify(validData, null, 2).split("\n").join("\n    ")}`);
  const validResult = schema.safeParse(validData);
  console.log(`    Result: ${validResult.success ? "✅ PASS" : "❌ FAIL"}`);

  // Invalid data — confidence out of range
  const invalidData1 = {
    original_language: "French",
    target_language: "English",
    translated_text: "Hello world!",
    confidence: 1.5, // > 1, should fail
    alternative_translations: ["Hello!"],
  };

  console.log("\n  🧪 Test 2: Invalid confidence (1.5 > max 1)");
  console.log(`    Input: { ...valid, confidence: 1.5 }`);
  const invalidResult1 = schema.safeParse(invalidData1);
  console.log(`    Result: ${invalidResult1.success ? "✅ PASS" : "❌ FAIL"}`);
  if (!invalidResult1.success) {
    invalidResult1.error.issues.forEach((issue) => {
      console.log(`    Error:  ${issue.path.join(".")}: ${issue.message}`);
    });
  }

  // Invalid data — missing field
  const invalidData2 = {
    original_language: "Spanish",
    translated_text: "Hello!",
    // missing target_language, confidence, alternative_translations
  };

  console.log("\n  🧪 Test 3: Missing required fields");
  console.log(`    Input: { original_language, translated_text }`);
  const invalidResult2 = schema.safeParse(invalidData2);
  console.log(`    Result: ${invalidResult2.success ? "✅ PASS" : "❌ FAIL"}`);
  if (!invalidResult2.success) {
    invalidResult2.error.issues.forEach((issue) => {
      console.log(`    Error:  ${issue.path.join(".")}: ${issue.message}`);
    });
  }

  // Invalid data — wrong type for array
  const invalidData3 = {
    original_language: "German",
    target_language: "English",
    translated_text: "Hello!",
    confidence: 0.8,
    alternative_translations: "not-an-array", // should be string[]
  };

  console.log("\n  🧪 Test 4: Wrong type (string instead of string[])");
  console.log(`    Input: { ...valid, alternative_translations: "not-an-array" }`);
  const invalidResult3 = schema.safeParse(invalidData3);
  console.log(`    Result: ${invalidResult3.success ? "✅ PASS" : "❌ FAIL"}`);
  if (!invalidResult3.success) {
    invalidResult3.error.issues.forEach((issue) => {
      console.log(`    Error:  ${issue.path.join(".")}: ${issue.message}`);
    });
  }
}

// ── 7. Optional: Execute with runtime ───────────────────────────────

async function step7_executeWithRuntime(compiled: CompiledModule): Promise<void> {
  console.log("\n\n🚀 Step 7: Execute Compiled Function with Runtime");
  console.log("═".repeat(60));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("  ⚠️  OPENAI_API_KEY not set — skipping live execution");
    console.log("  ℹ️  Set OPENAI_API_KEY to see the compiled function in action");
    console.log("\n  Here's how you would use the compiled function:\n");
    console.log(`    const runtime = new LScriptRuntime({`);
    console.log(`      provider: new OpenAIProvider({ apiKey }),`);
    console.log(`      verbose: true,`);
    console.log(`    });`);
    console.log(`    const translator = compiled.functions.get("Translator");`);
    console.log(`    const result = await runtime.execute(translator, "Bonjour le monde!");`);
    console.log(`    console.log(result.data);`);
    return;
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  const translatorFn = compiled.functions.get("Translator") as LScriptFunction<string, any> | undefined;
  if (!translatorFn) {
    console.log("  ❌ Translator function not found in compiled module");
    return;
  }

  const testInputs = [
    "Bonjour le monde!",
    "Guten Morgen, wie geht es Ihnen?",
    "こんにちは世界",
  ];

  for (const input of testInputs) {
    console.log(`\n  🌐 Translating: "${input}"`);
    try {
      const result = await runtime.execute(translatorFn, input);
      const data = result.data as Record<string, unknown>;
      console.log(`    📝 From:        ${data.original_language}`);
      console.log(`    📝 To:          ${data.target_language}`);
      console.log(`    📝 Translation: ${data.translated_text}`);
      console.log(`    📊 Confidence:  ${((data.confidence as number) * 100).toFixed(1)}%`);
      if (Array.isArray(data.alternative_translations) && data.alternative_translations.length > 0) {
        console.log(`    🔄 Alternatives:`);
        (data.alternative_translations as string[]).forEach((alt: string) => {
          console.log(`       • ${alt}`);
        });
      }
      console.log(`    🪙 Tokens:      ${result.usage?.totalTokens ?? "N/A"}`);
    } catch (err) {
      console.error(`    ❌ Error: ${err}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🧩 L-Script DSL Demo");
  console.log("═".repeat(60));
  console.log("Demonstrating the L-Script DSL compilation pipeline\n");

  // Step 1: Compile .ls file from disk
  const securityModule = step1_compileFromFile();

  // Step 2: Inspect compiled types
  step2_inspectTypes(securityModule);

  // Step 3: Inspect compiled functions
  step3_inspectFunctions(securityModule);

  // Step 4: Compile inline source
  const translationModule = step4_compileInline();

  // Step 5: Inspect inline module
  step5_inspectInlineModule(translationModule);

  // Step 6: Schema validation
  step6_schemaValidation(translationModule);

  // Step 7: Optional live execution
  await step7_executeWithRuntime(translationModule);

  console.log("\n\n✅ DSL demo complete!");
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

main();
