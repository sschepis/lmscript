/**
 * Example: OpenTelemetry Integration — Spans, Metrics, and Logging
 *
 * Demonstrates:
 *   - createTelemetryMiddleware() for automatic span/metric emission
 *   - OTelLogTransport for forwarding logs to tracing
 *   - Mock tracer/meter objects (no @opentelemetry dependency needed)
 *   - How spans and metrics are recorded during execution
 *   - Integration with the Logger via custom transport
 *
 * Usage:
 *   npx tsx src/examples/telemetry-demo.ts
 */

import { z } from "zod";
import {
  LScriptRuntime,
  MiddlewareManager,
  Logger,
  LogLevel,
  createTelemetryMiddleware,
  OTelLogTransport,
} from "../index.js";
import type {
  TelemetryTracer,
  TelemetrySpan,
  TelemetryMeter,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryConfig,
  LScriptFunction,
} from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── 1. Create mock OpenTelemetry objects ────────────────────────────

/**
 * A mock span that records attributes and events for demo visibility.
 */
class MockSpan implements TelemetrySpan {
  private name: string;
  private attributes: Record<string, string | number | boolean> = {};
  private events: Array<{ name: string; attrs?: Record<string, string | number | boolean> }> = [];
  private status?: { code: number; message?: string };

  constructor(name: string, options?: { attributes?: Record<string, string | number | boolean> }) {
    this.name = name;
    if (options?.attributes) {
      this.attributes = { ...options.attributes };
    }
    console.log(`     📍 Span started: "${name}"`);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setStatus(status: { code: number; message?: string }): void {
    this.status = status;
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    this.events.push({ name, attrs: attributes });
    console.log(`     📎 Span event: "${name}"`);
  }

  end(): void {
    const statusLabel = this.status?.code === 1 ? "OK" : this.status?.code === 2 ? "ERROR" : "UNSET";
    console.log(`     📍 Span ended: "${this.name}" [${statusLabel}]`);
    if (Object.keys(this.attributes).length > 0) {
      console.log(`        Attributes: ${JSON.stringify(this.attributes)}`);
    }
  }
}

/**
 * A mock tracer that creates MockSpan instances.
 */
class MockTracer implements TelemetryTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): TelemetrySpan {
    return new MockSpan(name, options);
  }
}

/**
 * Mock counter that logs additions.
 */
class MockCounter implements TelemetryCounter {
  constructor(private name: string) {}

  add(value: number, attributes?: Record<string, string | number | boolean>): void {
    console.log(`     📊 Counter "${this.name}" += ${value} ${attributes ? JSON.stringify(attributes) : ""}`);
  }
}

/**
 * Mock histogram that logs recordings.
 */
class MockHistogram implements TelemetryHistogram {
  constructor(private name: string) {}

  record(value: number, attributes?: Record<string, string | number | boolean>): void {
    console.log(`     📊 Histogram "${this.name}" = ${value} ${attributes ? JSON.stringify(attributes) : ""}`);
  }
}

/**
 * A mock meter that creates mock counters and histograms.
 */
class MockMeter implements TelemetryMeter {
  createCounter(name: string): TelemetryCounter {
    console.log(`   🔧 Created counter: "${name}"`);
    return new MockCounter(name);
  }

  createHistogram(name: string): TelemetryHistogram {
    console.log(`   🔧 Created histogram: "${name}"`);
    return new MockHistogram(name);
  }
}

// ── 2. Set up telemetry middleware ───────────────────────────────────

async function main() {
  console.log("📡 OpenTelemetry Integration Demo");
  console.log("═".repeat(60));

  // Create mock OTel objects
  const tracer = new MockTracer();
  const meter = new MockMeter();

  // Create telemetry config
  const telemetryConfig: TelemetryConfig = {
    tracer,
    meter,
    metricPrefix: "myapp",
    includePrompts: false, // Don't log sensitive prompts
  };

  // Create telemetry middleware
  console.log("\n🔧 Creating telemetry middleware...");
  const telemetryHooks = createTelemetryMiddleware(telemetryConfig);

  // Set up middleware manager and register hooks
  const middleware = new MiddlewareManager();
  middleware.use(telemetryHooks);

  // ── 3. Set up OTelLogTransport ──
  console.log("\n📝 Setting up OTelLogTransport...");
  const otelTransport = new OTelLogTransport(tracer);

  const logger = new Logger({
    level: LogLevel.DEBUG,
    transports: [otelTransport],
  });

  // ── 4. Create runtime with telemetry ──
  const mockProvider = new MockProvider({
    defaultResponse: JSON.stringify({
      translation: "Bonjour le monde!",
      language: "French",
    }),
  });

  const runtime = new LScriptRuntime({
    provider: mockProvider,
    middleware,
    logger,
  });

  // ── 5. Execute a function and observe telemetry ──
  const TranslationSchema = z.object({
    translation: z.string(),
    language: z.string(),
  });

  const translateFn: LScriptFunction<string, typeof TranslationSchema> = {
    name: "Translator",
    model: "mock-model",
    system: "You are a translator. Translate the given text to French.",
    prompt: (text: string) => `Translate: "${text}"`,
    schema: TranslationSchema,
    temperature: 0.3,
  };

  console.log("\n🚀 Executing function with telemetry...\n");

  // Set an active span for the log transport
  const rootSpan = tracer.startSpan("demo.translate");
  otelTransport.setActiveSpan(rootSpan);

  const result = await runtime.execute(translateFn, "Hello world!");

  rootSpan.end();

  console.log("\n✅ Result:");
  console.log(`   Translation: ${result.data.translation}`);
  console.log(`   Language: ${result.data.language}`);
  console.log(`   Attempts: ${result.attempts}`);

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
  console.log("ℹ️  In production, replace Mock* classes with real OpenTelemetry SDK objects:");
  console.log('   import { trace, metrics } from "@opentelemetry/api";');
  console.log('   const tracer = trace.getTracer("my-app");');
  console.log('   const meter = metrics.getMeter("my-app");');
}

main();
