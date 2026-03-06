import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTelemetryMiddleware,
  OTelLogTransport,
} from '../src/telemetry';
import type {
  TelemetryTracer,
  TelemetryMeter,
  TelemetrySpan,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryConfig,
} from '../src/telemetry';
import type { ExecutionContext, ExecutionResult } from '../src/types';
import { LogLevel } from '../src/logger';
import type { LogEntry } from '../src/logger';

// ── Mock factories ──────────────────────────────────────────────────

function createMockSpan(): TelemetrySpan {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    addEvent: vi.fn(),
  };
}

function createMockTracer(span?: TelemetrySpan): TelemetryTracer {
  const mockSpan = span ?? createMockSpan();
  return {
    startSpan: vi.fn().mockReturnValue(mockSpan),
  };
}

function createMockCounter(): TelemetryCounter {
  return { add: vi.fn() };
}

function createMockHistogram(): TelemetryHistogram {
  return { record: vi.fn() };
}

function createMockMeter(): TelemetryMeter & {
  _counters: Map<string, TelemetryCounter>;
  _histograms: Map<string, TelemetryHistogram>;
} {
  const counters = new Map<string, TelemetryCounter>();
  const histograms = new Map<string, TelemetryHistogram>();
  return {
    _counters: counters,
    _histograms: histograms,
    createCounter: vi.fn((name: string) => {
      const counter = createMockCounter();
      counters.set(name, counter);
      return counter;
    }),
    createHistogram: vi.fn((name: string) => {
      const histogram = createMockHistogram();
      histograms.set(name, histogram);
      return histogram;
    }),
  };
}

function createExecutionContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    fn: {
      name: 'testFunction',
      model: 'gpt-4o',
      system: 'You are a test assistant',
      prompt: (input: unknown) => `Test prompt: ${input}`,
      schema: {} as any,
    },
    input: 'test input',
    messages: [],
    attempt: 1,
    startTime: Date.now() - 100, // 100ms ago
    ...overrides,
  };
}

function createExecutionResult(overrides?: Partial<ExecutionResult<unknown>>): ExecutionResult<unknown> {
  return {
    data: { answer: 42 },
    attempts: 1,
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
    ...overrides,
  };
}

// ── createTelemetryMiddleware ───────────────────────────────────────

