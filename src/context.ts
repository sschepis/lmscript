import type { ChatMessage, ContextStackOptions } from "./types.js";

/**
 * Rough token estimator: ~4 characters per token.
 * For production use, replace with tiktoken or a model-specific tokenizer.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Type for an async summarizer function */
export type SummarizerFn = (messages: ChatMessage[]) => Promise<string>;

/**
 * ContextStack manages a conversation's message history with automatic
 * pruning when token limits are exceeded.
 *
 * This implements the "Stateful Context Management" pillar from the
 * L-Script specification: treating context as a managed memory stack
 * that automatically prunes based on token limits.
 */
export class ContextStack {
  private messages: ChatMessage[] = [];
  private maxTokens: number;
  private pruneStrategy: "fifo" | "summarize";
  private summarizer: SummarizerFn | null = null;

  constructor(options: ContextStackOptions = {}) {
    this.maxTokens = options.maxTokens ?? 4096;
    this.pruneStrategy = options.pruneStrategy ?? "fifo";
  }

  /**
   * Set a summarizer function for the "summarize" pruning strategy.
   * The function receives an array of messages to summarize and should
   * return a summary string.
   */
  setSummarizer(fn: (messages: ChatMessage[]) => Promise<string>): void {
    this.summarizer = fn;
  }

  /** Push a message onto the context stack. */
  async push(message: ChatMessage): Promise<void> {
    this.messages.push(message);
    await this.prune();
  }

  /** Push multiple messages onto the stack. */
  async pushAll(messages: ChatMessage[]): Promise<void> {
    this.messages.push(...messages);
    await this.prune();
  }

  /** Get all messages currently in the stack. */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Get estimated total tokens in the current context. */
  getTokenCount(): number {
    return this.messages.reduce(
      (sum, msg) => sum + estimateTokens(msg.content),
      0
    );
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = [];
  }

  /** Number of messages in the stack. */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Prune messages using the configured strategy when
   * the token count exceeds maxTokens.
   */
  private async prune(): Promise<void> {
    if (this.getTokenCount() <= this.maxTokens) {
      return;
    }

    if (this.pruneStrategy === "summarize" && this.summarizer) {
      await this.pruneSummarize();
    } else {
      this.pruneFIFO();
    }
  }

  /**
   * FIFO pruning: remove the oldest non-system messages first
   * until we're under the token budget.
   */
  private pruneFIFO(): void {
    while (this.getTokenCount() > this.maxTokens && this.messages.length > 1) {
      // Preserve system messages — they anchor the persona
      const firstNonSystemIdx = this.messages.findIndex(
        (m) => m.role !== "system"
      );

      if (firstNonSystemIdx === -1) {
        // Only system messages remain; nothing more to prune
        break;
      }

      this.messages.splice(firstNonSystemIdx, 1);
    }
  }

  /**
   * Summarize pruning: collect oldest non-system messages,
   * summarize them, and replace with a single system summary message.
   */
  private async pruneSummarize(): Promise<void> {
    // Collect non-system messages to summarize
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const nonSystemMessages = this.messages.filter((m) => m.role !== "system");

    if (nonSystemMessages.length <= 1) {
      // Not enough messages to summarize, fall back to FIFO
      this.pruneFIFO();
      return;
    }

    // Take the oldest half of non-system messages to summarize
    const halfIdx = Math.max(1, Math.floor(nonSystemMessages.length / 2));
    const toSummarize = nonSystemMessages.slice(0, halfIdx);
    const toKeep = nonSystemMessages.slice(halfIdx);

    const summary = await this.summarizer!(toSummarize);

    const summaryMessage: ChatMessage = {
      role: "system",
      content: `Previous conversation summary: ${summary}`,
    };

    this.messages = [...systemMessages, summaryMessage, ...toKeep];

    // If still over budget after summarization, fall back to FIFO
    if (this.getTokenCount() > this.maxTokens) {
      this.pruneFIFO();
    }
  }
}
