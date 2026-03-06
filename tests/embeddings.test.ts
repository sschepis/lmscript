import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity, MemoryVectorStore } from '../src/embeddings';
import type { VectorDocument } from '../src/embeddings';

// ── cosineSimilarity Tests ──────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns 1.0 for parallel vectors with different magnitudes', () => {
    const a = [1, 0, 0];
    const b = [5, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it('returns a value between 0 and 1 for similar vectors', () => {
    const a = [1, 1, 0];
    const b = [1, 0, 0];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
    // cos(45°) ≈ 0.7071
    expect(sim).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('returns 0 for zero-magnitude vectors (empty/zero vectors)', () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
  });

  it('throws for different length vectors', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector dimension mismatch');
  });

  it('handles high-dimensional vectors', () => {
    const dim = 1536;
    const a = Array.from({ length: dim }, (_, i) => Math.sin(i));
    const b = Array.from({ length: dim }, (_, i) => Math.sin(i + 0.1));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9); // nearly parallel
    expect(sim).toBeLessThanOrEqual(1.0);
  });
});

// ── MemoryVectorStore Tests ─────────────────────────────────────────

describe('MemoryVectorStore', () => {
  let store: MemoryVectorStore;

  beforeEach(() => {
    store = new MemoryVectorStore();
  });

  function makeDoc(id: string, vector: number[], content?: string, metadata?: Record<string, unknown>): VectorDocument {
    return { id, content: content ?? `Content for ${id}`, vector, metadata };
  }

  // 1. add()
  describe('add()', () => {
    it('adds a document with embedding', async () => {
      await store.add([makeDoc('d1', [1, 0, 0])]);
      expect(await store.count()).toBe(1);
    });

    it('adds multiple documents', async () => {
      await store.add([
        makeDoc('d1', [1, 0, 0]),
        makeDoc('d2', [0, 1, 0]),
        makeDoc('d3', [0, 0, 1]),
      ]);
      expect(await store.count()).toBe(3);
    });

    it('overwrites document with same id', async () => {
      await store.add([makeDoc('d1', [1, 0, 0], 'original')]);
      await store.add([makeDoc('d1', [0, 1, 0], 'updated')]);

      expect(await store.count()).toBe(1);
      const results = await store.search([0, 1, 0], 1);
      expect(results[0].document.content).toBe('updated');
    });
  });

  // 2. search() — returns closest matches
  describe('search()', () => {
    it('returns closest matches by cosine similarity', async () => {
      await store.add([
        makeDoc('d1', [1, 0, 0]),
        makeDoc('d2', [0, 1, 0]),
        makeDoc('d3', [0.9, 0.1, 0]),
      ]);

      const results = await store.search([1, 0, 0], 2);

      expect(results).toHaveLength(2);
      // d1 is exact match (similarity 1.0), d3 is close
      expect(results[0].document.id).toBe('d1');
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[1].document.id).toBe('d3');
    });

    // 3. search() with topK
    it('returns at most topK results', async () => {
      await store.add([
        makeDoc('d1', [1, 0, 0]),
        makeDoc('d2', [0, 1, 0]),
        makeDoc('d3', [0, 0, 1]),
        makeDoc('d4', [1, 1, 0]),
        makeDoc('d5', [1, 1, 1]),
      ]);

      const results = await store.search([1, 0, 0], 3);
      expect(results).toHaveLength(3);
    });

    it('defaults topK to 5', async () => {
      // Add 7 documents
      const docs = Array.from({ length: 7 }, (_, i) => {
        const vec = [0, 0, 0];
        vec[i % 3] = 1;
        return makeDoc(`d${i}`, vec);
      });
      await store.add(docs);

      const results = await store.search([1, 0, 0]);
      expect(results).toHaveLength(5);
    });

    // 4. search() ordering
    it('results are sorted by similarity descending', async () => {
      await store.add([
        makeDoc('low', [0, 0, 1]),          // orthogonal to query
        makeDoc('mid', [0.5, 0.5, 0]),      // moderate similarity
        makeDoc('high', [1, 0, 0]),          // exact match
      ]);

      const results = await store.search([1, 0, 0], 3);

      expect(results[0].document.id).toBe('high');
      expect(results[1].document.id).toBe('mid');
      expect(results[2].document.id).toBe('low');

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    // 5. search() — can filter by threshold manually (store doesn't filter, but results have scores)
    it('results include similarity scores for threshold filtering', async () => {
      await store.add([
        makeDoc('close', [0.95, 0.05, 0]),
        makeDoc('far', [0, 0, 1]),
      ]);

      const results = await store.search([1, 0, 0], 10);
      const filtered = results.filter(r => r.score > 0.5);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].document.id).toBe('close');
    });

    // 6. Multiple documents
    it('stores and searches across many documents', async () => {
      const docs: VectorDocument[] = [];
      for (let i = 0; i < 50; i++) {
        const vec = Array.from({ length: 10 }, () => Math.random());
        docs.push(makeDoc(`d${i}`, vec));
      }
      await store.add(docs);

      expect(await store.count()).toBe(50);

      const queryVec = Array.from({ length: 10 }, () => Math.random());
      const results = await store.search(queryVec, 5);

      expect(results).toHaveLength(5);
      // All results should have scores
      for (const r of results) {
        expect(typeof r.score).toBe('number');
        expect(r.document.content).toBeDefined();
      }
    });

    it('returns empty array when store is empty', async () => {
      const results = await store.search([1, 0, 0], 5);
      expect(results).toEqual([]);
    });
  });

  // 7. clear()
  describe('clear()', () => {
    it('removes all stored documents', async () => {
      await store.add([
        makeDoc('d1', [1, 0, 0]),
        makeDoc('d2', [0, 1, 0]),
      ]);
      expect(await store.count()).toBe(2);

      await store.clear();
      expect(await store.count()).toBe(0);

      const results = await store.search([1, 0, 0]);
      expect(results).toEqual([]);
    });
  });

  // 8. Metadata
  describe('metadata', () => {
    it('preserves metadata on stored documents', async () => {
      const metadata = { source: 'wiki', page: 42, tags: ['test'] };
      await store.add([makeDoc('d1', [1, 0, 0], 'With metadata', metadata)]);

      const results = await store.search([1, 0, 0], 1);
      expect(results[0].document.metadata).toEqual(metadata);
    });

    it('allows documents without metadata', async () => {
      await store.add([makeDoc('d1', [1, 0, 0])]);
      const results = await store.search([1, 0, 0], 1);
      expect(results[0].document.metadata).toBeUndefined();
    });
  });

  // delete()
  describe('delete()', () => {
    it('removes documents by id', async () => {
      await store.add([
        makeDoc('d1', [1, 0, 0]),
        makeDoc('d2', [0, 1, 0]),
        makeDoc('d3', [0, 0, 1]),
      ]);

      await store.delete(['d1', 'd3']);
      expect(await store.count()).toBe(1);

      const results = await store.search([1, 0, 0], 5);
      expect(results).toHaveLength(1);
      expect(results[0].document.id).toBe('d2');
    });

    it('silently ignores non-existent ids', async () => {
      await store.add([makeDoc('d1', [1, 0, 0])]);
      await store.delete(['nonexistent']);
      expect(await store.count()).toBe(1);
    });
  });

  // count()
  describe('count()', () => {
    it('returns 0 for empty store', async () => {
      expect(await store.count()).toBe(0);
    });

    it('reflects accurate document count after operations', async () => {
      await store.add([makeDoc('d1', [1, 0, 0]), makeDoc('d2', [0, 1, 0])]);
      expect(await store.count()).toBe(2);

      await store.delete(['d1']);
      expect(await store.count()).toBe(1);

      await store.clear();
      expect(await store.count()).toBe(0);
    });
  });
});
