import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type { ILlmProvider, LlmMessage, LlmOptions } from '../rag.types.js';

export class GroqLlmProvider implements ILlmProvider {
  readonly name = 'groq' as const;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateResponse(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    if (!this.apiKey) {
      throw new InternalError('Groq API key is missing. Set GROQ_API_KEY environment variable.');
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 1024,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, errorText, model: this.model },
          'Groq LLM chat completion API request failed',
        );
        throw new InternalError('Groq LLM response generation failed');
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new InternalError('Empty response received from Groq LLM');
      }

      return content;
    } catch (err) {
      if (err instanceof InternalError) throw err;
      logger.error({ err }, 'Unexpected network error during Groq LLM completion');
      throw new InternalError('LLM generation encountered a network error');
    }
  }
}
