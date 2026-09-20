import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type { IEmbeddingProvider } from '../rag.types.js';

const GEMINI_EMBEDDING_CONFIGS = [
  {
    apiVersion: 'v1beta',
    model: 'gemini-embedding-001',
  },
  {
    apiVersion: 'v1beta',
    model: 'gemini-embedding-2',
  },
  {
    apiVersion: 'v1beta',
    model: 'embedding-001',
  },
  {
    apiVersion: 'v1',
    model: 'text-embedding-004',
  },
];

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini' as const;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly preferredModel: string;

  constructor(apiKey: string, model = 'gemini-embedding-001', dimension = 768) {
    this.apiKey = apiKey;
    this.preferredModel = model.replace(/^models\//, '');
    this.dimension = dimension;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    const first = embeddings[0];
    if (!first) {
      throw new InternalError('Failed to generate embedding from Gemini');
    }
    return first;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (!this.apiKey) {
      throw new InternalError(
        'Gemini API key is missing. Set EMBEDDING_API_KEY environment variable.',
      );
    }

    const errors: string[] = [];

    // Order: Preferred model first with v1beta, then other models
    const configs = [
      { apiVersion: 'v1beta', model: this.preferredModel },
      { apiVersion: 'v1', model: this.preferredModel },
      ...GEMINI_EMBEDDING_CONFIGS.filter((c) => c.model !== this.preferredModel),
    ];

    for (const config of configs) {
      try {
        const result = await this._tryBatchEmbed(texts, config.apiVersion, config.model);
        if (result && result.length === texts.length) {
          return result;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${config.apiVersion}/${config.model}: ${msg}`);
        logger.warn(
          { apiVersion: config.apiVersion, model: config.model, error: msg },
          'Gemini embedding attempt failed, trying fallback model',
        );
      }
    }

    logger.error({ errors, preferredModel: this.preferredModel }, 'All Gemini embedding attempts failed');
    throw new InternalError(`Gemini embedding failed: ${errors[0] ?? 'unknown error'}`);
  }

  private async _tryBatchEmbed(
    texts: string[],
    apiVersion: string,
    model: string,
  ): Promise<number[][] | null> {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: {
        parts: [{ text }],
      },
      outputDimensionality: this.dimension,
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.error?.message) {
          errorMsg = parsed.error.message;
        }
      } catch {
        errorMsg = errorText || errorMsg;
      }
      throw new Error(errorMsg);
    }

    const data = (await response.json()) as {
      embeddings?: Array<{ values: number[] }>;
    };

    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error('Empty embeddings array in response');
    }

    return data.embeddings.map((item) => item.values);
  }
}
