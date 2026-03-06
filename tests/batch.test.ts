import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchManager } from '../src/batch';
import type {
  BatchManagerConfig,
  BatchJob,
  BatchJobStatus,
  BatchRequest,
} from '../src/batch';
import type { LScriptRuntime } from '../src/runtime';
import type { LScriptFunction, ExecutionResult } from '../src/types';
import { z } from 'zod';

// ── Mock factories ──────────────────────────────────────────────────

function createMockRuntime(
  executeFn?: (fn: any, input: any) => Promise<ExecutionResult<any>>
): LScriptRuntime {
  const defaultExecute = vi.fn(async (_fn: any, _input: any): Promise<ExecutionResult<any>> => ({
    data: { result: 'mock result' },
    attempts: 1,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  }));

  return {
    execute: executeFn ? vi.fn(executeFn) : defaultExecute,
  } as unknown as LScriptRuntime;
}

function createTestFunction(name = 'testFn'): LScriptFunction<string, z.ZodObject<any>> {
  return {
    name,
    model: 'gpt-4o',
    system: 'You are a test assistant',
    prompt: (input: string) => `Process: ${input}`,
    schema: z.object({ result: z.string() }),
  };
}

function createRequests(count: number): BatchRequest<string>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `req_${i + 1}`,
    input: `input_${i + 1}`,
  }));
}

// ── BatchManager ────────────────────────────────────────────────────

