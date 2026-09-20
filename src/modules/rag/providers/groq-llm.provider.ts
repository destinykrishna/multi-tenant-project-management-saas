import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type { ILlmProvider, LlmMessage, LlmOptions } from '../rag.types.js';

const GROQ_FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'llama-3.3-70b-versatile',
  'groq/compound',
];

export class GroqLlmProvider implements ILlmProvider {
  readonly name = 'groq' as const;
  private readonly apiKey: string;
  private readonly preferredModel: string;

  constructor(apiKey: string, model = 'openai/gpt-oss-120b') {
    this.apiKey = apiKey;
    this.preferredModel = model;
  }

  async generateResponse(messages: LlmMessage[], options?: LlmOptions): Promise<string> {
    if (!this.apiKey) {
      throw new InternalError('Groq API key is missing. Set GROQ_API_KEY environment variable.');
    }

    const modelsToTry = [
      this.preferredModel,
      ...GROQ_FALLBACK_MODELS.filter((m) => m !== this.preferredModel),
    ];

    let lastError = 'Groq LLM response generation failed';

    for (const model of modelsToTry) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options?.temperature ?? 0.1,
            max_tokens: options?.maxTokens ?? 1024,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };

          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            return content;
          }
        }

        const errorText = await response.text();
        try {
          const parsed = JSON.parse(errorText);
          if (parsed?.error?.message) {
            lastError = parsed.error.message;
          }
        } catch {
          lastError = errorText || lastError;
        }

        logger.warn(
          { model, status: response.status, lastError },
          'Groq RAG LLM model attempt failed, trying fallback model',
        );
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    logger.error({ lastError, preferredModel: this.preferredModel }, 'All Groq RAG LLM attempts failed');
    throw new InternalError(`Groq LLM error: ${lastError}`);
  }
}
