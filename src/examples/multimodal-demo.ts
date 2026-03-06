/**
 * Example: Multi-Modal Messages — Text + Image Content Blocks
 *
 * Demonstrates:
 *   - Creating ContentBlock arrays with text and image_url blocks
 *   - Creating messages with base64 image content
 *   - Using extractText() to get text from mixed content
 *   - Building ChatMessages with multi-modal content
 *   - How content blocks map to the LScriptFunction model
 *
 * Usage:
 *   npx tsx src/examples/multimodal-demo.ts
 */

import { z } from "zod";
import { LScriptRuntime, extractText } from "../index.js";
import type {
  LScriptFunction,
  ContentBlock,
  TextContent,
  ImageUrlContent,
  ImageBase64Content,
  ChatMessage,
  MessageContent,
} from "../index.js";
import { MockProvider } from "../testing/index.js";

// ── 1. Demonstrate content block creation ───────────────────────────

function demoContentBlocks() {
  console.log("📦 Content Block Types");
  console.log("─".repeat(50));

  // Text content block
  const textBlock: TextContent = {
    type: "text",
    text: "Describe what you see in this image.",
  };
  console.log("\n   TextContent:", JSON.stringify(textBlock, null, 2));

  // Image URL content block
  const imageUrlBlock: ImageUrlContent = {
    type: "image_url",
    image_url: {
      url: "https://example.com/photo.jpg",
      detail: "high",
    },
  };
  console.log("\n   ImageUrlContent:", JSON.stringify(imageUrlBlock, null, 2));

  // Base64 image content block
  const base64Block: ImageBase64Content = {
    type: "image_base64",
    mediaType: "image/png",
    // A tiny 1x1 transparent PNG for demo
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  };
  console.log("\n   ImageBase64Content:", JSON.stringify({
    ...base64Block,
    data: base64Block.data.slice(0, 30) + "... (truncated)",
  }, null, 2));

  return { textBlock, imageUrlBlock, base64Block };
}

// ── 2. Demonstrate multi-modal messages ─────────────────────────────

function demoMultiModalMessages(blocks: {
  textBlock: TextContent;
  imageUrlBlock: ImageUrlContent;
  base64Block: ImageBase64Content;
}) {
  console.log("\n\n💬 Multi-Modal Messages");
  console.log("─".repeat(50));

  // A message with text + image URL
  const messageWithUrl: ChatMessage = {
    role: "user",
    content: [
      blocks.textBlock,
      blocks.imageUrlBlock,
    ],
  };
  console.log("\n   Message with text + image URL:");
  console.log(`     Role: ${messageWithUrl.role}`);
  console.log(`     Blocks: ${(messageWithUrl.content as ContentBlock[]).length}`);

  // A message with text + base64 image
  const messageWithBase64: ChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "What object is shown in this image?" },
      blocks.base64Block,
    ],
  };
  console.log("\n   Message with text + base64 image:");
  console.log(`     Role: ${messageWithBase64.role}`);
  console.log(`     Blocks: ${(messageWithBase64.content as ContentBlock[]).length}`);

  // A message with multiple images
  const multiImage: ChatMessage = {
    role: "user",
    content: [
      { type: "text", text: "Compare these two images:" },
      {
        type: "image_url",
        image_url: { url: "https://example.com/before.jpg", detail: "low" },
      },
      {
        type: "image_url",
        image_url: { url: "https://example.com/after.jpg", detail: "low" },
      },
    ],
  };
  console.log("\n   Message with multiple images:");
  console.log(`     Role: ${multiImage.role}`);
  console.log(`     Blocks: ${(multiImage.content as ContentBlock[]).length} (1 text + 2 images)`);

  return { messageWithUrl, messageWithBase64, multiImage };
}

// ── 3. Demonstrate extractText() utility ────────────────────────────

function demoExtractText() {
  console.log("\n\n🔤 extractText() — Extracting Text from Mixed Content");
  console.log("─".repeat(50));

  // From a simple string
  const simpleContent: MessageContent = "Hello, world!";
  console.log(`\n   String content: "${extractText(simpleContent)}"`);

  // From mixed content blocks
  const mixedContent: ContentBlock[] = [
    { type: "text", text: "First paragraph." },
    { type: "image_url", image_url: { url: "https://example.com/img.jpg" } },
    { type: "text", text: "Second paragraph." },
    {
      type: "image_base64",
      mediaType: "image/jpeg",
      data: "base64data...",
    },
    { type: "text", text: "Third paragraph." },
  ];

  const extracted = extractText(mixedContent);
  console.log(`\n   Mixed content (5 blocks, 2 images):`);
  console.log(`   Extracted text: "${extracted}"`);
  console.log(`   ℹ️  Image blocks are automatically filtered out.`);
}

// ── 4. Demonstrate with LScriptRuntime ──────────────────────────────

async function demoWithRuntime() {
  console.log("\n\n🚀 Multi-Modal with LScriptRuntime");
  console.log("─".repeat(50));

  const ImageDescriptionSchema = z.object({
    description: z.string(),
    objects_detected: z.array(z.string()),
    dominant_colors: z.array(z.string()),
  });

  // In a real scenario, the prompt would reference images.
  // The model receives multi-modal content through the messages.
  const imageAnalyzer: LScriptFunction<string, typeof ImageDescriptionSchema> = {
    name: "ImageAnalyzer",
    model: "mock-model",
    system: "You are a vision model that describes images in detail.",
    prompt: (imageUrl: string) =>
      `Analyze the image at: ${imageUrl}`,
    schema: ImageDescriptionSchema,
    temperature: 0.3,
  };

  const mockProvider = new MockProvider({
    defaultResponse: JSON.stringify({
      description: "A sunset over mountains with a lake in the foreground.",
      objects_detected: ["mountains", "lake", "sun", "clouds", "trees"],
      dominant_colors: ["orange", "purple", "blue", "dark green"],
    }),
  });

  const runtime = new LScriptRuntime({ provider: mockProvider });
  const result = await runtime.execute(
    imageAnalyzer,
    "https://example.com/sunset.jpg"
  );

  console.log("\n   📸 Image analysis result:");
  console.log(`     Description: ${result.data.description}`);
  console.log(`     Objects: ${result.data.objects_detected.join(", ")}`);
  console.log(`     Colors: ${result.data.dominant_colors.join(", ")}`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("🖼️  Multi-Modal Messages Demo");
  console.log("═".repeat(60));

  const blocks = demoContentBlocks();
  demoMultiModalMessages(blocks);
  demoExtractText();
  await demoWithRuntime();

  console.log("\n" + "═".repeat(60));
  console.log("Demo complete.\n");
}

main();
