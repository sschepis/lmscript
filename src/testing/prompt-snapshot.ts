import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LScriptFunction } from "../types.js";

// ── Snapshot Types ──────────────────────────────────────────────────

export interface PromptSnapshot {
  fnName: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  schemaJson: object;
  timestamp: number;
}

export interface SnapshotDiff {
  changed: boolean;
  diffs: Array<{
    field: string;
    baseline: string;
    current: string;
  }>;
}

// ── Snapshot Capture ────────────────────────────────────────────────

/**
 * Generates the compiled prompt (system + schema injection + user prompt)
 * exactly as the runtime would, and captures it as a snapshot.
 */
export function captureSnapshot<I, O extends z.ZodType>(
  fn: LScriptFunction<I, O>,
  sampleInput: I
): PromptSnapshot {
  const jsonSchema = zodToJsonSchema(fn.schema, { target: "openApi3" });

  const schemaInstruction = [
    "YOU MUST RESPOND ONLY WITH VALID JSON.",
    "YOUR RESPONSE MUST CONFORM TO THIS JSON SCHEMA:",
    JSON.stringify(jsonSchema, null, 2),
    "DO NOT include any text outside the JSON object.",
  ].join("\n");

  const systemPrompt = `${fn.system}\n\n${schemaInstruction}`;
  const userPrompt = fn.prompt(sampleInput);

  return {
    fnName: fn.name,
    model: fn.model,
    systemPrompt,
    userPrompt,
    schemaJson: jsonSchema as object,
    timestamp: Date.now(),
  };
}

// ── Snapshot Comparison ─────────────────────────────────────────────

/**
 * Compare two snapshots field by field and return which fields changed.
 */
export function compareSnapshots(
  baseline: PromptSnapshot,
  current: PromptSnapshot
): SnapshotDiff {
  const diffs: SnapshotDiff["diffs"] = [];

  if (baseline.fnName !== current.fnName) {
    diffs.push({
      field: "fnName",
      baseline: baseline.fnName,
      current: current.fnName,
    });
  }

  if (baseline.model !== current.model) {
    diffs.push({
      field: "model",
      baseline: baseline.model,
      current: current.model,
    });
  }

  if (baseline.systemPrompt !== current.systemPrompt) {
    diffs.push({
      field: "systemPrompt",
      baseline: baseline.systemPrompt,
      current: current.systemPrompt,
    });
  }

  if (baseline.userPrompt !== current.userPrompt) {
    diffs.push({
      field: "userPrompt",
      baseline: baseline.userPrompt,
      current: current.userPrompt,
    });
  }

  const baselineSchemaStr = JSON.stringify(baseline.schemaJson);
  const currentSchemaStr = JSON.stringify(current.schemaJson);
  if (baselineSchemaStr !== currentSchemaStr) {
    diffs.push({
      field: "schemaJson",
      baseline: baselineSchemaStr,
      current: currentSchemaStr,
    });
  }

  return {
    changed: diffs.length > 0,
    diffs,
  };
}

// ── Snapshot Diff Formatting ────────────────────────────────────────

/**
 * Format a SnapshotDiff as a human-readable string.
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string {
  if (!diff.changed) {
    return "Prompt Snapshot: No changes detected.";
  }

  const lines: string[] = [
    "Prompt Snapshot Diff:",
    `  ${diff.diffs.length} field(s) changed:`,
    "",
  ];

  for (const d of diff.diffs) {
    lines.push(`  Field: ${d.field}`);
    lines.push(`    Baseline: ${truncate(d.baseline, 120)}`);
    lines.push(`    Current:  ${truncate(d.current, 120)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}
