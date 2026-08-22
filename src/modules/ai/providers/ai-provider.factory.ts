import { env } from '../../../config/env.js';
import type { ILlmProvider } from '../ai.types.js';
import { GroqAiLlmProvider } from './groq-llm.provider.js';
import { MockAiLlmProvider } from './mock-llm.provider.js';

export function createAiLlmProvider(): ILlmProvider {
  if (process.env['NODE_ENV'] === 'test') {
    return new MockAiLlmProvider();
  }

  switch (env.LLM_PROVIDER) {
    case 'groq':
      return new GroqAiLlmProvider(env.GROQ_API_KEY, env.GROQ_MODEL);
    case 'mock':
    default:
      return new MockAiLlmProvider();
  }
}

export const defaultAiLlmProvider = createAiLlmProvider();
