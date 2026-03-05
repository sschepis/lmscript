import type {
  ExecutionContext,
  ExecutionResult,
  MiddlewareHooks,
} from "./types.js";

/**
 * MiddlewareManager manages a list of middleware hooks and runs them
 * at appropriate points during the LScriptRuntime execution lifecycle.
 *
 * Hooks run in registration order. Errors in hooks are caught and logged
 * to prevent them from crashing the execution.
 */
export class MiddlewareManager {
  private hooks: MiddlewareHooks[] = [];

  /** Register a set of middleware hooks. */
  use(hooks: MiddlewareHooks): void {
    this.hooks.push(hooks);
  }

  /** Unregister a previously registered set of middleware hooks. */
  remove(hooks: MiddlewareHooks): void {
    const idx = this.hooks.indexOf(hooks);
    if (idx !== -1) {
      this.hooks.splice(idx, 1);
    }
  }

  /** Run all onBeforeExecute hooks in order. */
  async runBeforeExecute(ctx: ExecutionContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onBeforeExecute) {
        try {
          await h.onBeforeExecute(ctx);
        } catch (err) {
          console.error("[lmscript middleware] onBeforeExecute hook error:", err);
        }
      }
    }
  }

  /** Run all onAfterValidation hooks in order. */
  async runAfterValidation(ctx: ExecutionContext, result: unknown): Promise<void> {
    for (const h of this.hooks) {
      if (h.onAfterValidation) {
        try {
          await h.onAfterValidation(ctx, result);
        } catch (err) {
          console.error("[lmscript middleware] onAfterValidation hook error:", err);
        }
      }
    }
  }

  /** Run all onRetry hooks in order. */
  async runRetry(ctx: ExecutionContext, error: Error): Promise<void> {
    for (const h of this.hooks) {
      if (h.onRetry) {
        try {
          await h.onRetry(ctx, error);
        } catch (err) {
          console.error("[lmscript middleware] onRetry hook error:", err);
        }
      }
    }
  }

  /** Run all onError hooks in order. */
  async runError(ctx: ExecutionContext, error: Error): Promise<void> {
    for (const h of this.hooks) {
      if (h.onError) {
        try {
          await h.onError(ctx, error);
        } catch (err) {
          console.error("[lmscript middleware] onError hook error:", err);
        }
      }
    }
  }

  /** Run all onComplete hooks in order. */
  async runComplete(ctx: ExecutionContext, result: ExecutionResult<unknown>): Promise<void> {
    for (const h of this.hooks) {
      if (h.onComplete) {
        try {
          await h.onComplete(ctx, result);
        } catch (err) {
          console.error("[lmscript middleware] onComplete hook error:", err);
        }
      }
    }
  }
}
