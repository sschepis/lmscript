import { z } from "zod";

// ── Schema Diff Types ───────────────────────────────────────────────

export interface SchemaDiff {
  path: string;
  expected: string;
  actual: string;
  issue: "missing" | "type_mismatch" | "constraint_violation" | "extra_field";
}

// ── Schema Diff Logic ───────────────────────────────────────────────

/**
 * Compare an actual value against a Zod schema and return field-by-field diffs.
 */
export function diffSchemaResult(
  schema: z.ZodType,
  actual: unknown
): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];
  diffRecursive(schema, actual, "", diffs);
  return diffs;
}

function getZodTypeName(schema: z.ZodType): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodArray) return "array";
  if (schema instanceof z.ZodObject) return "object";
  if (schema instanceof z.ZodEnum) return "enum";
  if (schema instanceof z.ZodLiteral) return "literal";
  if (schema instanceof z.ZodUnion) return "union";
  if (schema instanceof z.ZodOptional) return getZodTypeName((schema as z.ZodOptional<z.ZodType>)._def.innerType) + "?";
  if (schema instanceof z.ZodNullable) return getZodTypeName((schema as z.ZodNullable<z.ZodType>)._def.innerType) + " | null";
  if (schema instanceof z.ZodDefault) return getZodTypeName((schema as z.ZodDefault<z.ZodType>)._def.innerType);
  return "unknown";
}

function getActualTypeName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function diffRecursive(
  schema: z.ZodType,
  actual: unknown,
  path: string,
  diffs: SchemaDiff[]
): void {
  // Unwrap ZodDefault
  if (schema instanceof z.ZodDefault) {
    diffRecursive((schema as z.ZodDefault<z.ZodType>)._def.innerType, actual, path, diffs);
    return;
  }

  // Unwrap ZodOptional — if the value is undefined, it's fine
  if (schema instanceof z.ZodOptional) {
    if (actual === undefined) return;
    diffRecursive((schema as z.ZodOptional<z.ZodType>)._def.innerType, actual, path, diffs);
    return;
  }

  // Unwrap ZodNullable — if the value is null, it's fine
  if (schema instanceof z.ZodNullable) {
    if (actual === null) return;
    diffRecursive((schema as z.ZodNullable<z.ZodType>)._def.innerType, actual, path, diffs);
    return;
  }

  // Handle ZodObject — recurse into fields
  if (schema instanceof z.ZodObject) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      diffs.push({
        path: path || ".",
        expected: "object",
        actual: getActualTypeName(actual),
        issue: "type_mismatch",
      });
      return;
    }

    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const actualObj = actual as Record<string, unknown>;

    // Check each expected field
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldPath = path ? `${path}.${key}` : `.${key}`;

      if (!(key in actualObj)) {
        // Check if field is optional
        if (fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault) {
          continue; // optional/default fields can be missing
        }
        diffs.push({
          path: fieldPath,
          expected: getZodTypeName(fieldSchema as z.ZodType),
          actual: "-",
          issue: "missing",
        });
      } else {
        diffRecursive(fieldSchema as z.ZodType, actualObj[key], fieldPath, diffs);
      }
    }

    // Check for extra fields (not in schema)
    const schemaKeys = new Set(Object.keys(shape));
    for (const key of Object.keys(actualObj)) {
      if (!schemaKeys.has(key)) {
        const fieldPath = path ? `${path}.${key}` : `.${key}`;
        diffs.push({
          path: fieldPath,
          expected: "-",
          actual: getActualTypeName(actualObj[key]),
          issue: "extra_field",
        });
      }
    }

    return;
  }

  // Handle ZodArray
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(actual)) {
      diffs.push({
        path: path || ".",
        expected: "array",
        actual: getActualTypeName(actual),
        issue: "type_mismatch",
      });
      return;
    }

    // Check array constraints
    const def = (schema as z.ZodArray<z.ZodType>)._def;
    if (def.minLength !== null && actual.length < def.minLength.value) {
      diffs.push({
        path: path || ".",
        expected: `array (min: ${def.minLength.value})`,
        actual: `array (length: ${actual.length})`,
        issue: "constraint_violation",
      });
    }
    if (def.maxLength !== null && actual.length > def.maxLength.value) {
      diffs.push({
        path: path || ".",
        expected: `array (max: ${def.maxLength.value})`,
        actual: `array (length: ${actual.length})`,
        issue: "constraint_violation",
      });
    }

    // Check each element against the item schema
    const itemSchema = def.type;
    for (let i = 0; i < actual.length; i++) {
      diffRecursive(itemSchema, actual[i], `${path}[${i}]`, diffs);
    }
    return;
  }

  // Handle primitive types — check type match
  const expectedType = getZodTypeName(schema);
  const actualType = getActualTypeName(actual);

  // Type checks
  if (schema instanceof z.ZodString) {
    if (typeof actual !== "string") {
      diffs.push({ path: path || ".", expected: "string", actual: actualType, issue: "type_mismatch" });
      return;
    }
    // Check string constraints
    checkStringConstraints(schema, actual, path, diffs);
    return;
  }

  if (schema instanceof z.ZodNumber) {
    if (typeof actual !== "number") {
      diffs.push({ path: path || ".", expected: "number", actual: actualType, issue: "type_mismatch" });
      return;
    }
    // Check number constraints
    checkNumberConstraints(schema, actual, path, diffs);
    return;
  }

  if (schema instanceof z.ZodBoolean) {
    if (typeof actual !== "boolean") {
      diffs.push({ path: path || ".", expected: "boolean", actual: actualType, issue: "type_mismatch" });
    }
    return;
  }

  // Generic fallback: use safeParse for anything else
  const result = schema.safeParse(actual);
  if (!result.success) {
    diffs.push({
      path: path || ".",
      expected: expectedType,
      actual: actualType,
      issue: "type_mismatch",
    });
  }
}

