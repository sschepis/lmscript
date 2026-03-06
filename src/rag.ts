import { z } from "zod";
import type { LScriptFunction, ExecutionResult } from "./types.js";
import type { LScriptRuntime } from "./runtime.js";
import type { EmbeddingProvider, VectorStore, VectorSearchResult } from "./embeddings.js";

/**
 * Configuration for the RAG pipeline.
 */
export interface RAGConfig {
  /** The embedding provider for query embedding */
  embeddingProvider: EmbeddingProvider;

  /** The vector store containing documents */
  vectorStore: VectorStore;

  /** Number of documents to retrieve. Default: 5 */
  topK?: number;

  /** Minimum similarity score (0-1). Documents below this are excluded. Default: 0 */
  minScore?: number;

  /** Embedding model to use. Default: provider's default */
  embeddingModel?: string;

  /** Custom context formatter. Receives retrieved documents and returns context string. */
  formatContext?: (results: VectorSearchResult[]) => string;
}

/**
 * Result from a RAG execution.
 */
export interface RAGResult<T> {
  /** The LLM execution result */
  result: ExecutionResult<T>;

  /** Documents retrieved from the vector store */
  retrievedDocuments: VectorSearchResult[];

  /** The context string injected into the prompt */
  context: string;
}

/**
 * Default context formatter — formats retrieved documents as numbered list.
 */
function defaultFormatContext(results: VectorSearchResult[]): string {
  if (results.length === 0) return "No relevant context found.";

  return results
    .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)})\n${r.document.content}`)
    .join("\n\n");
}

/**
 * RAG (Retrieval-Augmented Generation) pipeline.
 *
 * Workflow:
 * 1. Embed the user's query
 * 2. Search the vector store for relevant documents
 * 3. Format retrieved documents as context
 * 4. Inject context into the LLM function's prompt
 * 5. Execute the augmented function
 */
export class RAGPipeline {
  private config: Required<RAGConfig>;
  private runtime: LScriptRuntime;

  constructor(runtime: LScriptRuntime, config: RAGConfig) {
    this.runtime = runtime;
    this.config = {
      embeddingProvider: config.embeddingProvider,
      vectorStore: config.vectorStore,
      topK: config.topK ?? 5,
      minScore: config.minScore ?? 0,
      embeddingModel: config.embeddingModel ?? "",
      formatContext: config.formatContext ?? defaultFormatContext,
    };
  }

  /**
   * Ingest documents into the vector store.
   * Automatically computes embeddings for each document.
   */
  async ingest(documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): Promise<void> {
    const texts = documents.map(d => d.content);
    const embeddings = await this.config.embeddingProvider.embed(
      texts,
      this.config.embeddingModel || undefined
    );

    const vectorDocs = documents.map((doc, i) => ({
      id: doc.id,
      content: doc.content,
      vector: embeddings[i],
      metadata: doc.metadata,
    }));

    await this.config.vectorStore.add(vectorDocs);
  }

  /**
   * Execute a function with RAG-augmented context.
   *
   * The function's prompt template receives the original input.
   * Retrieved context is prepended to the system message.
   */
  async query<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    input: I,
    queryText?: string
  ): Promise<RAGResult<z.infer<O>>> {
    // 1. Embed the query
    const query = queryText ?? (typeof input === "string" ? input : JSON.stringify(input));
    const [queryVector] = await this.config.embeddingProvider.embed(
      [query],
      this.config.embeddingModel || undefined
    );

    // 2. Search vector store
    const searchResults = await this.config.vectorStore.search(queryVector, this.config.topK);

    // 3. Filter by minimum score
    const filtered = searchResults.filter(r => r.score >= this.config.minScore);

    // 4. Format context
    const context = this.config.formatContext(filtered);

    // 5. Augment the function with context
    const augmentedFn: LScriptFunction<I, O> = {
      ...fn,
      system: `${fn.system}\n\n## Retrieved Context\n\n${context}`,
    };

    // 6. Execute
    const result = await this.runtime.execute(augmentedFn, input);

    return {
      result,
      retrievedDocuments: filtered,
      context,
    };
  }
}
