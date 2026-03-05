import { z } from "zod";
import type { ChatMessage, ExecutionResult, LScriptFunction } from "./types.js";
import type { ContextStack } from "./context.js";
import type { LScriptRuntime } from "./runtime.js";

/**
 * Session manages a multi-turn conversation with an LLM function.
 *
 * Each `send()` call appends the user message and assistant response
 * to the context stack, building a conversation history that is passed
 * to the runtime on every subsequent call.
 */
export class Session<I, O extends z.ZodType> {
  constructor(
    private runtime: LScriptRuntime,
    private fn: LScriptFunction<I, O>,
    private contextStack: ContextStack
  ) {}

  /**
   * Send a message in the conversation.
   * Adds the user prompt and assistant response to the context stack,
   * then returns the validated result.
   */
  async send(input: I): Promise<ExecutionResult<z.infer<O>>> {
    const userContent = this.fn.prompt(input);

    // Add user message to context
    await this.contextStack.push({ role: "user", content: userContent });

    // Get conversation history (excluding the message we just added,
    // since the runtime will build the current user message itself)
    const allMessages = this.contextStack.getMessages();
    // The history is everything except the last user message (which we just pushed)
    const history = allMessages.slice(0, allMessages.length - 1);

    // Execute with conversation history
    const result = await this.runtime.executeWithHistory(this.fn, input, history);

    // Add assistant response to context
    await this.contextStack.push({
      role: "assistant",
      content: JSON.stringify(result.data),
    });

    return result;
  }

  /** Get the full conversation history. */
  getHistory(): ChatMessage[] {
    return this.contextStack.getMessages();
  }

  /** Clear the conversation history. */
  clearHistory(): void {
    this.contextStack.clear();
  }

  /** Get estimated token count of the current context. */
  getTokenCount(): number {
    return this.contextStack.getTokenCount();
  }
}
