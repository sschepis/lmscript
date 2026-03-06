import type {
  MessageContent,
  ContentBlock,
  TextContent,
  ImageUrlContent,
  ImageBase64Content,
} from "./types.js";

/**
 * Extract text content from a MessageContent value.
 * Used for providers that don't support multi-modal and for token estimation.
 */
export function extractText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Estimate token count for image content blocks.
 * Uses OpenAI's approximate token counts:
 * - low detail: ~85 tokens
 * - high detail: ~765 tokens
 * - auto/default: ~765 tokens (assume high)
 */
export function estimateImageTokens(
  block: ImageUrlContent | ImageBase64Content
): number {
  if (block.type === "image_url") {
    const detail = block.image_url.detail ?? "auto";
    return detail === "low" ? 85 : 765;
  }
  // image_base64 — assume high detail
  return 765;
}

/**
 * Estimate total tokens for a MessageContent value.
 * For strings, delegates to the provided text token counter.
 * For content block arrays, sums text tokens + image token estimates.
 */
export function estimateContentTokens(
  content: MessageContent,
  textTokenCounter: (text: string) => number
): number {
  if (typeof content === "string") {
    return textTokenCounter(content);
  }

  let tokens = 0;
  for (const block of content) {
    if (block.type === "text") {
      tokens += textTokenCounter(block.text);
    } else {
      tokens += estimateImageTokens(block);
    }
  }
  return tokens;
}

/**
 * Convert ContentBlock[] to OpenAI's message content format.
 * OpenAI natively supports text and image_url blocks.
 * image_base64 blocks are converted to data URI image_url blocks.
 */
export function toOpenAIContent(
  content: MessageContent
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;

  return content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "image_url":
        return {
          type: "image_url",
          image_url: {
            url: block.image_url.url,
            ...(block.image_url.detail && { detail: block.image_url.detail }),
          },
        };
      case "image_base64":
        return {
          type: "image_url",
          image_url: {
            url: `data:${block.mediaType};base64,${block.data}`,
          },
        };
    }
  });
}

/**
 * Convert ContentBlock[] to Anthropic's message content format.
 * Anthropic uses { type: "text", text } for text and
 * { type: "image", source: { type: "base64", media_type, data } } for images.
 * Note: Anthropic does not support image URLs directly — image_url blocks are skipped.
 */
export function toAnthropicContent(
  content: MessageContent
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;

  const result: Array<Record<string, unknown>> = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        result.push({ type: "text", text: block.text });
        break;
      case "image_base64":
        result.push({
          type: "image",
          source: {
            type: "base64",
            media_type: block.mediaType,
            data: block.data,
          },
        });
        break;
      case "image_url":
        // Anthropic doesn't support image URLs directly — skip
        break;
    }
  }
  return result.length > 0 ? result : "";
}

/**
 * Convert ContentBlock[] to Gemini's parts format.
 * Gemini uses { text } for text and { inline_data: { mime_type, data } } for images.
 * Note: Gemini does not support image URLs directly — image_url blocks are skipped.
 */
export function toGeminiParts(
  content: MessageContent
): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ text: block.text });
        break;
      case "image_base64":
        parts.push({
          inline_data: {
            mime_type: block.mediaType,
            data: block.data,
          },
        });
        break;
      case "image_url":
        // Gemini doesn't support image URLs directly — skip
        break;
    }
  }
  return parts.length > 0 ? parts : [{ text: "" }];
}
