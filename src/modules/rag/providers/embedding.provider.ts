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
    case 'gemini': {
      const model =
        env.EMBEDDING_MODEL && env.EMBEDDING_MODEL !== 'text-embedding-3-small'
          ? env.EMBEDDING_MODEL
          : 'gemini-embedding-001';
      return new GeminiEmbeddingProvider(env.EMBEDDING_API_KEY, model, env.EMBEDDING_DIMENSION);
    }
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
