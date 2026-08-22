import { env } from '../../../config/env.js';
import type { IEmbeddingProvider } from '../rag.types.js';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js';
import { MockEmbeddingProvider } from './mock-embedding.provider.js';
import { OpenAIEmbeddingProvider } from './openai-embedding.provider.js';

export function createEmbeddingProvider(): IEmbeddingProvider {
  if (process.env['NODE_ENV'] === 'test') {
    return new MockEmbeddingProvider(env.EMBEDDING_DIMENSION);
  }

  switch (env.EMBEDDING_PROVIDER) {
    case 'gemini':
      return new GeminiEmbeddingProvider(
        env.EMBEDDING_API_KEY,
        env.EMBEDDING_MODEL || 'text-embedding-004',
        env.EMBEDDING_DIMENSION || 768,
      );
    case 'openai':
      return new OpenAIEmbeddingProvider(
        env.EMBEDDING_API_KEY,
        env.EMBEDDING_MODEL,
        env.EMBEDDING_DIMENSION,
      );
    case 'mock':
    default:
      return new MockEmbeddingProvider(env.EMBEDDING_DIMENSION);
  }
}

export const defaultEmbeddingProvider = createEmbeddingProvider();
