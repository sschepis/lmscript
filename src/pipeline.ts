import type { z } from "zod";
import type {
  LScriptFunction,
  PipelineResult,
  PipelineStepResult,
} from "./types.js";
import type { LScriptRuntime } from "./runtime.js";

/**
 * A pipeline step wraps an LScriptFunction and knows how to
 * transform the previous step's output into its input.
 */
interface PipelineStep {
  fn: LScriptFunction<any, any>;
}

/**
 * Pipeline chains multiple LScriptFunctions where the typed output
 * of one feeds as input to the next.
 *
 * Usage:
 *   const pipeline = Pipeline.from(fn1).pipe(fn2).pipe(fn3);
 *   const result = await pipeline.execute(runtime, initialInput);
 */
export class Pipeline<TInput, TOutput> {
  private steps: PipelineStep[];

  private constructor(steps: PipelineStep[]) {
    this.steps = steps;
  }

  /**
   * Create a pipeline starting with the given function.
   */
  static from<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>
  ): Pipeline<I, z.infer<O>> {
    return new Pipeline<I, z.infer<O>>([{ fn }]);
  }

  /**
   * Append a function to the pipeline. The current pipeline's output type
   * must match the new function's input type.
   */
  pipe<NextO extends z.ZodType>(
    fn: LScriptFunction<TOutput, NextO>
  ): Pipeline<TInput, z.infer<NextO>> {
    return new Pipeline<TInput, z.infer<NextO>>([...this.steps, { fn }]);
  }

  /**
   * Execute the pipeline sequentially, passing each step's output
   * as input to the next step.
   */
  async execute(
    runtime: LScriptRuntime,
    initialInput: TInput
  ): Promise<PipelineResult<TOutput>> {
    const stepResults: PipelineStepResult[] = [];
    const totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    let currentInput: unknown = initialInput;

    for (const step of this.steps) {
      const result = await runtime.execute(step.fn, currentInput);

      const stepResult: PipelineStepResult = {
        name: step.fn.name,
        data: result.data,
        attempts: result.attempts,
        usage: result.usage,
      };
      stepResults.push(stepResult);

      if (result.usage) {
        totalUsage.promptTokens += result.usage.promptTokens;
        totalUsage.completionTokens += result.usage.completionTokens;
        totalUsage.totalTokens += result.usage.totalTokens;
      }

      currentInput = result.data;
    }

    return {
      finalData: currentInput as TOutput,
      steps: stepResults,
      totalUsage,
    };
  }
}