describe('createTelemetryMiddleware', () => {
  // ── Returns middleware object ───────────────────────────────────

  describe('returns middleware object', () => {
    it('has onBeforeExecute, onComplete, onError, and onRetry hooks', () => {
      const middleware = createTelemetryMiddleware({ tracer: createMockTracer() });
      expect(middleware.onBeforeExecute).toBeTypeOf('function');
      expect(middleware.onComplete).toBeTypeOf('function');
      expect(middleware.onError).toBeTypeOf('function');
      expect(middleware.onRetry).toBeTypeOf('function');
    });
  });

  // ── onBeforeExecute hook ────────────────────────────────────────

  describe('onBeforeExecute hook', () => {
    it('calls tracer.startSpan() with prefixed name', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();

      middleware.onBeforeExecute!(ctx);

      expect(tracer.startSpan).toHaveBeenCalledWith('lmscript.execute', expect.any(Object));
    });

    it('sets function and model attributes on span', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();

      middleware.onBeforeExecute!(ctx);

      expect(tracer.startSpan).toHaveBeenCalledWith('lmscript.execute', {
        attributes: expect.objectContaining({
          'lmscript.function': 'testFunction',
          'lmscript.model': 'gpt-4o',
        }),
      });
    });

    it('includes input in span attributes when includePrompts is true', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer, includePrompts: true });
      const ctx = createExecutionContext({ input: 'sensitive prompt text' });

      middleware.onBeforeExecute!(ctx);

      expect(tracer.startSpan).toHaveBeenCalledWith('lmscript.execute', {
        attributes: expect.objectContaining({
          'lmscript.input': 'sensitive prompt text',
        }),
      });
    });

    it('does not include input in span attributes when includePrompts is false', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer, includePrompts: false });
      const ctx = createExecutionContext({ input: 'sensitive prompt text' });

      middleware.onBeforeExecute!(ctx);

      const callArgs = (tracer.startSpan as any).mock.calls[0][1];
      expect(callArgs.attributes).not.toHaveProperty('lmscript.input');
    });

    it('uses custom metricPrefix for span name', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer, metricPrefix: 'myapp' });
      const ctx = createExecutionContext();

      middleware.onBeforeExecute!(ctx);

      expect(tracer.startSpan).toHaveBeenCalledWith('myapp.execute', expect.any(Object));
    });
  });

  // ── onComplete hook ─────────────────────────────────────────────

  describe('onComplete hook', () => {
    it('calls span.end()', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const result = createExecutionResult();

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      expect(span.end).toHaveBeenCalled();
    });

    it('sets span status to OK (code 1)', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const result = createExecutionResult();

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
    });

    it('sets attempts and duration attributes on span', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const result = createExecutionResult({ attempts: 3 });

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      expect(span.setAttribute).toHaveBeenCalledWith('lmscript.attempts', 3);
      expect(span.setAttribute).toHaveBeenCalledWith('lmscript.duration_ms', expect.any(Number));
    });

    it('sets token usage attributes on span when usage is present', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const result = createExecutionResult({
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      });

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      expect(span.setAttribute).toHaveBeenCalledWith('lmscript.prompt_tokens', 200);
      expect(span.setAttribute).toHaveBeenCalledWith('lmscript.completion_tokens', 100);
      expect(span.setAttribute).toHaveBeenCalledWith('lmscript.total_tokens', 300);
    });

    it('records metrics on counter and histogram when meter is provided', () => {
      const meter = createMockMeter();
      const middleware = createTelemetryMiddleware({ meter });
      const ctx = createExecutionContext();
      const result = createExecutionResult();

      middleware.onComplete!(ctx, result);

      const executionCounter = meter._counters.get('lmscript.executions')!;
      const durationHistogram = meter._histograms.get('lmscript.duration')!;
      const attemptHistogram = meter._histograms.get('lmscript.attempts')!;
      const tokenCounter = meter._counters.get('lmscript.tokens')!;

      expect(executionCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'success' }));
      expect(durationHistogram.record).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
      expect(attemptHistogram.record).toHaveBeenCalledWith(1, expect.any(Object));
      expect(tokenCounter.add).toHaveBeenCalledWith(100, expect.objectContaining({ type: 'prompt' }));
      expect(tokenCounter.add).toHaveBeenCalledWith(50, expect.objectContaining({ type: 'completion' }));
    });

    it('does not record token metrics when usage is not present', () => {
      const meter = createMockMeter();
      const middleware = createTelemetryMiddleware({ meter });
      const ctx = createExecutionContext();
      const result = createExecutionResult({ usage: undefined });

      middleware.onComplete!(ctx, result);

      const tokenCounter = meter._counters.get('lmscript.tokens')!;
      expect(tokenCounter.add).not.toHaveBeenCalled();
    });
  });

  // ── onError hook ────────────────────────────────────────────────

  describe('onError hook', () => {
    it('calls span.setStatus() with error code (2) and message', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const error = new Error('LLM call failed');

      middleware.onBeforeExecute!(ctx);
      middleware.onError!(ctx, error);

      expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: 'LLM call failed' });
    });

    it('sets error attribute on span', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const error = new Error('LLM call failed');

      middleware.onBeforeExecute!(ctx);
      middleware.onError!(ctx, error);

      expect(span.setAttribute).toHaveBeenCalledWith('error', true);
    });

    it('calls span.end() on error', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const error = new Error('LLM call failed');

      middleware.onBeforeExecute!(ctx);
      middleware.onError!(ctx, error);

      expect(span.end).toHaveBeenCalled();
    });

    it('records error on execution counter when meter is provided', () => {
      const meter = createMockMeter();
      const middleware = createTelemetryMiddleware({ meter });
      const ctx = createExecutionContext();
      const error = new Error('LLM call failed');

      middleware.onError!(ctx, error);

      const executionCounter = meter._counters.get('lmscript.executions')!;
      expect(executionCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
        function: 'testFunction',
        model: 'gpt-4o',
        status: 'error',
      }));
    });
  });

  // ── onRetry hook ────────────────────────────────────────────────

  describe('onRetry hook', () => {
    it('adds retry event to span with attempt and error info', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext({ attempt: 2 });
      const error = new Error('Validation failed');

      middleware.onBeforeExecute!(ctx);
      middleware.onRetry!(ctx, error);

      expect(span.addEvent).toHaveBeenCalledWith('retry', {
        attempt: 2,
        error: 'Validation failed',
      });
    });

    it('does nothing when no span is active (no tracer)', () => {
      const middleware = createTelemetryMiddleware({});
      const ctx = createExecutionContext({ attempt: 2 });
      const error = new Error('Validation failed');

      // Should not throw
      expect(() => middleware.onRetry!(ctx, error)).not.toThrow();
    });
  });

  // ── With meter only (no tracer) ─────────────────────────────────

  describe('with meter only (no tracer)', () => {
    it('creates counter and histogram during initialization', () => {
      const meter = createMockMeter();
      createTelemetryMiddleware({ meter });

      expect(meter.createCounter).toHaveBeenCalledWith('lmscript.executions', expect.any(Object));
      expect(meter.createCounter).toHaveBeenCalledWith('lmscript.tokens', expect.any(Object));
      expect(meter.createHistogram).toHaveBeenCalledWith('lmscript.duration', expect.any(Object));
      expect(meter.createHistogram).toHaveBeenCalledWith('lmscript.attempts', expect.any(Object));
    });

    it('records metrics without creating spans', () => {
      const meter = createMockMeter();
      const middleware = createTelemetryMiddleware({ meter });
      const ctx = createExecutionContext();
      const result = createExecutionResult();

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      const executionCounter = meter._counters.get('lmscript.executions')!;
      expect(executionCounter.add).toHaveBeenCalled();
    });
  });

  // ── With tracer only (no meter) ─────────────────────────────────

  describe('with tracer only (no meter)', () => {
    it('creates spans without creating metrics', () => {
      const span = createMockSpan();
      const tracer = createMockTracer(span);
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const result = createExecutionResult();

      middleware.onBeforeExecute!(ctx);
      middleware.onComplete!(ctx, result);

      expect(tracer.startSpan).toHaveBeenCalled();
      expect(span.end).toHaveBeenCalled();
    });

    it('does not throw on error without meter', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext();
      const error = new Error('Some error');

      middleware.onBeforeExecute!(ctx);
      expect(() => middleware.onError!(ctx, error)).not.toThrow();
    });
  });

  // ── Without tracer or meter ─────────────────────────────────────

  describe('without tracer or meter', () => {
    it('does not throw on any hook call', () => {
      const middleware = createTelemetryMiddleware({});
      const ctx = createExecutionContext();
      const result = createExecutionResult();
      const error = new Error('fail');

      expect(() => middleware.onBeforeExecute!(ctx)).not.toThrow();
      expect(() => middleware.onComplete!(ctx, result)).not.toThrow();
      expect(() => middleware.onError!(ctx, error)).not.toThrow();
      expect(() => middleware.onRetry!(ctx, error)).not.toThrow();
    });
  });

  // ── Span attributes ────────────────────────────────────────────

  describe('span attributes', () => {
    it('sets lmscript.function attribute from fn.name', () => {
      const tracer = createMockTracer();
      const middleware = createTelemetryMiddleware({ tracer });
      const ctx = createExecutionContext({
        fn: {
          name: 'summarize',
          model: 'claude-sonnet-4-20250514',
          system: 'You summarize text',
          prompt: (i: unknown) => `Summarize: ${i}`,
          schema: {} as any,
        },
      });

      middleware.onBeforeExecute!(ctx);

      expect(tracer.startSpan).toHaveBeenCalledWith('lmscript.execute', {
        attributes: expect.objectContaining({
          'lmscript.function': 'summarize',
          'lmscript.model': 'claude-sonnet-4-20250514',
        }),
      });
    });
  });

  // ── Config options ──────────────────────────────────────────────

  describe('config options', () => {
    it('uses custom metricPrefix for metric names', () => {
      const meter = createMockMeter();
      createTelemetryMiddleware({ meter, metricPrefix: 'myapp' });

      expect(meter.createCounter).toHaveBeenCalledWith('myapp.executions', expect.any(Object));
      expect(meter.createCounter).toHaveBeenCalledWith('myapp.tokens', expect.any(Object));
      expect(meter.createHistogram).toHaveBeenCalledWith('myapp.duration', expect.any(Object));
      expect(meter.createHistogram).toHaveBeenCalledWith('myapp.attempts', expect.any(Object));
    });

    it('defaults metricPrefix to "lmscript"', () => {
      const meter = createMockMeter();
      createTelemetryMiddleware({ meter });

      expect(meter.createCounter).toHaveBeenCalledWith('lmscript.executions', expect.any(Object));
    });
  });
});

