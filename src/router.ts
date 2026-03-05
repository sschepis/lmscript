import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LScriptFunction,
} from "./types.js";

// ── Routing Rule ────────────────────────────────────────────────────

export interface RoutingRule {
  /** Pattern to match against function name or model field */
  match: string | RegExp | ((fn: LScriptFunction<any, any>) => boolean);
  /** Provider to route to */
  provider: LLMProvider;
  /** Optional model override */
  modelOverride?: string;
}

// ── Model Router ────────────────────────────────────────────────────

/**
 * Routes LLM requests to different providers based on configurable rules.
 *
 * Rules are evaluated in order; the first matching rule determines the
 * provider. If no rules match, the `defaultProvider` is used.
 */
export class ModelRouter implements LLMProvider {
  readonly name = "router";

  private rules: RoutingRule[];
  private defaultProvider: LLMProvider;

  constructor(config: {
    rules: RoutingRule[];
    defaultProvider: LLMProvider;
  }) {
    this.rules = [...config.rules];
    this.defaultProvider = config.defaultProvider;
  }

  /**
   * Add a routing rule. Rules are evaluated in the order they were added.
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove all rules whose match is the given string or RegExp.
   * For string matches, compares by value.
   * For RegExp matches, compares by `.toString()`.
   */
  removeRule(match: string | RegExp): void {
    this.rules = this.rules.filter((rule) => {
      if (typeof match === "string" && typeof rule.match === "string") {
        return rule.match !== match;
      }
      if (match instanceof RegExp && rule.match instanceof RegExp) {
        return rule.match.toString() !== match.toString();
      }
      return true;
    });
  }

  /**
   * Given an LScriptFunction, determine which provider and model to use
   * by evaluating rules against the function's `name` and `model` fields.
   */
  resolveProvider(
    fn: LScriptFunction<any, any>
  ): { provider: LLMProvider; modelOverride?: string } {
    for (const rule of this.rules) {
      if (this.matchesRule(rule, fn.name, fn.model, fn)) {
        return {
          provider: rule.provider,
          modelOverride: rule.modelOverride,
        };
      }
    }
    return { provider: this.defaultProvider };
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const { provider, modelOverride } = this.resolveForRequest(request);
    const effectiveRequest = modelOverride
      ? { ...request, model: modelOverride }
      : request;
    return provider.chat(effectiveRequest);
  }

  async *chatStream(request: LLMRequest): AsyncIterable<string> {
    const { provider, modelOverride } = this.resolveForRequest(request);
    const effectiveRequest = modelOverride
      ? { ...request, model: modelOverride }
      : request;

    if (provider.chatStream) {
      yield* provider.chatStream(effectiveRequest);
    } else {
      // Fall back to non-streaming
      const response = await provider.chat(effectiveRequest);
      yield response.content;
    }
  }

  /**
   * Evaluate rules against a request's model field.
   * Since LLMRequest doesn't carry a function name, we match against model.
   */
  private resolveForRequest(
    request: LLMRequest
  ): { provider: LLMProvider; modelOverride?: string } {
    for (const rule of this.rules) {
      if (this.matchesRule(rule, request.model, request.model)) {
        return {
          provider: rule.provider,
          modelOverride: rule.modelOverride,
        };
      }
    }
    return { provider: this.defaultProvider };
  }

  private matchesRule(
    rule: RoutingRule,
    name: string,
    model: string,
    fn?: LScriptFunction<any, any>
  ): boolean {
    const { match } = rule;

    if (typeof match === "string") {
      return name === match || model === match;
    }

    if (match instanceof RegExp) {
      return match.test(name) || match.test(model);
    }

    if (typeof match === "function" && fn) {
      return match(fn);
    }

    return false;
  }
}
