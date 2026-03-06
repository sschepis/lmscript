import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractText,
  estimateContentTokens,
  toOpenAIContent,
  toAnthropicContent,
  toGeminiParts,
} from '../src/content';
import type {
  TextContent,
  ImageUrlContent,
  ImageBase64Content,
  ContentBlock,
} from '../src/types';

// ── Fixtures ─────────────────────────────────────────────────────────

const textBlock: TextContent = { type: 'text', text: 'Hello world' };

const imageUrlBlock: ImageUrlContent = {
  type: 'image_url',
  image_url: { url: 'https://example.com/img.png' },
};

const imageUrlBlockWithDetail: ImageUrlContent = {
  type: 'image_url',
  image_url: { url: 'https://example.com/img.png', detail: 'low' },
};

const imageBase64Block: ImageBase64Content = {
  type: 'image_base64',
  mediaType: 'image/png',
  data: 'iVBORw0KGgoAAAANS',
};

// ── extractText ──────────────────────────────────────────────────────

describe('extractText', () => {
  it('returns the string as-is for string input', () => {
    expect(extractText('plain text')).toBe('plain text');
  });

  it('extracts text from a TextContent block', () => {
    expect(extractText([textBlock])).toBe('Hello world');
  });

  it('returns empty string for an ImageUrlContent block', () => {
    expect(extractText([imageUrlBlock])).toBe('');
  });

  it('returns empty string for an ImageBase64Content block', () => {
    expect(extractText([imageBase64Block])).toBe('');
  });

  it('extracts only text from mixed content blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock,
      imageUrlBlock,
      { type: 'text', text: 'More text' },
      imageBase64Block,
    ];
    expect(extractText(blocks)).toBe('Hello world\nMore text');
  });

  it('returns empty string for an empty array', () => {
    expect(extractText([])).toBe('');
  });

  it('returns empty string for array with only images', () => {
    expect(extractText([imageUrlBlock, imageBase64Block])).toBe('');
  });
});

// ── estimateContentTokens ────────────────────────────────────────────

describe('estimateContentTokens', () => {
  const mockCounter = vi.fn((text: string) => text.length);

  beforeEach(() => {
    mockCounter.mockClear();
  });

  it('delegates to textTokenCounter for string content', () => {
    const result = estimateContentTokens('hello', mockCounter);
    expect(mockCounter).toHaveBeenCalledWith('hello');
    expect(result).toBe(5);
  });

  it('uses textTokenCounter for TextContent blocks', () => {
    const result = estimateContentTokens([textBlock], mockCounter);
    expect(mockCounter).toHaveBeenCalledWith('Hello world');
    expect(result).toBe(11); // "Hello world".length
  });

  it('counts image_url blocks as fixed token cost (765 for high/auto)', () => {
    const result = estimateContentTokens([imageUrlBlock], mockCounter);
    expect(result).toBe(765);
    expect(mockCounter).not.toHaveBeenCalled();
  });

  it('counts image_url blocks with low detail as 85 tokens', () => {
    const result = estimateContentTokens([imageUrlBlockWithDetail], mockCounter);
    expect(result).toBe(85);
  });

  it('counts image_base64 blocks as 765 tokens', () => {
    const result = estimateContentTokens([imageBase64Block], mockCounter);
    expect(result).toBe(765);
  });

  it('sums text + image tokens for mixed content', () => {
    const blocks: ContentBlock[] = [textBlock, imageUrlBlock, imageBase64Block];
    const result = estimateContentTokens(blocks, mockCounter);
    // "Hello world".length (11) + 765 + 765 = 1541
    expect(result).toBe(11 + 765 + 765);
  });

  it('returns 0 for an empty array', () => {
    const result = estimateContentTokens([], mockCounter);
    expect(result).toBe(0);
  });
});

// ── toOpenAIContent ──────────────────────────────────────────────────