function checkStringConstraints(
  schema: z.ZodString,
  value: string,
  path: string,
  diffs: SchemaDiff[]
): void {
  const checks = schema._def.checks;
  for (const check of checks) {
    if (check.kind === "min" && value.length < check.value) {
      diffs.push({
        path: path || ".",
        expected: `string (min length: ${check.value})`,
        actual: `string (length: ${value.length})`,
        issue: "constraint_violation",
      });
    }
    if (check.kind === "max" && value.length > check.value) {
      diffs.push({
        path: path || ".",
        expected: `string (max length: ${check.value})`,
        actual: `string (length: ${value.length})`,
        issue: "constraint_violation",
      });
    }
  }
}

function checkNumberConstraints(
  schema: z.ZodNumber,
  value: number,
  path: string,
  diffs: SchemaDiff[]
): void {
  const checks = schema._def.checks;
  for (const check of checks) {
    if (check.kind === "min") {
      const valid = check.inclusive ? value >= check.value : value > check.value;
      if (!valid) {
        diffs.push({
          path: path || ".",
          expected: `number (min: ${check.value})`,
          actual: `${value}`,
          issue: "constraint_violation",
        });
      }
    }
    if (check.kind === "max") {
      const valid = check.inclusive ? value <= check.value : value < check.value;
      if (!valid) {
        diffs.push({
          path: path || ".",
          expected: `number (max: ${check.value})`,
          actual: `${value}`,
          issue: "constraint_violation",
        });
      }
    }
  }
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format diffs as a readable table string.
 */
export function formatSchemaDiff(diffs: SchemaDiff[]): string {
  if (diffs.length === 0) {
    return "Schema Validation Diff: No differences found.";
  }

  // Calculate column widths
  const headers = { path: "Path", issue: "Issue", expected: "Expected", actual: "Actual" };
  let pathW = headers.path.length;
  let issueW = headers.issue.length;
  let expectedW = headers.expected.length;
  let actualW = headers.actual.length;

  for (const d of diffs) {
    pathW = Math.max(pathW, d.path.length);
    issueW = Math.max(issueW, d.issue.length);
    expectedW = Math.max(expectedW, d.expected.length);
    actualW = Math.max(actualW, d.actual.length);
  }

  const pad = (s: string, w: number) => s.padEnd(w);
  const line = (l: string, c: string, m: string, r: string) =>
    `${l}${"─".repeat(pathW + 2)}${c}${"─".repeat(issueW + 2)}${c}${"─".repeat(expectedW + 2)}${c}${"─".repeat(actualW + 2)}${r}`;

  const lines: string[] = [
    "Schema Validation Diff:",
    line("┌", "┬", "┬", "┐"),
    `│ ${pad(headers.path, pathW)} │ ${pad(headers.issue, issueW)} │ ${pad(headers.expected, expectedW)} │ ${pad(headers.actual, actualW)} │`,
    line("├", "┼", "┼", "┤"),
  ];

  for (const d of diffs) {
    lines.push(
      `│ ${pad(d.path, pathW)} │ ${pad(d.issue, issueW)} │ ${pad(d.expected, expectedW)} │ ${pad(d.actual, actualW)} │`
    );
  }

  lines.push(line("└", "┴", "┴", "┘"));

  return lines.join("\n");
}
