import { describe, it, expect } from 'vitest';
import { estimateTokens, simpleTokenEstimator } from '../src/tokenizer';
import type { TokenCounter } from '../src/tokenizer';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null/undefined coerced falsy input', () => {
    // The function checks `if (!text) return 0`
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('returns a reasonable estimate for a short string', () => {
    const tokens = estimateTokens('hello world');
    // "hello world" ≈ 2-3 tokens; must be at least 1
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  it('returns a proportionally larger estimate for longer text', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens('hi '.repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  it('different text produces different estimates', () => {
    const a = estimateTokens('The quick brown fox jumps over the lazy dog.');
    const b = estimateTokens('abc');
    expect(a).not.toBe(b);
  });

  it('produces consistent results for the same input', () => {
    const text = 'Consistency check with numbers 12345 and punctuation!';
    const first = estimateTokens(text);
    const second = estimateTokens(text);
    expect(first).toBe(second);
  });

  it('handles punctuation as individual tokens', () => {
    // "!!!" splits into 3 punctuation characters → 3 tokens
    const tokens = estimateTokens('!!!');
    expect(tokens).toBeGreaterThanOrEqual(3);
  });

  it('handles numeric strings', () => {
    const tokens = estimateTokens('1234567890');
    // ~3 digits per token → ~4 tokens
    expect(tokens).toBeGreaterThanOrEqual(1);
  });

  it('handles long words with subword splitting', () => {
    const tokens = estimateTokens('antidisestablishmentarianism');
    // 28 chars → ceil(28/4) = 7 tokens
    expect(tokens).toBeGreaterThanOrEqual(5);
  });

  it('handles CJK characters', () => {
    const tokens = estimateTokens('日本語テスト');
    // 6 CJK chars × 1.5 ≈ 9, ceiled
    expect(tokens).toBeGreaterThanOrEqual(1);
  });

  it('handles mixed CJK and Latin', () => {
    const tokens = estimateTokens('hello世界');
    expect(tokens).toBeGreaterThanOrEqual(2);
  });

  it('handles whitespace-only strings', () => {
    const tokens = estimateTokens('   ');
    expect(tokens).toBeGreaterThanOrEqual(1);
  });
});

describe('simpleTokenEstimator', () => {
  it('returns a function matching TokenCounter type', () => {
    const counter = simpleTokenEstimator();
    expect(typeof counter).toBe('function');

    // Verify it matches the TokenCounter signature
    const fn: TokenCounter = counter;
    expect(fn('test')).toBeTypeOf('number');
  });

  it('returns 0 for an empty string', () => {
    const counter = simpleTokenEstimator();
    // Math.ceil(0 / 4) = 0
    expect(counter('')).toBe(0);
  });

  it('estimates based on length / 4 by default', () => {
    const counter = simpleTokenEstimator();
    // "hello" → 5 chars → ceil(5/4) = 2
    expect(counter('hello')).toBe(2);
    // "hi" → 2 chars → ceil(2/4) = 1
    expect(counter('hi')).toBe(1);
    // "abcdefgh" → 8 chars → ceil(8/4) = 2
    expect(counter('abcdefgh')).toBe(2);
  });

  it('supports custom charsPerToken parameter', () => {
    const counter = simpleTokenEstimator(2);
    // "hello" → 5 chars → ceil(5/2) = 3
    expect(counter('hello')).toBe(3);
    // "abcdef" → 6 chars → ceil(6/2) = 3
    expect(counter('abcdef')).toBe(3);
  });

  it('consistency: same input always produces same output', () => {
    const counter = simpleTokenEstimator();
    const text = 'repeated test string';
    expect(counter(text)).toBe(counter(text));
  });
});
