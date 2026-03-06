import { z } from "zod";
import type { LScriptFunction, ExecutionResult } from "./types.js";

/**
 * A prompt variant defines an alternative prompt/system/temperature configuration
 * for an existing LScriptFunction.
 */
export interface PromptVariant<I = unknown> {
  /** Unique name for this variant (e.g., "control", "concise", "detailed") */
  name: string;

  /** Optional override for the prompt template */
  prompt?: (input: I) => string;

  /** Optional override for the system message */
  system?: string;

  /** Optional override for temperature */
  temperature?: number;

  /** Optional override for model */
  model?: string;

  /** Weight for random selection (higher = more likely). Default: 1 */
  weight?: number;
}

/**
 * Tracks results for each variant for comparison.
 */
export interface VariantMetrics {
  /** Variant name */
  name: string;
  /** Number of executions */
  executions: number;
  /** Number of successful executions (valid schema) */
  successes: number;
  /** Average number of attempts (retries) per execution */
  avgAttempts: number;
  /** Average total tokens per execution */
  avgTokens: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Selection strategy for choosing which variant to use.
 */
export type SelectionStrategy = "random" | "round-robin" | "weighted";

/**
 * Configuration for the PromptRegistry.
 */
export interface PromptRegistryConfig {
  /** How to select variants when multiple are available. Default: "weighted" */
  strategy?: SelectionStrategy;
}

/**
 * PromptRegistry manages prompt variants and tracks their performance.
 */
export class PromptRegistry {
  private variants: Map<string, PromptVariant[]> = new Map(); // key: function name
  private metrics: Map<string, Map<string, {
    executions: number;
    successes: number;
    totalAttempts: number;
    totalTokens: number;
  }>> = new Map(); // key: function name -> variant name -> metrics
  private roundRobinIndex: Map<string, number> = new Map();
  private strategy: SelectionStrategy;

  constructor(config?: PromptRegistryConfig) {
    this.strategy = config?.strategy ?? "weighted";
  }

  /**
   * Register variants for a function.
   */
  registerVariants<I>(functionName: string, variants: PromptVariant<I>[]): void {
    this.variants.set(functionName, variants as PromptVariant[]);
    const metricsMap = new Map();
    for (const v of variants) {
      metricsMap.set(v.name, { executions: 0, successes: 0, totalAttempts: 0, totalTokens: 0 });
    }
    this.metrics.set(functionName, metricsMap);
  }

  /**
   * Select a variant for a function based on the strategy.
   * Returns undefined if no variants are registered.
   */
  selectVariant(functionName: string): PromptVariant | undefined {
    const variants = this.variants.get(functionName);
    if (!variants || variants.length === 0) return undefined;

    switch (this.strategy) {
      case "round-robin": {
        const idx = (this.roundRobinIndex.get(functionName) ?? 0) % variants.length;
        this.roundRobinIndex.set(functionName, idx + 1);
        return variants[idx];
      }
      case "random": {
        return variants[Math.floor(Math.random() * variants.length)];
      }
      case "weighted":
      default: {
        const totalWeight = variants.reduce((sum, v) => sum + (v.weight ?? 1), 0);
        let random = Math.random() * totalWeight;
        for (const v of variants) {
          random -= (v.weight ?? 1);
          if (random <= 0) return v;
        }
        return variants[variants.length - 1];
      }
    }
  }

  /**
   * Apply a variant to a function, producing a new function with the variant's overrides.
   */
  applyVariant<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    variant: PromptVariant<I>
  ): LScriptFunction<I, O> {
    return {
      ...fn,
      name: `${fn.name}[${variant.name}]`,
      ...(variant.prompt && { prompt: variant.prompt }),
      ...(variant.system && { system: variant.system }),
      ...(variant.temperature !== undefined && { temperature: variant.temperature }),
      ...(variant.model && { model: variant.model }),
    };
  }

  /**
   * Record the result of an execution for a variant.
   */
  recordResult(functionName: string, variantName: string, result: ExecutionResult<unknown>): void {
    const fnMetrics = this.metrics.get(functionName);
    if (!fnMetrics) return;
    const m = fnMetrics.get(variantName);
    if (!m) return;

    m.executions++;
    m.successes++; // If we got here, schema validation passed
    m.totalAttempts += result.attempts;
    m.totalTokens += result.usage?.totalTokens ?? 0;
  }

  /**
   * Record a failed execution for a variant.
   */
  recordFailure(functionName: string, variantName: string): void {
    const fnMetrics = this.metrics.get(functionName);
    if (!fnMetrics) return;
    const m = fnMetrics.get(variantName);
    if (!m) return;
    m.executions++;
  }

  /**
   * Get metrics for all variants of a function.
   */
  getMetrics(functionName: string): VariantMetrics[] {
    const fnMetrics = this.metrics.get(functionName);
    if (!fnMetrics) return [];

    const results: VariantMetrics[] = [];
    for (const [name, m] of fnMetrics) {
      results.push({
        name,
        executions: m.executions,
        successes: m.successes,
        avgAttempts: m.executions > 0 ? m.totalAttempts / m.executions : 0,
        avgTokens: m.executions > 0 ? m.totalTokens / m.executions : 0,
        totalTokens: m.totalTokens,
        successRate: m.executions > 0 ? m.successes / m.executions : 0,
      });
    }
    return results;
  }

  /**
   * Get the best-performing variant for a function by success rate, then by avg tokens (lower is better).
   */
  getBestVariant(functionName: string): VariantMetrics | undefined {
    const metrics = this.getMetrics(functionName);
    if (metrics.length === 0) return undefined;

    return metrics
      .filter(m => m.executions > 0)
      .sort((a, b) => {
        if (b.successRate !== a.successRate) return b.successRate - a.successRate;
        return a.avgTokens - b.avgTokens;
      })[0];
  }

  /**
   * Reset all metrics.
   */
  resetMetrics(): void {
    for (const [fnName, fnMetrics] of this.metrics) {
      for (const [varName] of fnMetrics) {
        fnMetrics.set(varName, { executions: 0, successes: 0, totalAttempts: 0, totalTokens: 0 });
      }
    }
    this.roundRobinIndex.clear();
  }

  /**
   * Check if variants are registered for a function.
   */
  hasVariants(functionName: string): boolean {
    const v = this.variants.get(functionName);
    return v !== undefined && v.length > 0;
  }
}
