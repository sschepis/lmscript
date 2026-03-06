import { z } from "zod";
import type { LScriptFunction, ExecutionResult } from "./types.js";
import type { LScriptRuntime } from "./runtime.js";

/**
 * Status of a batch job.
 */
export type BatchJobStatus = "pending" | "submitted" | "processing" | "completed" | "failed" | "cancelled";

/**
 * A single request within a batch.
 */
export interface BatchRequest<I = unknown> {
  /** Unique ID for this request within the batch */
  id: string;
  /** The input data */
  input: I;
}

/**
 * Result of a single request within a batch.
 */
export interface BatchRequestResult<T = unknown> {
  /** The request ID */
  id: string;
  /** Status of this individual request */
  status: "success" | "error";
  /** The result data (if successful) */
  data?: T;
  /** Error message (if failed) */
  error?: string;
  /** Token usage for this request */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * A batch job that tracks multiple requests.
 */
export interface BatchJob<T = unknown> {
  /** Unique batch job ID */
  id: string;
  /** Current status */
  status: BatchJobStatus;
  /** Function name used */
  functionName: string;
  /** Total number of requests */
  totalRequests: number;
  /** Number of completed requests */
  completedRequests: number;
  /** Number of failed requests */
  failedRequests: number;
  /** Individual results (populated when status is "completed") */
  results: BatchRequestResult<T>[];
  /** When the batch was created */
  createdAt: Date;
  /** When the batch completed (if done) */
  completedAt?: Date;
  /** Aggregated token usage */
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Configuration for the batch manager.
 */
export interface BatchManagerConfig {
  /** Maximum concurrent requests when processing locally. Default: 5 */
  concurrency?: number;
  /** Delay between requests in ms (for rate limiting). Default: 0 */
  delayBetweenRequests?: number;
  /** Whether to continue processing on individual request failures. Default: true */
  continueOnError?: boolean;
  /** Callback for progress updates */
  onProgress?: (job: BatchJob) => void;
}

/**
 * BatchManager handles async batch processing of LLM requests.
 *
 * Unlike `runtime.executeBatch()` which processes all at once,
 * BatchManager provides:
 * - Job tracking with status and progress
 * - Configurable delays between requests
 * - Error tolerance (continue on individual failures)
 * - Progress callbacks
 * - Job cancellation
 */
export class BatchManager {
  private runtime: LScriptRuntime;
  private config: Required<BatchManagerConfig>;
  private jobs: Map<string, BatchJob> = new Map();
  private cancelledJobs: Set<string> = new Set();
  private jobCounter: number = 0;

  constructor(runtime: LScriptRuntime, config?: BatchManagerConfig) {
    this.runtime = runtime;
    this.config = {
      concurrency: config?.concurrency ?? 5,
      delayBetweenRequests: config?.delayBetweenRequests ?? 0,
      continueOnError: config?.continueOnError ?? true,
      onProgress: config?.onProgress ?? (() => {}),
    };
  }

  /**
   * Submit a batch job for processing.
   * Returns the job ID immediately; processing happens asynchronously.
   */
  async submit<I, O extends z.ZodType>(
    fn: LScriptFunction<I, O>,
    requests: BatchRequest<I>[]
  ): Promise<string> {
    const jobId = `batch_${++this.jobCounter}_${Date.now()}`;

    const job: BatchJob = {
      id: jobId,
      status: "pending",
      functionName: fn.name,
      totalRequests: requests.length,
      completedRequests: 0,
      failedRequests: 0,
      results: [],
      createdAt: new Date(),
      totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };

    this.jobs.set(jobId, job);

    // Start processing asynchronously
    this.processJob(jobId, fn, requests).catch(() => {
      const j = this.jobs.get(jobId);
      if (j && j.status !== "cancelled") {
        j.status = "failed";
      }
    });

    return jobId;
  }

  /**
   * Get the current status of a batch job.
   */
  getJob(jobId: string): BatchJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Wait for a batch job to complete.
   * Polls the job status at the specified interval.
   */
  async waitForCompletion<T = unknown>(
    jobId: string,
    pollIntervalMs: number = 100
  ): Promise<BatchJob<T>> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Batch job ${jobId} not found`);

    while (true) {
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        return job as BatchJob<T>;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Cancel a running batch job.
   * Already-completed requests within the batch are preserved.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") {
      return false;
    }

    this.cancelledJobs.add(jobId);
    job.status = "cancelled";
    return true;
  }

  /**
   * List all jobs, optionally filtered by status.
   */
  listJobs(status?: BatchJobStatus): BatchJob[] {
    const jobs = Array.from(this.jobs.values());
    return status ? jobs.filter(j => j.status === status) : jobs;
  }

  /**
   * Remove completed/failed/cancelled jobs from the job list.
   */
  cleanup(): number {
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        this.jobs.delete(id);
        this.cancelledJobs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // ── Internal processing ──

  private async processJob<I, O extends z.ZodType>(
    jobId: string,
    fn: LScriptFunction<I, O>,
    requests: BatchRequest<I>[]
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;
    job.status = "processing";
    this.config.onProgress(job);

    // Semaphore-based concurrency control
    const concurrency = Math.min(this.config.concurrency, requests.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < requests.length) {
        if (this.cancelledJobs.has(jobId)) return;

        const currentIndex = index++;
        const request = requests[currentIndex];

        // Apply delay between requests
        if (currentIndex > 0 && this.config.delayBetweenRequests > 0) {
          await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests));
        }

        try {
          const result: ExecutionResult<z.infer<O>> = await this.runtime.execute(fn, request.input);

          const requestResult: BatchRequestResult = {
            id: request.id,
            status: "success",
            data: result.data,
            usage: result.usage,
          };

          job.results.push(requestResult);
          job.completedRequests++;

          if (result.usage) {
            job.totalUsage.promptTokens += result.usage.promptTokens;
            job.totalUsage.completionTokens += result.usage.completionTokens;
            job.totalUsage.totalTokens += result.usage.totalTokens;
          }
        } catch (err) {
          const requestResult: BatchRequestResult = {
            id: request.id,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          };

          job.results.push(requestResult);
          job.failedRequests++;

          if (!this.config.continueOnError) {
            job.status = "failed";
            this.config.onProgress(job);
            return;
          }
        }

        this.config.onProgress(job);
      }
    };

    // Launch concurrent workers
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    if (!this.cancelledJobs.has(jobId) && (job.status as BatchJobStatus) !== "failed") {
      job.status = "completed";
      job.completedAt = new Date();
    }

    this.config.onProgress(job);
  }
}
