// ── Structured Logging for L-Script ─────────────────────────────────

import { randomBytes } from "crypto";

// ── LogLevel enum ───────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

// ── LogEntry interface ──────────────────────────────────────────────

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  spanId?: string;
  traceId?: string;
}

// ── LogTransport interface ──────────────────────────────────────────

export interface LogTransport {
  write(entry: LogEntry): void;
}

// ── ConsoleTransport ────────────────────────────────────────────────

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.SILENT]: "SILENT",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "\x1b[36m",  // cyan
  [LogLevel.INFO]: "\x1b[32m",   // green
  [LogLevel.WARN]: "\x1b[33m",   // yellow
  [LogLevel.ERROR]: "\x1b[31m",  // red
  [LogLevel.SILENT]: "",
};

const RESET = "\x1b[0m";

export class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const color = LEVEL_COLORS[entry.level] || "";
    const label = LEVEL_LABELS[entry.level] || "UNKNOWN";
    const time = new Date(entry.timestamp).toISOString();

    let line = `${color}[${label}]${RESET} ${time} ${entry.message}`;

    if (entry.spanId) {
      line += ` [span:${entry.spanId}]`;
    }
    if (entry.traceId) {
      line += ` [trace:${entry.traceId}]`;
    }
    if (entry.context && Object.keys(entry.context).length > 0) {
      line += ` ${JSON.stringify(entry.context)}`;
    }

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(line);
        break;
      case LogLevel.WARN:
        console.warn(line);
        break;
      case LogLevel.DEBUG:
        console.debug(line);
        break;
      default:
        console.log(line);
        break;
    }
  }
}

// ── Span ────────────────────────────────────────────────────────────

export class Span {
  readonly id: string;
  readonly name: string;
  readonly startTime: number;
  private logger: Logger;

  constructor(name: string, logger: Logger) {
    this.id = randomBytes(8).toString("hex");
    this.name = name;
    this.startTime = Date.now();
    this.logger = logger;
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.logger.logWithSpan(level, message, this.id, context);
  }

  end(): { duration: number } {
    const duration = Date.now() - this.startTime;
    this.log(LogLevel.DEBUG, `Span "${this.name}" ended`, { duration });
    return { duration };
  }
}

// ── Logger ──────────────────────────────────────────────────────────

export interface LoggerOptions {
  level?: LogLevel;
  transports?: LogTransport[];
}

export class Logger {
  private level: LogLevel;
  private transports: LogTransport[];

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.transports = options.transports ?? [new ConsoleTransport()];
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, context);
  }

  startSpan(name: string): Span {
    return new Span(name, this);
  }

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  /** Get the current log level. */
  getLevel(): LogLevel {
    return this.level;
  }

  /** @internal Used by Span to attach spanId to entries. */
  logWithSpan(
    level: LogLevel,
    message: string,
    spanId: string,
    context?: Record<string, unknown>
  ): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      spanId,
    };

    for (const transport of this.transports) {
      transport.write(entry);
    }
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
    };

    for (const transport of this.transports) {
      transport.write(entry);
    }
  }
}
