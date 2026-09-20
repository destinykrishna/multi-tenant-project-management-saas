import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type {
  ILlmProvider,
  LlmGenerationOptions,
  LlmMessage,
  LlmResponse,
  LlmToolCall,
} from '../ai.types.js';

const GROQ_FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
  'llama-3.3-70b-versatile',
  'groq/compound',
];

export class GroqAiLlmProvider implements ILlmProvider {
  readonly name = 'groq' as const;
  private readonly apiKey: string;
  private readonly preferredModel: string;

  constructor(apiKey: string, model = 'openai/gpt-oss-120b') {
    this.apiKey = apiKey;
    this.preferredModel = model;
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmResponse> {
    if (!this.apiKey) {
      throw new InternalError('Groq API key is missing. Set GROQ_API_KEY in environment.');
    }

    const timeoutMs = options?.timeoutMs ?? 35000;
    const modelsToTry = [
      this.preferredModel,
      ...GROQ_FALLBACK_MODELS.filter((m) => m !== this.preferredModel),
    ];

    let lastError = 'Groq AI completion failed';

    for (const model of modelsToTry) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const payload: Record<string, unknown> = {
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.name ? { name: m.name } : {}),
            ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          })),
          temperature: options?.temperature ?? 0.2,
          max_tokens: options?.maxTokens ?? 2048,
        };

        if (options?.tools && options.tools.length > 0) {
          payload['tools'] = options.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }));
        }

        if (options?.stopSequences && options.stopSequences.length > 0) {
          payload['stop'] = options.stopSequences;
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{
              message?: {
                content?: string | null;
                tool_calls?: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>;
              };
              finish_reason?: 'stop' | 'tool_calls' | 'length';
            }>;
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          };

          const firstChoice = data.choices?.[0];
          const message = firstChoice?.message;
          const content = message?.content ?? '';
          let toolCalls: LlmToolCall[] | undefined;

          if (message?.tool_calls && message.tool_calls.length > 0) {
            toolCalls = message.tool_calls.map((tc) => {
              let parsedArgs: Record<string, unknown>;
              try {
                parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                parsedArgs = { raw: tc.function.arguments };
              }
              return {
                id: tc.id,
                name: tc.function.name,
                arguments: parsedArgs,
              };
            });
          }

          return {
            content,
            toolCalls,
            finishReason: firstChoice?.finish_reason ?? 'stop',
            usage: data.usage
              ? {
                  promptTokens: data.usage.prompt_tokens,
                  completionTokens: data.usage.completion_tokens,
                  totalTokens: data.usage.total_tokens,
                }
              : undefined,
          };
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
          'Groq model attempt failed, trying fallback model',
        );
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = `Groq request timed out after ${timeoutMs}ms`;
        } else {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    logger.error({ lastError, preferredModel: this.preferredModel }, 'All Groq AI attempts failed');
    throw new InternalError(`Groq AI completion error: ${lastError}`);
  }
}