describe('toOpenAIContent', () => {
  it('returns string input as-is', () => {
    expect(toOpenAIContent('hello')).toBe('hello');
  });

  it('converts TextContent to OpenAI text part', () => {
    const result = toOpenAIContent([textBlock]) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('converts ImageUrlContent to OpenAI image_url part', () => {
    const result = toOpenAIContent([imageUrlBlock]) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/img.png' },
    });
  });

  it('includes detail field when provided in ImageUrlContent', () => {
    const result = toOpenAIContent([imageUrlBlockWithDetail]) as Array<Record<string, unknown>>;
    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/img.png', detail: 'low' },
    });
  });

  it('converts ImageBase64Content to data URI image_url part', () => {
    const result = toOpenAIContent([imageBase64Block]) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
    });
  });

  it('produces array of content parts for mixed array', () => {
    const blocks: ContentBlock[] = [textBlock, imageUrlBlock, imageBase64Block];
    const result = toOpenAIContent(blocks) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(result[1]).toHaveProperty('type', 'image_url');
    expect(result[2]).toHaveProperty('type', 'image_url');
  });
});

// ── toAnthropicContent ───────────────────────────────────────────────

describe('toAnthropicContent', () => {
  it('returns string input as-is', () => {
    expect(toAnthropicContent('hello')).toBe('hello');
  });

  it('converts TextContent to Anthropic text block', () => {
    const result = toAnthropicContent([textBlock]) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('converts ImageBase64Content to Anthropic image block', () => {
    const result = toAnthropicContent([imageBase64Block]) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgoAAAANS',
      },
    });
  });

  it('skips ImageUrlContent blocks (not supported by Anthropic)', () => {
    const result = toAnthropicContent([imageUrlBlock]);
    // Only image_url → no blocks → returns empty string
    expect(result).toBe('');
  });

  it('handles mixed content, skipping image_url blocks', () => {
    const blocks: ContentBlock[] = [textBlock, imageUrlBlock, imageBase64Block];
    const result = toAnthropicContent(blocks) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(result[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgoAAAANS',
      },
    });
  });

  it('returns empty string when all blocks are image_url', () => {
    const result = toAnthropicContent([imageUrlBlock]);
    expect(result).toBe('');
  });
});

// ── toGeminiParts ────────────────────────────────────────────────────

describe('toGeminiParts', () => {
  it('converts string input to [{text: "..."}]', () => {
    const result = toGeminiParts('hello');
    expect(result).toEqual([{ text: 'hello' }]);
  });

  it('converts TextContent to [{text: "..."}]', () => {
    const result = toGeminiParts([textBlock]);
    expect(result).toEqual([{ text: 'Hello world' }]);
  });

  it('converts ImageBase64Content to inline_data part', () => {
    const result = toGeminiParts([imageBase64Block]);
    expect(result).toEqual([
      {
        inline_data: {
          mime_type: 'image/png',
          data: 'iVBORw0KGgoAAAANS',
        },
      },
    ]);
  });

  it('skips ImageUrlContent blocks (not supported by Gemini)', () => {
    const result = toGeminiParts([imageUrlBlock]);
    // All skipped → fallback to [{text: ""}]
    expect(result).toEqual([{ text: '' }]);
  });

  it('handles mixed content, skipping image_url blocks', () => {
    const blocks: ContentBlock[] = [textBlock, imageBase64Block, imageUrlBlock];
    const result = toGeminiParts(blocks);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: 'Hello world' });
    expect(result[1]).toEqual({
      inline_data: {
        mime_type: 'image/png',
        data: 'iVBORw0KGgoAAAANS',
      },
    });
  });

  it('returns [{text: ""}] when all blocks are image_url', () => {
    const result = toGeminiParts([imageUrlBlock]);
    expect(result).toEqual([{ text: '' }]);
  });

  it('handles empty array gracefully', () => {
    const result = toGeminiParts([]);
    expect(result).toEqual([{ text: '' }]);
  });
});
