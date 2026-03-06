import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { RAGPipeline } from '../src/rag';
import type { RAGConfig, RAGResult } from '../src/rag';
import { MemoryVectorStore } from '../src/embeddings';
import type { EmbeddingProvider, VectorSearchResult } from '../src/embeddings';
import type { LScriptFunction, ExecutionResult } from '../src/types';
import type { LScriptRuntime } from '../src/runtime';

// ── Mock Embedding Provider ─────────────────────────────────────────

/**
 * Deterministic embedding provider for testing.
 * Generates embeddings based on simple character-code hashing.
 */
function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    name: 'mock-embeddings',
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(text => {
        // Generate a deterministic 8-dimensional vector from text
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % 8] += text.charCodeAt(i);
        }
        // Normalize to unit vector
        const norm = Math.sqrt(vec.reduce((sum: number, v: number) => sum + v * v, 0));
        return norm > 0 ? vec.map((v: number) => v / norm) : vec;
      });
    },
  };
}

// ── Mock Runtime ────────────────────────────────────────────────────

function createMockRuntime(): LScriptRuntime {
  return {
    execute: vi.fn().mockResolvedValue({
      data: { answer: 'mocked answer' },
      attempts: 1,
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    }),
  } as unknown as LScriptRuntime;
}

// ── Test Function ───────────────────────────────────────────────────

