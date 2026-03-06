/**
 * Example: RAG Pipeline — Retrieval-Augmented Generation
 *
 * Demonstrates:
 *   - MemoryVectorStore for in-memory document storage
 *   - Custom EmbeddingProvider (mock random vectors for demo)
 *   - RAGPipeline for ingesting documents and querying with context
 *   - Similarity scores in retrieval results
 *   - Augmented prompt construction
 *
 * Usage:
 *   npx tsx src/examples/rag-pipeline-demo.ts
 */

import { z } from "zod";
import {
  LScriptRuntime,
  MemoryVectorStore,
  RAGPipeline,
  cosineSimilarity,
} from "../index.js";
import type {
  EmbeddingProvider,
  RAGConfig,
  LScriptFunction,
} from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── 1. Create a mock embedding provider ─────────────────────────────

/**
 * A deterministic mock embedding provider for demo purposes.
 * Uses a simple hash-based approach so identical texts produce identical vectors
 * and similar texts produce somewhat similar vectors.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock-embeddings";
  private dimension: number;

  constructor(dimension: number = 64) {
    this.dimension = dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashToVector(text));
  }

  /**
   * Simple deterministic hash → vector. Words contribute to specific dimensions.
   */
  private hashToVector(text: string): number[] {
    const vec = new Array(this.dimension).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const idx = (word.charCodeAt(i) * (i + 1)) % this.dimension;
        vec[idx] += 1;
      }
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0)) || 1;
    return vec.map((v: number) => v / norm);
  }
}

// ── 2. Sample knowledge base documents ──────────────────────────────

const documents = [
  {
    id: "doc-1",
    content: "TypeScript is a strongly typed programming language that builds on JavaScript. " +
      "It adds optional static typing and class-based object-oriented programming.",
    metadata: { topic: "typescript", source: "docs" },
  },
  {
    id: "doc-2",
    content: "React is a JavaScript library for building user interfaces. " +
      "It uses a virtual DOM for efficient rendering and component-based architecture.",
    metadata: { topic: "react", source: "docs" },
  },
  {
    id: "doc-3",
    content: "Node.js is a JavaScript runtime built on Chrome's V8 engine. " +
      "It enables server-side JavaScript and is widely used for building APIs and web servers.",
    metadata: { topic: "nodejs", source: "docs" },
  },
  {
    id: "doc-4",
    content: "Zod is a TypeScript-first schema declaration and validation library. " +
      "It provides type inference from schemas and runtime validation of data.",
    metadata: { topic: "zod", source: "docs" },
  },
  {
    id: "doc-5",
    content: "Vector databases store high-dimensional embeddings for similarity search. " +
      "They power modern RAG pipelines and recommendation systems.",
    metadata: { topic: "vector-db", source: "blog" },
  },
];

// ── 3. Define an LScriptFunction for answering questions ────────────

const AnswerSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sources_used: z.array(z.string()),
});

const qaFunction: LScriptFunction<string, typeof AnswerSchema> = {
  name: "RAGQuestionAnswerer",
  model: "mock-model",
  system:
    "You are a helpful technical assistant. Answer questions using the provided context. " +
    "If the context doesn't contain enough information, say so honestly.",
  prompt: (question: string) => `Question: ${question}`,
  schema: AnswerSchema,
  temperature: 0.3,
};

// ── 4. Execute the RAG pipeline ─────────────────────────────────────

async function main() {
  console.log("📚 RAG Pipeline Demo");
  console.log("═".repeat(60));

  // Set up mock provider
  const mockProvider = new MockProvider({
    defaultResponse: JSON.stringify({
      answer: "TypeScript is a strongly typed language that builds on JavaScript, " +
        "adding static typing and class-based OOP. Zod complements it with " +
        "runtime schema validation and type inference.",
      confidence: 0.92,
      sources_used: ["doc-1", "doc-4"],
    }),
  });

  const runtime = new LScriptRuntime({ provider: mockProvider });

  // Create components
  const embeddingProvider = new MockEmbeddingProvider(64);
  const vectorStore = new MemoryVectorStore();

  // Create RAG pipeline
  const rag = new RAGPipeline(runtime, {
    embeddingProvider,
    vectorStore,
    topK: 3,
    minScore: 0.1,
  });

  // ── Step 1: Ingest documents ──
  console.log("\n📥 Ingesting documents...");
  await rag.ingest(documents);
  const count = await vectorStore.count();
  console.log(`   ✅ Ingested ${count} documents into the vector store.`);

  // ── Step 2: Demonstrate raw similarity search ──
  console.log("\n🔍 Raw similarity search for 'TypeScript typing':");
  const queryVec = (await embeddingProvider.embed(["TypeScript typing"]))[0];
  const rawResults = await vectorStore.search(queryVec, 5);

  rawResults.forEach((r, i) => {
    console.log(`   ${i + 1}. [${r.document.id}] score=${r.score.toFixed(4)}`);
    console.log(`      "${r.document.content.slice(0, 60)}..."`);
  });

  // ── Step 3: Query through the RAG pipeline ──
  const query = "What is TypeScript and how does Zod relate to it?";
  console.log(`\n❓ RAG query: "${query}"`);
  console.log("─".repeat(60));

  const ragResult = await rag.query(qaFunction, query);

  // Show retrieved context
  console.log("\n📋 Retrieved context:");
  ragResult.retrievedDocuments.forEach((doc, i) => {
    console.log(`   ${i + 1}. [${doc.document.id}] score=${doc.score.toFixed(4)}`);
    console.log(`      "${doc.document.content.slice(0, 70)}..."`);
  });

  console.log(`\n📝 Injected context (first 200 chars):`);
  console.log(`   "${ragResult.context.slice(0, 200)}..."`);

  // Show final answer
  console.log("\n✅ Answer:");
  console.log(`   ${ragResult.result.data.answer}`);
  console.log(`   Confidence: ${(ragResult.result.data.confidence * 100).toFixed(1)}%`);
  console.log(`   Sources: ${ragResult.result.data.sources_used.join(", ")}`);

  // ── Step 4: Demonstrate cosine similarity directly ──
  console.log("\n📐 Cosine similarity examples:");
  const vecs = await embeddingProvider.embed([
    "TypeScript programming language",
    "JavaScript runtime Node.js",
    "cooking recipes for pasta",
  ]);
  console.log(`   TS vs Node.js: ${cosineSimilarity(vecs[0], vecs[1]).toFixed(4)}`);
  console.log(`   TS vs Cooking: ${cosineSimilarity(vecs[0], vecs[2]).toFixed(4)}`);

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
}

main();
