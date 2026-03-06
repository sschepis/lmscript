/**
 * Interface for embedding providers.
 */
export interface EmbeddingProvider {
  readonly name: string;

  /**
   * Generate embeddings for one or more texts.
   * @param texts Array of strings to embed
   * @param model Optional model identifier
   * @returns Array of embedding vectors (number arrays)
   */
  embed(texts: string[], model?: string): Promise<number[][]>;
}

/**
 * A document stored in the vector store with its embedding.
 */
export interface VectorDocument {
  /** Unique identifier */
  id: string;
  /** The text content */
  content: string;
  /** The embedding vector */
  vector: number[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Search result from a vector query.
 */
export interface VectorSearchResult {
  /** The matched document */
  document: VectorDocument;
  /** Similarity score (0-1, higher is better) */
  score: number;
}

/**
 * Interface for vector stores.
 */
export interface VectorStore {
  /**
   * Add documents to the store.
   */
  add(documents: VectorDocument[]): Promise<void>;

  /**
   * Search for similar documents given a query vector.
   * @param queryVector The query embedding
   * @param topK Number of results to return
   * @returns Sorted results by similarity (highest first)
   */
  search(queryVector: number[], topK?: number): Promise<VectorSearchResult[]>;

  /**
   * Delete documents by ID.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Get total document count.
   */
  count(): Promise<number>;

  /**
   * Clear all documents.
   */
  clear(): Promise<void>;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * In-memory vector store using brute-force cosine similarity search.
 * Suitable for small-to-medium document collections (< 100k documents).
 */
export class MemoryVectorStore implements VectorStore {
  private documents: Map<string, VectorDocument> = new Map();

  async add(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
  }

  async search(queryVector: number[], topK: number = 5): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = [];

    for (const doc of this.documents.values()) {
      const score = cosineSimilarity(queryVector, doc.vector);
      results.push({ document: doc, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  async count(): Promise<number> {
    return this.documents.size;
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}
