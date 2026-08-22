import { env } from '../../../config/env.js';
import type { ILlmProvider } from '../rag.types.js';
import { GroqLlmProvider } from './groq-llm.provider.js';
import { MockLlmProvider } from './mock-llm.provider.js';

export function createLlmProvider(): ILlmProvider {
  if (process.env['NODE_ENV'] === 'test') {
    return new MockLlmProvider();
  }

  switch (env.LLM_PROVIDER) {
    case 'groq':
      return new GroqLlmProvider(env.GROQ_API_KEY, env.GROQ_MODEL);
    case 'mock':
    default:
      return new MockLlmProvider();
  }
}

export const defaultLlmProvider = createLlmProvider();
