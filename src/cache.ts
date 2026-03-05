import type {
  CacheBackend,
  ExecutionResult,
  LScriptFunction,
} from "./types.js";

/**
 * Simple string hash function for generating cache keys.
 * Uses djb2 algorithm — fast and produces reasonable distribution.
 */
function stringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * In-memory cache backend using a Map with optional TTL support.
 */
export class MemoryCacheBackend implements CacheBackend {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * ExecutionCache provides content-addressable memoization for LLM responses.
 *
 * It generates deterministic keys from the function definition and input,
 * and stores/retrieves serialized ExecutionResult objects.
 */
export class ExecutionCache {
  private backend: CacheBackend;

  constructor(backend: CacheBackend) {
    this.backend = backend;
  }

  /**
   * Generate a deterministic cache key from a function definition and input.
   * The key is based on: fn.name + fn.model + fn.system + fn.prompt(input)
   */
  computeKey<I>(fn: LScriptFunction<I, any>, input: I): string {
    const components = [
      fn.name,
      fn.model,
      fn.system,
      fn.prompt(input),
    ].join("|");
    return `lmscript:${stringHash(components)}`;
  }

  /**
   * Retrieve a cached execution result, or null if not cached.
   */
  async getCached<T>(
    fn: LScriptFunction<any, any>,
    input: unknown
  ): Promise<ExecutionResult<T> | null> {
    const key = this.computeKey(fn, input);
    const raw = await this.backend.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ExecutionResult<T>;
    } catch {
      return null;
    }
  }

  /**
   * Store an execution result in the cache.
   */
  async setCached<T>(
    fn: LScriptFunction<any, any>,
    input: unknown,
    result: ExecutionResult<T>
  ): Promise<void> {
    const key = this.computeKey(fn, input);
    await this.backend.set(key, JSON.stringify(result));
  }
}
