// ── OpenTelemetry-Compatible Telemetry Integration ──────────────────
//
// This module provides an OpenTelemetry-compatible transport and middleware
// WITHOUT adding @opentelemetry/* as a hard dependency. The interfaces mirror
// the OpenTelemetry API so users can pass in real OTel objects directly.

import type { LogTransport, LogEntry } from "./logger.js";
import type { MiddlewareHooks, ExecutionContext, ExecutionResult } from "./types.js";

// ── OpenTelemetry-compatible interfaces ─────────────────────────────

/**
 * Minimal Span interface compatible with OpenTelemetry's Span.
 */
export interface TelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
}

/**
 * Minimal Tracer interface compatible with OpenTelemetry's Tracer.
 */
export interface TelemetryTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): TelemetrySpan;
}

/**
 * Minimal Meter interface compatible with OpenTelemetry's Meter.
 */
export interface TelemetryMeter {
  createCounter(name: string, options?: { description?: string }): TelemetryCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): TelemetryHistogram;
}

export interface TelemetryCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}

export interface TelemetryHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void;
}

/**
 * Configuration for the telemetry integration.
 */
export interface TelemetryConfig {
  /** OpenTelemetry-compatible tracer for distributed tracing */
  tracer?: TelemetryTracer;

  /** OpenTelemetry-compatible meter for metrics */
  meter?: TelemetryMeter;

  /** Prefix for metric names. Default: "lmscript" */
  metricPrefix?: string;

  /** Whether to include prompt content in span attributes (may be sensitive). Default: false */
  includePrompts?: boolean;
}

/**
 * OpenTelemetry-compatible log transport.
 * Forwards lmscript log entries to an OpenTelemetry tracer as span events.
 */
export class OTelLogTransport implements LogTransport {
  private tracer: TelemetryTracer;
  private activeSpan: TelemetrySpan | null = null;

  constructor(tracer: TelemetryTracer) {
    this.tracer = tracer;
  }

  /** Set the active span that log entries will be attached to. */
  setActiveSpan(span: TelemetrySpan | null): void {
    this.activeSpan = span;
  }

  write(entry: LogEntry): void {
    if (this.activeSpan) {
      this.activeSpan.addEvent(entry.message, {
        level: entry.level,
        ...(entry.context as Record<string, string | number | boolean> ?? {}),
      });
    }
  }
}

/**
 * Creates middleware hooks that emit OpenTelemetry spans and metrics
 * for each LLM execution.
 *
 * Emitted spans:
 * - `{prefix}.execute` — wraps each execution with function name, model, attempt count
 *
 * Emitted metrics:
 * - `{prefix}.executions` — counter of executions (by function, status)
 * - `{prefix}.tokens` — counter of tokens used (by function, type)
 * - `{prefix}.duration` — histogram of execution duration (by function)
 * - `{prefix}.attempts` — histogram of attempt count (by function)
 */
export function createTelemetryMiddleware(config: TelemetryConfig): MiddlewareHooks {
  const prefix = config.metricPrefix ?? "lmscript";
  const tracer = config.tracer;
  const meter = config.meter;

  // Create metrics if meter is provided
  const executionCounter = meter?.createCounter(`${prefix}.executions`, {
    description: "Number of LLM executions",
  });
  const tokenCounter = meter?.createCounter(`${prefix}.tokens`, {
    description: "Number of tokens used",
  });
  const durationHistogram = meter?.createHistogram(`${prefix}.duration`, {
    description: "Execution duration in milliseconds",
    unit: "ms",
  });
  const attemptHistogram = meter?.createHistogram(`${prefix}.attempts`, {
    description: "Number of attempts per execution",
  });

  // Track spans per execution context
  const spanMap = new WeakMap<ExecutionContext, TelemetrySpan>();

  return {
    onBeforeExecute(ctx: ExecutionContext): void {
      if (tracer) {
        const attributes: Record<string, string | number | boolean> = {
          "lmscript.function": ctx.fn.name,
          "lmscript.model": ctx.fn.model,
        };

        if (config.includePrompts && typeof ctx.input === "string") {
          attributes["lmscript.input"] = ctx.input;
        }

        const span = tracer.startSpan(`${prefix}.execute`, { attributes });
        spanMap.set(ctx, span);
      }
    },

    onRetry(ctx: ExecutionContext, error: Error): void {
      const span = spanMap.get(ctx);
      if (span) {
        span.addEvent("retry", {
          attempt: ctx.attempt,
          error: error.message,
        });
      }
    },

    onError(ctx: ExecutionContext, error: Error): void {
      const span = spanMap.get(ctx);
      if (span) {
        span.setStatus({ code: 2, message: error.message }); // SpanStatusCode.ERROR = 2
        span.setAttribute("error", true);
        span.end();
        spanMap.delete(ctx);
      }

      executionCounter?.add(1, {
        function: ctx.fn.name,
        model: ctx.fn.model,
        status: "error",
      });
    },

    onComplete(ctx: ExecutionContext, result: ExecutionResult<unknown>): void {
      const span = spanMap.get(ctx);
      const duration = Date.now() - ctx.startTime;

      if (span) {
        span.setAttribute("lmscript.attempts", result.attempts);
        span.setAttribute("lmscript.duration_ms", duration);

        if (result.usage) {
          span.setAttribute("lmscript.prompt_tokens", result.usage.promptTokens);
          span.setAttribute("lmscript.completion_tokens", result.usage.completionTokens);
          span.setAttribute("lmscript.total_tokens", result.usage.totalTokens);
        }

        span.setStatus({ code: 1 }); // SpanStatusCode.OK = 1
        span.end();
        spanMap.delete(ctx);
      }

      const attrs = {
        function: ctx.fn.name,
        model: ctx.fn.model,
      };

      executionCounter?.add(1, { ...attrs, status: "success" });
      durationHistogram?.record(duration, attrs);
      attemptHistogram?.record(result.attempts, attrs);

      if (result.usage) {
        tokenCounter?.add(result.usage.promptTokens, { ...attrs, type: "prompt" });
        tokenCounter?.add(result.usage.completionTokens, { ...attrs, type: "completion" });
      }
    },
  };
}
