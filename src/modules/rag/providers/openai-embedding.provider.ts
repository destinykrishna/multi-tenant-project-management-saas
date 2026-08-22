import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type { IEmbeddingProvider } from '../rag.types.js';

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai' as const;
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'text-embedding-3-small', dimension = 1536) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimension = dimension;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    const first = embeddings[0];
    if (!first) {
      throw new InternalError('Failed to generate embedding from OpenAI');
    }
    return first;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (!this.apiKey) {
      throw new InternalError(
        'OpenAI API key is missing. Set EMBEDDING_API_KEY environment variable.',
      );
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: this.dimension,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, errorText, model: this.model },
          'OpenAI embedding API request failed',
        );
        throw new InternalError('OpenAI embedding generation failed');
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort in order of original input
      return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } catch (err) {
      if (err instanceof InternalError) throw err;
      logger.error({ err }, 'Unexpected error during OpenAI embedding generation');
      throw new InternalError('Embedding generation encountered a network failure');
    }
  }
}
