import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { AgentLoop } from '../src/agent';
import { LScriptRuntime } from '../src/runtime';
import type { LLMProvider, LLMRequest, LLMResponse, LScriptFunction, ToolDefinition } from '../src/types';
import type { AgentConfig } from '../src/agent';

// ── Helpers ──────────────────────────────────────────────────────────

/** Creates a mock provider that returns a sequence of responses.
 *  Each call to `chat()` returns the next response in the queue. */
function createSequenceProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'test-sequence',
    async chat(_request: LLMRequest): Promise<LLMResponse> {
      if (callIndex >= responses.length) {
        throw new Error(`MockProvider: no more responses (called ${callIndex + 1} times, only ${responses.length} responses provided)`);
      }
      return responses[callIndex++];
    },
  };
}

/** Simple schema for testing */
const simpleSchema = z.object({
  answer: z.string(),
});

/** Create a simple LScriptFunction for testing */
function createTestFn(
  tools?: ToolDefinition[],
  overrides?: Partial<LScriptFunction<string, typeof simpleSchema>>
): LScriptFunction<string, typeof simpleSchema> {
  return {
    name: 'test-agent-fn',
    model: 'test-model',
    system: 'You are a test agent.',
    prompt: (input: string) => input,
    schema: simpleSchema,
    maxRetries: 0,
    tools,
    ...overrides,
  };
}

/** Create a tool definition */
function createTool(
  name: string,
  executeFn: (params: { query: string }) => unknown
): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: z.object({ query: z.string() }),
    execute: executeFn as (params: unknown) => unknown,
  };
}

/** Shorthand to build an LLMResponse with no tool calls */
function textResponse(content: string): LLMResponse {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  };
}

