import { z } from "zod";
import type { LLMProvider, LLMRequest, LLMResponse } from "../types.js";

// ── Chaos Configuration ─────────────────────────────────────────────

export interface ChaosConfig {
  /** Wrapped provider */
  provider: LLMProvider;
  /** Probability of returning malformed JSON (0-1) */
  malformedJsonRate?: number;
  /** Probability of returning partial response (0-1) */
  partialResponseRate?: number;
  /** Probability of timeout/hang (0-1) */
  timeoutRate?: number;
  /** Probability of returning wrong schema (0-1) */
  wrongSchemaRate?: number;
  /** Timeout duration in ms */
  timeoutMs?: number;
}

// ── Chaos Provider ──────────────────────────────────────────────────

export class ChaosProvider implements LLMProvider {
  readonly name = "chaos";

  private config: ChaosConfig;

  constructor(config: ChaosConfig) {
    this.config = {
      ...config,
      malformedJsonRate: config.malformedJsonRate ?? 0,
      partialResponseRate: config.partialResponseRate ?? 0,
      timeoutRate: config.timeoutRate ?? 0,
      wrongSchemaRate: config.wrongSchemaRate ?? 0,
      timeoutMs: config.timeoutMs ?? 30000,
    };
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Roll dice for each chaos scenario

    // Timeout — hang then throw
    if (this.config.timeoutRate! > 0 && Math.random() < this.config.timeoutRate!) {
      await new Promise((resolve) => setTimeout(resolve, this.config.timeoutMs));
      throw new Error("[ChaosProvider] Simulated timeout");
    }

    // Malformed JSON
    if (this.config.malformedJsonRate! > 0 && Math.random() < this.config.malformedJsonRate!) {
      return {
        content: '"{invalid json',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      };
    }

    // Get real response from wrapped provider
    const response = await this.config.provider.chat(request);

    // Partial response — truncate the content
    if (this.config.partialResponseRate! > 0 && Math.random() < this.config.partialResponseRate!) {
      const half = Math.floor(response.content.length / 2);
      return {
        ...response,
        content: response.content.slice(0, half),
      };
    }

    // Wrong schema — return valid JSON but with wrong field names
    if (this.config.wrongSchemaRate! > 0 && Math.random() < this.config.wrongSchemaRate!) {
      return {
        ...response,
        content: JSON.stringify({
          _chaos_wrong_field_1: "unexpected_value",
          _chaos_wrong_field_2: 42,
          _chaos_wrong_field_3: true,
        }),
      };
    }

    // No chaos — pass through
    return response;
  }
}

// ── Fuzz Input Generator ────────────────────────────────────────────

/**
 * Generate random inputs that intentionally violate the given schema
 * in various ways — wrong types, missing fields, extra fields, boundary values.
 */
export function generateFuzzInputs(
  schema: z.ZodType,
  count: number
): unknown[] {
  const results: unknown[] = [];

  const strategies = [
    () => generateWrongTypes(schema),
    () => generateMissingFields(schema),
    () => generateExtraFields(schema),
    () => generateBoundaryValues(schema),
    () => generateNullUndefined(),
    () => generatePrimitiveInsteadOfObject(),
  ];

  for (let i = 0; i < count; i++) {
    const strategy = strategies[i % strategies.length];
    results.push(strategy());
  }

  return results;
}

function generateWrongTypes(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const result: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = wrongTypeFor(fieldSchema as z.ZodType);
    }

    return result;
  }

  return wrongTypeFor(schema);
}

function wrongTypeFor(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodString) return 12345;
  if (schema instanceof z.ZodNumber) return "not_a_number";
  if (schema instanceof z.ZodBoolean) return "not_a_boolean";
  if (schema instanceof z.ZodArray) return "not_an_array";
  if (schema instanceof z.ZodObject) return "not_an_object";
  if (schema instanceof z.ZodOptional) return wrongTypeFor((schema as z.ZodOptional<z.ZodType>)._def.innerType);
  return { _unexpected: true };
}

function generateMissingFields(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const keys = Object.keys(shape);

    // Return object with roughly half the fields missing
    const result: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      if (i % 2 === 0) {
        // Include this field with correct type placeholder
        result[keys[i]] = "placeholder";
      }
      // Skip odd-indexed fields to simulate missing
    }

    return result;
  }

  return {};
}

function generateExtraFields(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const result: Record<string, unknown> = {};

    // Include all schema fields with plausible values
    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = plausibleValueFor(fieldSchema as z.ZodType);
    }

    // Add extra unexpected fields
    result["__fuzz_extra_1"] = "unexpected";
    result["__fuzz_extra_2"] = 99999;
    result["__fuzz_extra_3"] = [1, 2, 3];

    return result;
  }

  return { __fuzz_extra: true };
}

function generateBoundaryValues(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const result: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = boundaryValueFor(fieldSchema as z.ZodType);
    }

    return result;
  }

  return boundaryValueFor(schema);
}

function generateNullUndefined(): unknown {
  return Math.random() > 0.5 ? null : undefined;
}

function generatePrimitiveInsteadOfObject(): unknown {
  const primitives = [42, "just a string", true, 0, -1, ""];
  return primitives[Math.floor(Math.random() * primitives.length)];
}

function plausibleValueFor(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodString) return "test";
  if (schema instanceof z.ZodNumber) return 0;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodArray) return [];
  if (schema instanceof z.ZodOptional) return plausibleValueFor((schema as z.ZodOptional<z.ZodType>)._def.innerType);
  return "unknown";
}

function boundaryValueFor(schema: z.ZodType): unknown {
  if (schema instanceof z.ZodString) return "";
  if (schema instanceof z.ZodNumber) return -Number.MAX_SAFE_INTEGER;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodArray) return [];
  if (schema instanceof z.ZodOptional) return boundaryValueFor((schema as z.ZodOptional<z.ZodType>)._def.innerType);
  return null;
}
