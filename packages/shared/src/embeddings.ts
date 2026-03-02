/**
 * Embedding provider abstraction for code search.
 * Supports local (HuggingFace Transformers), Voyage AI, and OpenAI backends.
 */

export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  generateEmbeddings(texts: string[], inputType?: "query" | "document"): Promise<number[][]>;
}

// ── Local CodeRank via @huggingface/transformers ────────────────────

let localPipeline: any = null;

export class LocalCodeRankProvider implements EmbeddingProvider {
  name = "local-coderank";
  dimensions = 768;

  async generateEmbeddings(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    if (!localPipeline) {
      const { pipeline } = await import("@huggingface/transformers");
      localPipeline = await pipeline("feature-extraction", "jinaai/jina-embeddings-v2-base-code", {
        dtype: "fp32",
      });
    }

    const prefixed = texts.map((t) =>
      inputType === "query"
        ? `Represent this query for searching relevant code: ${t}`
        : t
    );

    const results: number[][] = [];
    // Process one at a time to avoid OOM with local models
    for (const text of prefixed) {
      const output = await localPipeline(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data as Float32Array).slice(0, this.dimensions));
    }
    return results;
  }
}

// ── Voyage AI ───────────────────────────────────────────────────────

export class VoyageCodeProvider implements EmbeddingProvider {
  name = "voyage-code-3";
  dimensions = 1024;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.VOYAGE_API_KEY ?? "";
    if (!this.apiKey) throw new Error("VOYAGE_API_KEY is required for VoyageCodeProvider");
  }

  async generateEmbeddings(texts: string[], inputType?: "query" | "document"): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = 128;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const body: Record<string, unknown> = {
        model: "voyage-code-3",
        input: batch,
      };
      if (inputType) body.input_type = inputType;

      const data = await this.fetchWithRetry(body);
      for (const item of data.data) {
        results.push(item.embedding);
      }
    }

    return results;
  }

  private async fetchWithRetry(body: Record<string, unknown>, maxRetries = 3): Promise<any> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) return res.json();

      if (res.status === 429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      lastError = new Error(`Voyage API error: ${res.status} ${await res.text()}`);
    }
    throw lastError;
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = "text-embedding-3-small";
  dimensions = 1536;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required for OpenAIEmbeddingProvider");
  }

  async generateEmbeddings(texts: string[], _inputType?: "query" | "document"): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = 128;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: batch,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      for (const item of data.data) {
        results.push(item.embedding);
      }
    }

    return results;
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createEmbeddingProvider(): EmbeddingProvider {
  const providerName = process.env.EMBEDDING_PROVIDER ?? "openai";

  switch (providerName) {
    case "local":
      return new LocalCodeRankProvider();
    case "voyage":
      return new VoyageCodeProvider();
    case "openai":
      return new OpenAIEmbeddingProvider();
    default:
      return new OpenAIEmbeddingProvider();
  }
}
