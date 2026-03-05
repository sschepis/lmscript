import type { BudgetConfig, ModelPricing } from "./types.js";

/**
 * Custom error thrown when a budget limit is exceeded.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

interface UsageEntry {
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * CostTracker tracks token usage and cost across LLM executions.
 *
 * It accumulates usage per function name and can compute total cost
 * using an optional model pricing map.
 */
export class CostTracker {
  private usageByFn = new Map<string, UsageEntry>();

  /**
   * Record token usage for a given function execution.
   */
  trackUsage(
    fnName: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  ): void {
    const existing = this.usageByFn.get(fnName);
    if (existing) {
      existing.calls += 1;
      existing.promptTokens += usage.promptTokens;
      existing.completionTokens += usage.completionTokens;
      existing.totalTokens += usage.totalTokens;
    } else {
      this.usageByFn.set(fnName, {
        calls: 1,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      });
    }
  }

  /**
   * Get total tokens consumed across all functions.
   */
  getTotalTokens(): number {
    let total = 0;
    for (const entry of this.usageByFn.values()) {
      total += entry.totalTokens;
    }
    return total;
  }

  /**
   * Estimate total cost using optional model pricing.
   * If no pricing is provided, returns 0.
   *
   * Note: This is a simplified calculation that uses the function name
   * as a proxy for model name. For more accurate cost tracking, the
   * model name should be tracked alongside usage.
   */
  getTotalCost(modelPricing?: ModelPricing): number {
    if (!modelPricing) return 0;

    let totalCost = 0;
    for (const [fnName, entry] of this.usageByFn.entries()) {
      const pricing = modelPricing[fnName];
      if (pricing) {
        totalCost +=
          (entry.promptTokens / 1000) * pricing.inputPer1k +
          (entry.completionTokens / 1000) * pricing.outputPer1k;
      }
    }
    return totalCost;
  }

  /**
   * Get usage breakdown grouped by function name.
   */
  getUsageByFunction(): Map<string, UsageEntry> {
    return new Map(this.usageByFn);
  }

  /**
   * Reset all tracked usage data.
   */
  reset(): void {
    this.usageByFn.clear();
  }

  /**
   * Check if a budget would be exceeded by adding the given number of tokens.
   * Throws BudgetExceededError if any limit is violated.
   */
  checkBudget(
    budget: BudgetConfig,
    additionalTokens?: number
  ): void {
    const currentTotal = this.getTotalTokens();

    if (budget.maxTotalTokens !== undefined) {
      const projected = currentTotal + (additionalTokens ?? 0);
      if (projected > budget.maxTotalTokens) {
        throw new BudgetExceededError(
          `Token budget exceeded: ${projected} tokens would exceed limit of ${budget.maxTotalTokens}`
        );
      }
    }

    if (budget.maxTokensPerExecution !== undefined && additionalTokens !== undefined) {
      if (additionalTokens > budget.maxTokensPerExecution) {
        throw new BudgetExceededError(
          `Per-execution token limit exceeded: ${additionalTokens} tokens exceeds limit of ${budget.maxTokensPerExecution}`
        );
      }
    }

    if (budget.maxTotalCost !== undefined && budget.modelPricing) {
      const currentCost = this.getTotalCost(budget.modelPricing);
      if (currentCost > budget.maxTotalCost) {
        throw new BudgetExceededError(
          `Cost budget exceeded: $${currentCost.toFixed(4)} exceeds limit of $${budget.maxTotalCost.toFixed(4)}`
        );
      }
    }
  }
}