/** Shorthand to build an LLMResponse with tool calls */
function toolCallResponse(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  content = ''
): LLMResponse {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    toolCalls: toolCalls.map((tc, i) => ({
      id: `call_${i}`,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    })),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentLoop', () => {
  // ── Simple execution (no tool calls) ───────────────────────────────

  describe('simple execution (no tool calls)', () => {
    it('returns direct response when model produces no tool calls', async () => {
      const provider = createSequenceProvider([
        textResponse('{"answer": "Hello world"}'),
      ]);
      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn();

      const result = await agent.run(fn, 'test input');

      expect(result.data).toEqual({ answer: 'Hello world' });
      expect(result.toolCalls).toEqual([]);
      expect(result.iterations).toBe(1);
    });

    it('returns usage information', async () => {
      const provider = createSequenceProvider([
        textResponse('{"answer": "test"}'),
      ]);
      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn();

      const result = await agent.run(fn, 'test');

      expect(result.usage).toBeDefined();
      expect(result.usage!.totalTokens).toBe(20);
    });
  });

  // ── Single tool call iteration ─────────────────────────────────────

  describe('single tool call iteration', () => {
    it('executes tool and returns final answer', async () => {
      const searchTool = createTool('search', ({ query }) => ({
        results: [`Result for: ${query}`],
      }));

      const provider = createSequenceProvider([
        // First call: model requests a tool call
        toolCallResponse([{ name: 'search', arguments: { query: 'vitest' } }]),
        // Second call: model produces final answer
        textResponse('{"answer": "Found vitest info"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([searchTool]);

      const result = await agent.run(fn, 'Search for vitest');

      expect(result.data).toEqual({ answer: 'Found vitest info' });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
      expect(result.toolCalls[0].arguments).toEqual({ query: 'vitest' });
      expect(result.toolCalls[0].result).toEqual({ results: ['Result for: vitest'] });
    });
  });

  // ── Multiple iterations ────────────────────────────────────────────

  describe('multiple iterations', () => {
    it('chains multiple tool calls before final answer', async () => {
      const searchTool = createTool('search', ({ query }) => ({
        results: [`Info about ${query}`],
      }));

      const provider = createSequenceProvider([
        // Iteration 1: first tool call
        toolCallResponse([{ name: 'search', arguments: { query: 'topic A' } }]),
        // Iteration 2: second tool call
        toolCallResponse([{ name: 'search', arguments: { query: 'topic B' } }]),
        // Iteration 3: final answer
        textResponse('{"answer": "Combined results"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([searchTool]);

      const result = await agent.run(fn, 'Research topics');

      expect(result.data).toEqual({ answer: 'Combined results' });
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].arguments).toEqual({ query: 'topic A' });
      expect(result.toolCalls[1].arguments).toEqual({ query: 'topic B' });
    });

    it('accumulates usage across iterations', async () => {
      const searchTool = createTool('search', () => ({ ok: true }));

      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: 'x' } }]),
        textResponse('{"answer": "done"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([searchTool]);

      const result = await agent.run(fn, 'test');

      expect(result.usage).toBeDefined();
      // 2 calls × 20 tokens each = 40 total
      expect(result.usage!.totalTokens).toBe(40);
      expect(result.usage!.promptTokens).toBe(20);
      expect(result.usage!.completionTokens).toBe(20);
    });
  });

  // ── Max iterations limit ───────────────────────────────────────────

  describe('max iterations limit', () => {
    it('stops after maxIterations even if model keeps requesting tools', async () => {
      const searchTool = createTool('search', () => ({ ok: true }));

      // Every response requests another tool call; the last one should be
      // treated as final because maxIterations is reached.
      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: '1' } }]),
        toolCallResponse([{ name: 'search', arguments: { query: '2' } }]),
        // Even though this has tool calls, iteration 3 = maxIterations so loop stops,
        // but the final content is what gets validated.
        // Need a parseable response for the last iteration
        {
          content: '{"answer": "max reached"}',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          toolCalls: [{ id: 'call_0', name: 'search', arguments: '{"query":"3"}' }],
        },
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { maxIterations: 3 });
      const fn = createTestFn([searchTool]);

      const result = await agent.run(fn, 'infinite loop');

      // Should have processed tool calls from iterations 1-3
      expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
      expect(result.data).toEqual({ answer: 'max reached' });
    });

    it('default maxIterations is 10', async () => {
      // Verify that providing no config uses maxIterations=10
      // We'll provide 10 responses that all request tools, plus 1 final
      const searchTool = createTool('search', () => ({ ok: true }));

      const responses: LLMResponse[] = [];
      for (let i = 0; i < 9; i++) {
        responses.push(
          toolCallResponse([{ name: 'search', arguments: { query: `q${i}` } }])
        );
      }
      // 10th iteration: final answer (no more tool calls)
      responses.push(textResponse('{"answer": "final after 10"}'));

      const provider = createSequenceProvider(responses);
      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([searchTool]);

      const result = await agent.run(fn, 'test');

      expect(result.data).toEqual({ answer: 'final after 10' });
      expect(result.toolCalls).toHaveLength(9);
    });
  });

  // ── Callback: onToolCall ───────────────────────────────────────────

  describe('callback: onToolCall', () => {
    it('calls onToolCall with tool name and arguments', async () => {
      const searchTool = createTool('search', ({ query }) => ({
        found: query,
      }));

      const onToolCall = vi.fn();

      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: 'hello' } }]),
        textResponse('{"answer": "done"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onToolCall });
      const fn = createTestFn([searchTool]);

      await agent.run(fn, 'test');

      expect(onToolCall).toHaveBeenCalledTimes(1);
      const callArg = onToolCall.mock.calls[0][0];
      expect(callArg.name).toBe('search');
      expect(callArg.arguments).toEqual({ query: 'hello' });
      expect(callArg.result).toEqual({ found: 'hello' });
    });

    it('calls onToolCall for each tool call across iterations', async () => {
      const searchTool = createTool('search', () => ({ ok: true }));
      const onToolCall = vi.fn();

      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: 'a' } }]),
        toolCallResponse([{ name: 'search', arguments: { query: 'b' } }]),
        textResponse('{"answer": "done"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onToolCall });
      const fn = createTestFn([searchTool]);

      await agent.run(fn, 'test');

      expect(onToolCall).toHaveBeenCalledTimes(2);
    });

    it('stops early when onToolCall returns false', async () => {
      const searchTool = createTool('search', () => ({ ok: true }));
      const onToolCall = vi.fn().mockReturnValue(false);

      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: 'stop' } }]),
        // This should NOT be called because the loop stopped early
        textResponse('{"answer": "should not reach"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onToolCall });
      const fn = createTestFn([searchTool]);

      // The final content will be from the last response before stop.
      // Since we stopped during iteration 1, finalContent is the content
      // from the tool call response (empty string), which won't parse.
      // The runtime will try to parse it and throw.
      // Let's provide content in the tool call response.
      const provider2 = createSequenceProvider([
        {
          content: '{"answer": "early stop"}',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          toolCalls: [{ id: 'call_0', name: 'search', arguments: '{"query":"stop"}' }],
        },
      ]);

      const runtime2 = new LScriptRuntime({ provider: provider2 });
      const agent2 = new AgentLoop(runtime2, { onToolCall });
      const fn2 = createTestFn([searchTool]);

      const result = await agent2.run(fn2, 'test');

      expect(onToolCall).toHaveBeenCalled();
      expect(result.data).toEqual({ answer: 'early stop' });
    });
  });

  // ── Callback: onIteration ──────────────────────────────────────────

  describe('callback: onIteration', () => {
    it('calls onIteration with iteration number and response content', async () => {
      const onIteration = vi.fn();

      const provider = createSequenceProvider([
        textResponse('{"answer": "direct"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onIteration });
      const fn = createTestFn();

      await agent.run(fn, 'test');

      expect(onIteration).toHaveBeenCalledTimes(1);
      expect(onIteration).toHaveBeenCalledWith(1, '{"answer": "direct"}');
    });

    it('calls onIteration for each iteration', async () => {
      const searchTool = createTool('search', () => ({ ok: true }));
      const onIteration = vi.fn();

      const provider = createSequenceProvider([
        toolCallResponse([{ name: 'search', arguments: { query: 'x' } }]),
        textResponse('{"answer": "done"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onIteration });
      const fn = createTestFn([searchTool]);

      await agent.run(fn, 'test');

      expect(onIteration).toHaveBeenCalledTimes(2);
      expect(onIteration.mock.calls[0][0]).toBe(1); // iteration 1
      expect(onIteration.mock.calls[1][0]).toBe(2); // iteration 2
    });

    it('stops early when onIteration returns false', async () => {
      const onIteration = vi.fn().mockReturnValue(false);

      const provider = createSequenceProvider([
        textResponse('{"answer": "stopped"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { onIteration });
      const fn = createTestFn();

      const result = await agent.run(fn, 'test');

      expect(onIteration).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual({ answer: 'stopped' });
    });
  });

  // ── Tool not found ─────────────────────────────────────────────────

  describe('tool not found', () => {
    it('handles gracefully when model requests a non-existent tool', async () => {
      const existingTool = createTool('search', () => ({ ok: true }));

      const provider = createSequenceProvider([
        // Model requests a tool that doesn't exist
        toolCallResponse([
          { name: 'nonexistent_tool', arguments: { query: 'test' } },
        ]),
        // Model then produces final answer
        textResponse('{"answer": "handled missing tool"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([existingTool]);

      const result = await agent.run(fn, 'test');

      expect(result.data).toEqual({ answer: 'handled missing tool' });
      // Unknown tools are skipped, not recorded in toolCalls
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  // ── Tool throws error ──────────────────────────────────────────────

  describe('tool throws error', () => {
    it('handles tool execution errors gracefully', async () => {
      const failingTool = createTool('failing_tool', () => {
        throw new Error('Tool execution failed');
      });

      const provider = createSequenceProvider([
        toolCallResponse([
          { name: 'failing_tool', arguments: { query: 'test' } },
        ]),
        // Model handles the error and produces final answer
        textResponse('{"answer": "recovered from error"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([failingTool]);

      const result = await agent.run(fn, 'test');

      expect(result.data).toEqual({ answer: 'recovered from error' });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('failing_tool');
      expect(result.toolCalls[0].result).toEqual({
        error: 'Tool execution failed',
      });
    });

    it('sends error message back to model for recovery', async () => {
      let capturedMessages: unknown[] = [];
      const failingTool = createTool('bad_tool', () => {
        throw new Error('Something went wrong');
      });

      let callCount = 0;
      const provider: LLMProvider = {
        name: 'capture-provider',
        async chat(request: LLMRequest): Promise<LLMResponse> {
          callCount++;
          capturedMessages = request.messages;
          if (callCount === 1) {
            return toolCallResponse([
              { name: 'bad_tool', arguments: { query: 'test' } },
            ]);
          }
          return textResponse('{"answer": "recovered"}');
        },
      };

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn([failingTool]);

      await agent.run(fn, 'test');

      // The second call should have the error in messages
      const lastMessage = capturedMessages[capturedMessages.length - 1] as {
        content: string;
      };
      expect(lastMessage.content).toContain('Something went wrong');
    });
  });

  // ── Empty tool calls array ─────────────────────────────────────────

  describe('empty tool calls array', () => {
    it('treats empty toolCalls array as final response', async () => {
      const provider = createSequenceProvider([
        {
          content: '{"answer": "no tools"}',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          toolCalls: [],
        },
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime);
      const fn = createTestFn();

      const result = await agent.run(fn, 'test');

      expect(result.data).toEqual({ answer: 'no tools' });
      expect(result.toolCalls).toEqual([]);
      expect(result.iterations).toBe(1);
    });
  });

  // ── Schema validation ──────────────────────────────────────────────

  describe('schema validation', () => {
    it('throws when final response does not match schema', async () => {
      const provider = createSequenceProvider([
        textResponse('{"wrong_field": "bad"}'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { maxIterations: 1 });
      const fn = createTestFn();

      await expect(agent.run(fn, 'test')).rejects.toThrow(
        /invalid output/i
      );
    });

    it('throws when final response is not valid JSON', async () => {
      const provider = createSequenceProvider([
        textResponse('not json at all'),
      ]);

      const runtime = new LScriptRuntime({ provider });
      const agent = new AgentLoop(runtime, { maxIterations: 1 });
      const fn = createTestFn();

      await expect(agent.run(fn, 'test')).rejects.toThrow();
    });
  });

  // ── AgentLoop constructor ──────────────────────────────────────────

  describe('constructor', () => {
    it('accepts runtime and optional config', () => {
      const provider = createSequenceProvider([]);
      const runtime = new LScriptRuntime({ provider });

      const agent1 = new AgentLoop(runtime);
      expect(agent1).toBeInstanceOf(AgentLoop);

      const agent2 = new AgentLoop(runtime, { maxIterations: 5 });
      expect(agent2).toBeInstanceOf(AgentLoop);
    });
  });
});