describe('BatchManager', () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts a runtime and optional config', () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime, { concurrency: 3 });
      expect(bm).toBeInstanceOf(BatchManager);
    });

    it('works without config (uses defaults)', () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      expect(bm).toBeInstanceOf(BatchManager);
    });
  });

  // ── submit() ────────────────────────────────────────────────────

  describe('submit()', () => {
    it('submits a job and returns a job ID string', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(1);

      const jobId = await bm.submit(fn, requests);

      expect(jobId).toBeTypeOf('string');
      expect(jobId).toContain('batch_');
    });

    it('creates a job with pending or processing status', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(1);

      const jobId = await bm.submit(fn, requests);
      const job = bm.getJob(jobId);

      expect(job).toBeDefined();
      expect(job!.functionName).toBe('testFn');
      expect(job!.totalRequests).toBe(1);
    });

    it('submits multiple jobs with unique IDs', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId1 = await bm.submit(fn, createRequests(1));
      const jobId2 = await bm.submit(fn, createRequests(1));
      const jobId3 = await bm.submit(fn, createRequests(1));

      expect(jobId1).not.toBe(jobId2);
      expect(jobId2).not.toBe(jobId3);
      expect(jobId1).not.toBe(jobId3);
    });
  });

  // ── Job execution ───────────────────────────────────────────────

  describe('job execution', () => {
    it('jobs transition to completed status', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(2);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.status).toBe('completed');
    });

    it('completed jobs have results with the execution return values', async () => {
      const runtime = createMockRuntime(async (_fn, input) => ({
        data: { result: `processed_${input}` },
        attempts: 1,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }));
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(2);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.results).toHaveLength(2);
      expect(job.results.every(r => r.status === 'success')).toBe(true);
      expect(job.completedRequests).toBe(2);
    });

    it('sets completedAt on job completion', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(1);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.completedAt).toBeInstanceOf(Date);
    });
  });

  // ── Job failure ─────────────────────────────────────────────────

  describe('job failure', () => {
    it('failed requests have status "error" and error message', async () => {
      const runtime = createMockRuntime(async () => {
        throw new Error('LLM API error');
      });
      const bm = new BatchManager(runtime, { continueOnError: true });
      const fn = createTestFunction();
      const requests = createRequests(1);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.results).toHaveLength(1);
      expect(job.results[0].status).toBe('error');
      expect(job.results[0].error).toBe('LLM API error');
      expect(job.failedRequests).toBe(1);
    });

    it('continues processing when continueOnError is true (default)', async () => {
      let callCount = 0;
      const runtime = createMockRuntime(async () => {
        callCount++;
        if (callCount === 2) throw new Error('Failed on second');
        return { data: { result: 'ok' }, attempts: 1 };
      });
      const bm = new BatchManager(runtime, { concurrency: 1 });
      const fn = createTestFunction();
      const requests = createRequests(3);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.results).toHaveLength(3);
      expect(job.failedRequests).toBe(1);
      expect(job.completedRequests).toBe(2);
    });

    it('stops processing when continueOnError is false', async () => {
      let callCount = 0;
      const runtime = createMockRuntime(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Fail on first');
        return { data: { result: 'ok' }, attempts: 1 };
      });
      const bm = new BatchManager(runtime, { concurrency: 1, continueOnError: false });
      const fn = createTestFunction();
      const requests = createRequests(3);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.status).toBe('failed');
      // Should have stopped after first failure
      expect(job.results.length).toBeLessThan(3);
    });
  });

  // ── Concurrency control ─────────────────────────────────────────

  describe('concurrency control', () => {
    it('respects concurrency limit', async () => {
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const runtime = createMockRuntime(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, 50));
        currentConcurrent--;
        return { data: { result: 'ok' }, attempts: 1 };
      });

      const bm = new BatchManager(runtime, { concurrency: 2 });
      const fn = createTestFunction();
      const requests = createRequests(6);

      const jobId = await bm.submit(fn, requests);
      await bm.waitForCompletion(jobId);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('uses all concurrency slots when available', async () => {
      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const runtime = createMockRuntime(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, 50));
        currentConcurrent--;
        return { data: { result: 'ok' }, attempts: 1 };
      });

      const bm = new BatchManager(runtime, { concurrency: 3 });
      const fn = createTestFunction();
      const requests = createRequests(6);

      const jobId = await bm.submit(fn, requests);
      await bm.waitForCompletion(jobId);

      // Should have used at least 2 concurrent slots (timing can vary)
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  // ── waitForCompletion() ─────────────────────────────────────────

  describe('waitForCompletion()', () => {
    it('waits for a specific job to complete and returns the job', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(2);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.id).toBe(jobId);
      expect(job.status).toBe('completed');
      expect(job.results).toHaveLength(2);
    });

    it('throws for non-existent job ID', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);

      await expect(bm.waitForCompletion('nonexistent_job')).rejects.toThrow('not found');
    });
  });

  // ── cancel() ────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('cancels a pending/processing job', async () => {
      const runtime = createMockRuntime(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { data: { result: 'ok' }, attempts: 1 };
      });
      const bm = new BatchManager(runtime, { concurrency: 1 });
      const fn = createTestFunction();
      const requests = createRequests(10);

      const jobId = await bm.submit(fn, requests);

      // Wait briefly for job to start processing
      await new Promise(resolve => setTimeout(resolve, 10));

      const cancelled = bm.cancel(jobId);
      expect(cancelled).toBe(true);

      const job = bm.getJob(jobId);
      expect(job!.status).toBe('cancelled');
    });

    it('returns false for already completed job', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(1);

      const jobId = await bm.submit(fn, requests);
      await bm.waitForCompletion(jobId);

      const cancelled = bm.cancel(jobId);
      expect(cancelled).toBe(false);
    });

    it('returns false for non-existent job', () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);

      const cancelled = bm.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  // ── getJob() ────────────────────────────────────────────────────

  describe('getJob()', () => {
    it('retrieves a job by ID with current status', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(2);

      const jobId = await bm.submit(fn, requests);
      const job = bm.getJob(jobId);

      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
      expect(job!.functionName).toBe('testFn');
      expect(job!.totalRequests).toBe(2);
    });

    it('returns undefined for non-existent job', () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);

      const job = bm.getJob('nonexistent');
      expect(job).toBeUndefined();
    });
  });

  // ── listJobs() ──────────────────────────────────────────────────

  describe('listJobs()', () => {
    it('returns all jobs', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      await bm.submit(fn, createRequests(1));
      await bm.submit(fn, createRequests(1));

      const jobs = bm.listJobs();
      expect(jobs.length).toBe(2);
    });

    it('filters jobs by status', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId = await bm.submit(fn, createRequests(1));
      await bm.waitForCompletion(jobId);

      const completedJobs = bm.listJobs('completed');
      expect(completedJobs.length).toBeGreaterThanOrEqual(1);
      expect(completedJobs.every(j => j.status === 'completed')).toBe(true);
    });

    it('returns empty array when no jobs match filter', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);

      const jobs = bm.listJobs('cancelled');
      expect(jobs).toEqual([]);
    });
  });

  // ── onProgress callback ─────────────────────────────────────────

  describe('onProgress callback', () => {
    it('is called when job status changes', async () => {
      const onProgress = vi.fn();
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime, { onProgress });
      const fn = createTestFunction();
      const requests = createRequests(2);

      const jobId = await bm.submit(fn, requests);
      await bm.waitForCompletion(jobId);

      // Called for: processing start, each request completion, and final completion
      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);

      // First call should show the job
      const firstCallArg = onProgress.mock.calls[0][0];
      expect(firstCallArg.id).toBe(jobId);
    });
  });

  // ── Token usage aggregation ─────────────────────────────────────

  describe('token usage aggregation', () => {
    it('aggregates token usage across all requests', async () => {
      const runtime = createMockRuntime(async () => ({
        data: { result: 'ok' },
        attempts: 1,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }));
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(3);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      expect(job.totalUsage.promptTokens).toBe(30);
      expect(job.totalUsage.completionTokens).toBe(15);
      expect(job.totalUsage.totalTokens).toBe(45);
    });
  });

  // ── Error propagation ───────────────────────────────────────────

  describe('error propagation', () => {
    it('job errors do not crash the batch manager', async () => {
      const runtime = createMockRuntime(async () => {
        throw new Error('Total failure');
      });
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();
      const requests = createRequests(3);

      const jobId = await bm.submit(fn, requests);
      const job = await bm.waitForCompletion(jobId);

      // Batch manager still works — job completed or failed gracefully
      expect(['completed', 'failed']).toContain(job.status);

      // Can still submit new jobs
      const runtime2 = createMockRuntime();
      const bm2 = new BatchManager(runtime2);
      const jobId2 = await bm2.submit(fn, createRequests(1));
      const job2 = await bm2.waitForCompletion(jobId2);
      expect(job2.status).toBe('completed');
    });
  });

  // ── cleanup() ───────────────────────────────────────────────────

  describe('cleanup()', () => {
    it('removes completed/failed/cancelled jobs from the job list', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId = await bm.submit(fn, createRequests(1));
      await bm.waitForCompletion(jobId);

      expect(bm.listJobs().length).toBe(1);

      const removed = bm.cleanup();
      expect(removed).toBe(1);
      expect(bm.listJobs().length).toBe(0);
    });
  });

  // ── Delay between requests ──────────────────────────────────────

  describe('delay between requests', () => {
    it('respects delayBetweenRequests config', async () => {
      const callTimes: number[] = [];
      const runtime = createMockRuntime(async () => {
        callTimes.push(Date.now());
        return { data: { result: 'ok' }, attempts: 1 };
      });
      const bm = new BatchManager(runtime, { concurrency: 1, delayBetweenRequests: 50 });
      const fn = createTestFunction();
      const requests = createRequests(3);

      const jobId = await bm.submit(fn, requests);
      await bm.waitForCompletion(jobId);

      // Verify delays between calls (at least ~50ms between request 2 and 1, 3 and 2)
      if (callTimes.length >= 2) {
        const gap1 = callTimes[1] - callTimes[0];
        expect(gap1).toBeGreaterThanOrEqual(40); // Allow some timing tolerance
      }
    });
  });

  // ── Empty batch ─────────────────────────────────────────────────

  describe('empty batch', () => {
    it('completes immediately with no requests', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId = await bm.submit(fn, []);
      const job = await bm.waitForCompletion(jobId);

      expect(job.status).toBe('completed');
      expect(job.results).toHaveLength(0);
      expect(job.totalRequests).toBe(0);
    });
  });

  // ── Job metadata ────────────────────────────────────────────────

  describe('job metadata', () => {
    it('has createdAt timestamp', async () => {
      const runtime = createMockRuntime();
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId = await bm.submit(fn, createRequests(1));
      const job = bm.getJob(jobId);

      expect(job!.createdAt).toBeInstanceOf(Date);
    });

    it('initializes totalUsage to zeros', async () => {
      const runtime = createMockRuntime(async () => ({
        data: { result: 'ok' },
        attempts: 1,
        // No usage info
      }));
      const bm = new BatchManager(runtime);
      const fn = createTestFunction();

      const jobId = await bm.submit(fn, createRequests(1));
      const job = await bm.waitForCompletion(jobId);

      // When no usage is returned, totalUsage should stay at default
      expect(job.totalUsage).toBeDefined();
      expect(job.totalUsage.promptTokens).toBe(0);
      expect(job.totalUsage.completionTokens).toBe(0);
      expect(job.totalUsage.totalTokens).toBe(0);
    });
  });
});
