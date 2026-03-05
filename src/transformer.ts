import { z } from "zod";
import type { LScriptFunction } from "./types.js";

// ── Output Transformer type ─────────────────────────────────────────

/**
 * An OutputTransformer takes validated LLM output and transforms it
 * into a different shape. Can be sync or async.
 */
export type OutputTransformer<T, U> = (data: T) => U | Promise<U>;

// ── withTransform wrapper ───────────────────────────────────────────

/**
 * Wraps an LScriptFunction with a post-validation transformer.
 */
export function withTransform<I, O extends z.ZodType, U>(
  fn: LScriptFunction<I, O>,
  transformer: OutputTransformer<z.infer<O>, U>
): { fn: LScriptFunction<I, O>; transformer: OutputTransformer<z.infer<O>, U> } {
  return { fn, transformer };
}

// ── Built-in transformers ───────────────────────────────────────────

/**
 * ISO 8601 date pattern for matching date-like strings.
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Recursively finds string fields that look like ISO dates and converts
 * them to Date objects.
 */
export const dateStringTransformer: OutputTransformer<unknown, unknown> = (data: unknown): unknown => {
  if (typeof data === "string" && ISO_DATE_REGEX.test(data)) {
    const parsed = new Date(data);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => dateStringTransformer(item));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = dateStringTransformer(value);
    }
    return result;
  }

  return data;
};

/**
 * Recursively trims all string fields in the data.
 */
export const trimStringsTransformer: OutputTransformer<unknown, unknown> = (data: unknown): unknown => {
  if (typeof data === "string") {
    return data.trim();
  }

  if (Array.isArray(data)) {
    return data.map((item) => trimStringsTransformer(item));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = trimStringsTransformer(value);
    }
    return result;
  }

  return data;
};

/**
 * Composes multiple transformers into a single transformer.
 * Transformers are applied left-to-right (first transformer runs first).
 */
export function composeTransformers<T>(
  ...transformers: Array<OutputTransformer<any, any>>
): OutputTransformer<T, any> {
  return async (data: T) => {
    let result: unknown = data;
    for (const transformer of transformers) {
      result = await Promise.resolve(transformer(result));
    }
    return result;
  };
}
