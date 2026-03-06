import { z } from "zod";
import type { LScriptFunction, ToolCall } from "./types.js";
import type { LScriptRuntime } from "./runtime.js";

// ── Agent Loop Configuration ────────────────────────────────────────

export interface AgentConfig {
  /** Maximum number of LLM call iterations (including the initial call). Default: 10 */
  maxIterations?: number;

  /** Called after each tool execution with the tool call and result. Return false to stop early. */
  onToolCall?: (toolCall: ToolCall) => void | boolean | Promise<void | boolean>;

  /** Called after each LLM response. Return false to stop the loop early. */
  onIteration?: (iteration: number, response: string) => void | boolean | Promise<void | boolean>;
}

// ── Agent Loop Result ───────────────────────────────────────────────

export interface AgentResult<T> {
  /** The final validated, typed output */
  data: T;

  /** All tool calls made across all iterations */
  toolCalls: ToolCall[];

  /** Number of LLM call iterations used */
  iterations: number;

  /** Total token usage across all iterations */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ── Agent Loop ──────────────────────────────────────────────────────

/**
 * AgentLoop provides iterative tool-calling execution.
 *
 * Unlike single-shot `execute()`, the agent loop repeatedly calls the LLM
 * until it produces a final text response (no more tool calls) or
 * `maxIterations` is reached.
 */
export class AgentLoop {
  constructor(
    private runtime: LScriptRuntime,
    private config?: AgentConfig
  ) {}

  /**
   * Execute a function with iterative tool calling.
   * The LLM is called repeatedly until it produces a response without tool calls,
   * or maxIterations is reached.
   */
  async run<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I
  ): Promise<AgentResult<z.infer<O>>> {
    return this.runtime.executeAgent(fn, input, this.config);
  }
}