// ── OTelLogTransport ────────────────────────────────────────────────

describe('OTelLogTransport', () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts a tracer object', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      expect(transport).toBeInstanceOf(OTelLogTransport);
    });
  });

  // ── setActiveSpan ───────────────────────────────────────────────

  describe('setActiveSpan', () => {
    it('allows setting an active span', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();

      // Should not throw
      expect(() => transport.setActiveSpan(span)).not.toThrow();
    });

    it('allows clearing the active span with null', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);

      expect(() => transport.setActiveSpan(null)).not.toThrow();
    });
  });

  // ── write() method ──────────────────────────────────────────────

  describe('write() method', () => {
    it('forwards log message as a span event when active span is set', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'Test log message',
      };

      transport.write(entry);

      expect(span.addEvent).toHaveBeenCalledWith('Test log message', expect.objectContaining({
        level: LogLevel.INFO,
      }));
    });

    it('does not forward when no active span is set', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();

      // Don't set active span
      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'Orphan log message',
      };

      transport.write(entry);

      expect(span.addEvent).not.toHaveBeenCalled();
    });

    it('does not forward after span is cleared', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();

      transport.setActiveSpan(span);
      transport.setActiveSpan(null);

      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'Should not appear',
      };

      transport.write(entry);

      expect(span.addEvent).not.toHaveBeenCalled();
    });
  });

  // ── Log levels ──────────────────────────────────────────────────

  describe('log levels', () => {
    it('passes INFO level correctly', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      transport.write({ timestamp: Date.now(), level: LogLevel.INFO, message: 'info msg' });

      expect(span.addEvent).toHaveBeenCalledWith('info msg', expect.objectContaining({
        level: LogLevel.INFO,
      }));
    });

    it('passes WARN level correctly', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      transport.write({ timestamp: Date.now(), level: LogLevel.WARN, message: 'warn msg' });

      expect(span.addEvent).toHaveBeenCalledWith('warn msg', expect.objectContaining({
        level: LogLevel.WARN,
      }));
    });

    it('passes ERROR level correctly', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      transport.write({ timestamp: Date.now(), level: LogLevel.ERROR, message: 'error msg' });

      expect(span.addEvent).toHaveBeenCalledWith('error msg', expect.objectContaining({
        level: LogLevel.ERROR,
      }));
    });

    it('passes DEBUG level correctly', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      transport.write({ timestamp: Date.now(), level: LogLevel.DEBUG, message: 'debug msg' });

      expect(span.addEvent).toHaveBeenCalledWith('debug msg', expect.objectContaining({
        level: LogLevel.DEBUG,
      }));
    });
  });

  // ── Metadata / context ──────────────────────────────────────────

  describe('metadata', () => {
    it('includes context attributes in span event', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'log with context',
        context: { requestId: 'abc123', duration: 42 },
      };

      transport.write(entry);

      expect(span.addEvent).toHaveBeenCalledWith('log with context', expect.objectContaining({
        level: LogLevel.INFO,
        requestId: 'abc123',
        duration: 42,
      }));
    });

    it('works with empty context', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'no context',
        context: {},
      };

      transport.write(entry);

      expect(span.addEvent).toHaveBeenCalledWith('no context', expect.objectContaining({
        level: LogLevel.INFO,
      }));
    });

    it('works without context field', () => {
      const tracer = createMockTracer();
      const transport = new OTelLogTransport(tracer);
      const span = createMockSpan();
      transport.setActiveSpan(span);

      const entry: LogEntry = {
        timestamp: Date.now(),
        level: LogLevel.INFO,
        message: 'undefined context',
      };

      transport.write(entry);

      expect(span.addEvent).toHaveBeenCalledWith('undefined context', expect.objectContaining({
        level: LogLevel.INFO,
      }));
    });
  });
});
