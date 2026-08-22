import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type { IEmbeddingProvider } from '../rag.types.js';

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini' as const;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'text-embedding-004', dimension = 768) {
    this.apiKey = apiKey;
    this.model = model.replace(/^models\//, '');
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

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

      const requests = texts.map((text) => ({
        model: `models/${this.model}`,
        content: {
          parts: [{ text }],
        },
      }));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, errorText, model: this.model },
          'Gemini embedding API request failed',
        );
        throw new InternalError('Gemini embedding generation failed');
      }

      const data = (await response.json()) as {
        embeddings: Array<{ values: number[] }>;
      };

      return data.embeddings.map((item) => item.values);
    } catch (err) {
      if (err instanceof InternalError) throw err;
      logger.error({ err }, 'Unexpected error during Gemini embedding generation');
      throw new InternalError('Gemini embedding generation encountered a network failure');
    }
  }
}