function makeRagFn(): LScriptFunction<string, z.ZodObject<{ answer: z.ZodString }>> {
  return {
    name: 'ragQuery',
    model: 'test-model',
    system: 'You are a helpful assistant.',
    prompt: (input: string) => `Answer: ${input}`,
    schema: z.object({ answer: z.string() }),
    temperature: 0.3,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('RAGPipeline', () => {
  let provider: EmbeddingProvider;
  let store: MemoryVectorStore;
  let runtime: LScriptRuntime;
  let pipeline: RAGPipeline;

  beforeEach(() => {
    provider = createMockEmbeddingProvider();
    store = new MemoryVectorStore();
    runtime = createMockRuntime();
    pipeline = new RAGPipeline(runtime, {
      embeddingProvider: provider,
      vectorStore: store,
      topK: 3,
      minScore: 0,
    });
  });

  // 1. Constructor
  describe('constructor', () => {
    it('accepts embedding provider, vector store, and config', () => {
      const p = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
      });
      expect(p).toBeInstanceOf(RAGPipeline);
    });

    it('accepts optional config fields', () => {
      const p = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
        topK: 10,
        minScore: 0.5,
        embeddingModel: 'custom-model',
        formatContext: (results) => results.map(r => r.document.content).join('\n'),
      });
      expect(p).toBeInstanceOf(RAGPipeline);
    });
  });

  // 2. ingest()
  describe('ingest()', () => {
    it('adds documents to the vector store via embedding provider', async () => {
      await pipeline.ingest([
        { id: 'doc1', content: 'The cat sat on the mat.' },
      ]);

      expect(await store.count()).toBe(1);
    });

    // 3. ingest() multiple
    it('handles multiple documents', async () => {
      await pipeline.ingest([
        { id: 'doc1', content: 'First document about cats.' },
        { id: 'doc2', content: 'Second document about dogs.' },
        { id: 'doc3', content: 'Third document about birds.' },
      ]);

      expect(await store.count()).toBe(3);
    });

    it('preserves document metadata during ingestion', async () => {
      await pipeline.ingest([
        { id: 'doc1', content: 'Document with metadata.', metadata: { source: 'test', page: 1 } },
      ]);

      const results = await store.search(await provider.embed(['query']).then(e => e[0]), 1);
      expect(results[0].document.metadata).toEqual({ source: 'test', page: 1 });
    });

    it('computes embeddings for each document', async () => {
      const embedSpy = vi.spyOn(provider, 'embed');

      await pipeline.ingest([
        { id: 'doc1', content: 'First' },
        { id: 'doc2', content: 'Second' },
      ]);

      expect(embedSpy).toHaveBeenCalledOnce();
      expect(embedSpy).toHaveBeenCalledWith(['First', 'Second'], undefined);
    });
  });

  // 4-7. query()
  describe('query()', () => {
    beforeEach(async () => {
      await pipeline.ingest([
        { id: 'doc1', content: 'Cats are small domesticated mammals.' },
        { id: 'doc2', content: 'Dogs are loyal and friendly companions.' },
        { id: 'doc3', content: 'Birds can fly across continents.' },
        { id: 'doc4', content: 'Cats enjoy sleeping in warm places.' },
      ]);
    });

    // 4. query() — embeds query, searches store, returns results
    it('embeds query, searches store, and returns RAG result', async () => {
      const fn = makeRagFn();
      const result = await pipeline.query(fn, 'Tell me about cats');

      // Should have called runtime.execute with augmented function
      expect(runtime.execute).toHaveBeenCalledOnce();

      // Result should have the expected structure
      expect(result.result).toBeDefined();
      expect(result.retrievedDocuments).toBeDefined();
      expect(result.context).toBeDefined();
      expect(typeof result.context).toBe('string');
    });

    // 5. query() with topK
    it('respects topK config', async () => {
      const topK3Pipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
        topK: 2,
        minScore: 0,
      });

      const fn = makeRagFn();
      const result = await topK3Pipeline.query(fn, 'Tell me about cats');

      // Should retrieve at most 2 documents
      expect(result.retrievedDocuments.length).toBeLessThanOrEqual(2);
    });

    // 6. query() result structure
    it('returns RAGResult with context, retrievedDocuments, and result', async () => {
      const fn = makeRagFn();
      const result = await pipeline.query(fn, 'Tell me about cats');

      // Verify RAGResult structure
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('retrievedDocuments');
      expect(result).toHaveProperty('context');

      // result should be an ExecutionResult
      expect(result.result).toHaveProperty('data');
      expect(result.result).toHaveProperty('attempts');

      // retrievedDocuments should be an array of VectorSearchResult
      expect(Array.isArray(result.retrievedDocuments)).toBe(true);
      for (const doc of result.retrievedDocuments) {
        expect(doc).toHaveProperty('document');
        expect(doc).toHaveProperty('score');
        expect(doc.document).toHaveProperty('id');
        expect(doc.document).toHaveProperty('content');
      }
    });

    // 7. query() augmented context
    it('builds context string from retrieved documents', async () => {
      const fn = makeRagFn();
      const result = await pipeline.query(fn, 'cats');

      // Default formatter uses numbered list with scores
      expect(result.context).toContain('[1]');
      expect(result.context).toContain('score:');
    });

    it('injects context into the system message of the augmented function', async () => {
      const fn = makeRagFn();
      await pipeline.query(fn, 'cats');

      // Verify runtime.execute was called with augmented system prompt
      const executeMock = runtime.execute as ReturnType<typeof vi.fn>;
      const calledFn = executeMock.mock.calls[0][0] as LScriptFunction<string, any>;
      expect(calledFn.system).toContain('## Retrieved Context');
      expect(calledFn.system).toContain(fn.system);
    });

    it('uses queryText parameter when provided', async () => {
      const embedSpy = vi.spyOn(provider, 'embed');
      const fn = makeRagFn();

      await pipeline.query(fn, 'some input', 'custom query text');

      // The embed call for the query should use 'custom query text'
      const queryCalls = embedSpy.mock.calls;
      // Last call should be for the query (not the ingestion)
      const lastCall = queryCalls[queryCalls.length - 1];
      expect(lastCall[0]).toEqual(['custom query text']);
    });
  });

  // 8. Custom context formatting
  describe('custom context formatter', () => {
    it('uses custom formatContext when provided', async () => {
      const customPipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
        topK: 3,
        minScore: 0,
        formatContext: (results: VectorSearchResult[]) =>
          results.map(r => `- ${r.document.content}`).join('\n'),
      });

      await customPipeline.ingest([
        { id: 'doc1', content: 'Custom format test.' },
      ]);

      const fn = makeRagFn();
      const result = await customPipeline.query(fn, 'test');

      expect(result.context).toContain('- Custom format test.');
      // Should NOT have the default format
      expect(result.context).not.toContain('[1]');
    });
  });

  // 9. No results
  describe('no results handling', () => {
    it('handles empty search results gracefully', async () => {
      // Pipeline with high minScore so all results are filtered out
      const strictPipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store, // empty store
        topK: 3,
        minScore: 0,
      });

      const fn = makeRagFn();
      const result = await strictPipeline.query(fn, 'query with no docs');

      expect(result.retrievedDocuments).toEqual([]);
      expect(result.context).toBe('No relevant context found.');
      // Should still call runtime.execute
      expect(runtime.execute).toHaveBeenCalled();
    });

    it('filters out documents below minScore', async () => {
      // Ingest a document, then query with high minScore
      await pipeline.ingest([
        { id: 'doc1', content: 'Some document.' },
      ]);

      const strictPipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
        topK: 5,
        minScore: 0.9999, // very high threshold
      });

      const fn = makeRagFn();
      const result = await strictPipeline.query(fn, 'completely unrelated query about quantum physics');

      // With strict threshold and unrelated query, most docs should be filtered
      // (the mock embeddings might still produce high similarity for some inputs)
      expect(result.retrievedDocuments.every(d => d.score >= 0.9999)).toBe(true);
    });
  });

  // Default config values
  describe('default config values', () => {
    it('defaults topK to 5', async () => {
      const defaultPipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
      });

      // Ingest 7 documents
      const docs = Array.from({ length: 7 }, (_, i) => ({
        id: `doc${i}`,
        content: `Document number ${i} about topic ${i}.`,
      }));
      await defaultPipeline.ingest(docs);

      const fn = makeRagFn();
      const result = await defaultPipeline.query(fn, 'topic');

      // Default topK is 5
      expect(result.retrievedDocuments.length).toBeLessThanOrEqual(5);
    });

    it('defaults minScore to 0', async () => {
      const defaultPipeline = new RAGPipeline(runtime, {
        embeddingProvider: provider,
        vectorStore: store,
      });

      await defaultPipeline.ingest([
        { id: 'doc1', content: 'AAA' },
        { id: 'doc2', content: 'ZZZ' },
      ]);

      const fn = makeRagFn();
      const result = await defaultPipeline.query(fn, 'MMM');

      // With minScore 0, all docs with score >= 0 should be included
      expect(result.retrievedDocuments.length).toBeGreaterThan(0);
    });
  });
});
