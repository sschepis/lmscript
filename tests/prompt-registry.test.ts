import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { PromptRegistry } from '../src/prompt-registry';
import type { PromptVariant, VariantMetrics } from '../src/prompt-registry';
import type { LScriptFunction, ExecutionResult } from '../src/types';

// ── Helpers ─────────────────────────────────────────────────────────

function makeFn(name: string): LScriptFunction<string, z.ZodString> {
  return {
    name,
    model: 'test-model',
    system: 'You are a test assistant.',
    prompt: (input: string) => `Process: ${input}`,
    schema: z.string(),
    temperature: 0.7,
  };
}

function makeVariant(name: string, overrides?: Partial<PromptVariant<string>>): PromptVariant<string> {
  return { name, weight: 1, ...overrides };
}

function makeResult(attempts = 1, totalTokens = 100): ExecutionResult<unknown> {
  return {
    data: 'ok',
    attempts,
    usage: { promptTokens: 60, completionTokens: 40, totalTokens },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PromptRegistry', () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  // 1. registerVariants
  describe('registerVariants()', () => {
    it('registers variants for a function name', () => {
      const variants = [makeVariant('A'), makeVariant('B')];
      registry.registerVariants('fn1', variants);

      expect(registry.hasVariants('fn1')).toBe(true);
    });

    it('returns void (not fluent)', () => {
      const result = registry.registerVariants('fn1', [makeVariant('A')]);
      expect(result).toBeUndefined();
    });
  });

  // 2-3. addVariant-like behavior via registerVariants with weights
  describe('registerVariants() with weight', () => {
    it('supports custom weights on variants', () => {
      const variants = [
        makeVariant('heavy', { weight: 10 }),
        makeVariant('light', { weight: 1 }),
      ];
      registry.registerVariants('fn1', variants);

      // Verify variants are registered
      expect(registry.hasVariants('fn1')).toBe(true);
    });
  });

  // 4. selectVariant with 'weighted'
  describe('selectVariant() with "weighted" strategy', () => {
    it('selects variants proportional to weight', () => {
      const reg = new PromptRegistry({ strategy: 'weighted' });
      // Give one variant overwhelming weight so it's almost always selected
      const variants = [
        makeVariant('heavy', { weight: 1000 }),
        makeVariant('light', { weight: 1 }),
      ];
      reg.registerVariants('fn1', variants);

      const counts: Record<string, number> = { heavy: 0, light: 0 };
      for (let i = 0; i < 200; i++) {
        const v = reg.selectVariant('fn1');
        if (v) counts[v.name]++;
      }

      // With weight ratio 1000:1, 'heavy' should dominate
      expect(counts.heavy).toBeGreaterThan(counts.light);
      expect(counts.heavy).toBeGreaterThan(180);
    });
  });

  // 5. selectVariant with 'round-robin'
  describe('selectVariant() with "round-robin" strategy', () => {
    it('cycles through variants in order', () => {
      const reg = new PromptRegistry({ strategy: 'round-robin' });
      const variants = [makeVariant('A'), makeVariant('B'), makeVariant('C')];
      reg.registerVariants('fn1', variants);

      expect(reg.selectVariant('fn1')?.name).toBe('A');
      expect(reg.selectVariant('fn1')?.name).toBe('B');
      expect(reg.selectVariant('fn1')?.name).toBe('C');
      expect(reg.selectVariant('fn1')?.name).toBe('A'); // wraps around
      expect(reg.selectVariant('fn1')?.name).toBe('B');
    });
  });

  // 6. selectVariant with 'random'
  describe('selectVariant() with "random" strategy', () => {
    it('returns a valid variant each time', () => {
      const reg = new PromptRegistry({ strategy: 'random' });
      const variantNames = ['X', 'Y', 'Z'];
      reg.registerVariants('fn1', variantNames.map(n => makeVariant(n)));

      for (let i = 0; i < 50; i++) {
        const v = reg.selectVariant('fn1');
        expect(v).toBeDefined();
        expect(variantNames).toContain(v!.name);
      }
    });
  });

  // 7. applyVariant
  describe('applyVariant()', () => {
    it('applies variant prompt override to the function', () => {
      const fn = makeFn('myFn');
      const variant = makeVariant('concise', {
        prompt: (input: string) => `Be concise: ${input}`,
        system: 'You are concise.',
        temperature: 0.2,
      });

      const applied = registry.applyVariant(fn, variant);

      expect(applied.name).toBe('myFn[concise]');
      expect(applied.system).toBe('You are concise.');
      expect(applied.temperature).toBe(0.2);
      expect(applied.prompt('hello')).toBe('Be concise: hello');
    });

    it('preserves original fields when variant does not override them', () => {
      const fn = makeFn('myFn');
      const variant = makeVariant('minimal');

      const applied = registry.applyVariant(fn, variant);

      expect(applied.name).toBe('myFn[minimal]');
      expect(applied.system).toBe(fn.system);
      expect(applied.temperature).toBe(fn.temperature);
      expect(applied.model).toBe(fn.model);
      expect(applied.prompt('test')).toBe(fn.prompt('test'));
    });

    it('applies model override', () => {
      const fn = makeFn('myFn');
      const variant = makeVariant('gpt4', { model: 'gpt-4o' });

      const applied = registry.applyVariant(fn, variant);
      expect(applied.model).toBe('gpt-4o');
    });
  });

  // 8. recordResult
  describe('recordResult()', () => {
    it('records success metrics including token usage', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);

      registry.recordResult('fn1', 'A', makeResult(1, 100));
      registry.recordResult('fn1', 'A', makeResult(2, 200));

      const metrics = registry.getMetrics('fn1');
      const m = metrics.find(m => m.name === 'A')!;

      expect(m.executions).toBe(2);
      expect(m.successes).toBe(2);
      expect(m.successRate).toBe(1.0);
      expect(m.totalTokens).toBe(300);
      expect(m.avgTokens).toBe(150);
      expect(m.avgAttempts).toBe(1.5); // (1 + 2) / 2
    });
  });

  // 9. recordFailure
  describe('recordFailure()', () => {
    it('records failure metrics (increments executions, not successes)', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);

      registry.recordResult('fn1', 'A', makeResult(1, 100));
      registry.recordFailure('fn1', 'A');

      const metrics = registry.getMetrics('fn1');
      const m = metrics.find(m => m.name === 'A')!;

      expect(m.executions).toBe(2);
      expect(m.successes).toBe(1);
      expect(m.successRate).toBe(0.5);
    });
  });

  // 10. getMetrics
  describe('getMetrics()', () => {
    it('returns metrics for all variants of a function', () => {
      registry.registerVariants('fn1', [makeVariant('A'), makeVariant('B')]);

      registry.recordResult('fn1', 'A', makeResult(1, 100));
      registry.recordResult('fn1', 'B', makeResult(1, 50));

      const metrics = registry.getMetrics('fn1');

      expect(metrics).toHaveLength(2);
      expect(metrics.map(m => m.name).sort()).toEqual(['A', 'B']);
    });

    it('returns empty array for unregistered function', () => {
      expect(registry.getMetrics('nonexistent')).toEqual([]);
    });

    it('returns zero metrics for variants with no executions', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);

      const metrics = registry.getMetrics('fn1');
      const m = metrics[0];

      expect(m.executions).toBe(0);
      expect(m.successes).toBe(0);
      expect(m.successRate).toBe(0);
      expect(m.avgAttempts).toBe(0);
      expect(m.avgTokens).toBe(0);
      expect(m.totalTokens).toBe(0);
    });
  });

  // 11. getBestVariant
  describe('getBestVariant()', () => {
    it('returns variant with highest success rate', () => {
      registry.registerVariants('fn1', [makeVariant('A'), makeVariant('B')]);

      // A: 1 success, 1 failure => 50%
      registry.recordResult('fn1', 'A', makeResult(1, 100));
      registry.recordFailure('fn1', 'A');

      // B: 2 successes => 100%
      registry.recordResult('fn1', 'B', makeResult(1, 100));
      registry.recordResult('fn1', 'B', makeResult(1, 100));

      const best = registry.getBestVariant('fn1');
      expect(best).toBeDefined();
      expect(best!.name).toBe('B');
    });

    // 12. getBestVariant tiebreaker
    it('breaks ties by lower avgTokens', () => {
      registry.registerVariants('fn1', [makeVariant('A'), makeVariant('B')]);

      // Both 100% success rate, but different token usage
      registry.recordResult('fn1', 'A', makeResult(1, 200));
      registry.recordResult('fn1', 'B', makeResult(1, 50));

      const best = registry.getBestVariant('fn1');
      expect(best).toBeDefined();
      expect(best!.name).toBe('B'); // lower avgTokens wins
    });

    it('returns undefined when no executions recorded', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);
      expect(registry.getBestVariant('fn1')).toBeUndefined();
    });

    it('returns undefined for unregistered function', () => {
      expect(registry.getBestVariant('nonexistent')).toBeUndefined();
    });
  });

  // 13. hasVariants (listVariants equivalent)
  describe('hasVariants()', () => {
    it('returns true when variants are registered', () => {
      registry.registerVariants('fn1', [makeVariant('A'), makeVariant('B')]);
      expect(registry.hasVariants('fn1')).toBe(true);
    });

    it('returns false for unregistered function', () => {
      expect(registry.hasVariants('nonexistent')).toBe(false);
    });
  });

  // 14. Error cases
  describe('error cases', () => {
    it('selectVariant returns undefined for unregistered function', () => {
      expect(registry.selectVariant('nonexistent')).toBeUndefined();
    });

    it('recordResult is a no-op for unregistered function', () => {
      // Should not throw
      registry.recordResult('nonexistent', 'A', makeResult());
      expect(registry.getMetrics('nonexistent')).toEqual([]);
    });

    it('recordResult is a no-op for unregistered variant name', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);
      // Should not throw
      registry.recordResult('fn1', 'unknown_variant', makeResult());
      const metrics = registry.getMetrics('fn1');
      expect(metrics[0].executions).toBe(0); // unchanged
    });

    it('recordFailure is a no-op for unregistered function', () => {
      registry.recordFailure('nonexistent', 'A');
      expect(registry.getMetrics('nonexistent')).toEqual([]);
    });
  });

  // 15. Multiple functions
  describe('multiple functions', () => {
    it('manages variants for different functions independently', () => {
      registry.registerVariants('fn1', [makeVariant('A'), makeVariant('B')]);
      registry.registerVariants('fn2', [makeVariant('X'), makeVariant('Y'), makeVariant('Z')]);

      expect(registry.hasVariants('fn1')).toBe(true);
      expect(registry.hasVariants('fn2')).toBe(true);

      registry.recordResult('fn1', 'A', makeResult(1, 100));
      registry.recordResult('fn2', 'Z', makeResult(1, 50));

      const fn1Metrics = registry.getMetrics('fn1');
      const fn2Metrics = registry.getMetrics('fn2');

      expect(fn1Metrics).toHaveLength(2);
      expect(fn2Metrics).toHaveLength(3);

      // fn1 variant A has executions; fn2 variant A should not exist
      expect(fn1Metrics.find(m => m.name === 'A')!.executions).toBe(1);
      expect(fn2Metrics.find(m => m.name === 'Z')!.executions).toBe(1);
      expect(fn2Metrics.find(m => m.name === 'X')!.executions).toBe(0);
    });
  });

  // resetMetrics
  describe('resetMetrics()', () => {
    it('resets all recorded metrics to zero', () => {
      registry.registerVariants('fn1', [makeVariant('A')]);
      registry.recordResult('fn1', 'A', makeResult(1, 100));

      registry.resetMetrics();

      const metrics = registry.getMetrics('fn1');
      expect(metrics[0].executions).toBe(0);
      expect(metrics[0].successes).toBe(0);
      expect(metrics[0].totalTokens).toBe(0);
    });
  });

  // Default strategy
  describe('default strategy', () => {
    it('defaults to "weighted" strategy', () => {
      const reg = new PromptRegistry();
      reg.registerVariants('fn1', [makeVariant('A', { weight: 1 })]);

      // Should not throw, variant should be selectable
      const v = reg.selectVariant('fn1');
      expect(v).toBeDefined();
      expect(v!.name).toBe('A');
    });
  });
});
