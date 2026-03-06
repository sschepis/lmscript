import type { EmbeddingProvider } from "../embeddings.js";

interface OpenAIEmbeddingConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, Azure OpenAI, and any OpenAI-compatible embedding API.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai-embeddings";
  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenAIEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1/embeddings";
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: model ?? "text-embedding-3-small",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[openai-embeddings] API error ${response.status}: ${errorText}`);
    }

    const json = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain input order
    return json.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}
