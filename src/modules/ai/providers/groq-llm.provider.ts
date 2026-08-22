import { logger } from '../../../config/logger.js';
import { InternalError } from '../../../utils/errors.js';
import type {
  ILlmProvider,
  LlmGenerationOptions,
  LlmMessage,
  LlmResponse,
  LlmToolCall,
} from '../ai.types.js';

export class GroqAiLlmProvider implements ILlmProvider {
  readonly name = 'groq' as const;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmResponse> {
    if (!this.apiKey) {
      throw new InternalError('Groq API key is missing. Set GROQ_API_KEY in environment.');
    }

    const timeoutMs = options?.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const payload: Record<string, unknown> = {
        model: this.model,
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

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, errorText, model: this.model },
          'Groq chat completion request failed',
        );
        throw new InternalError('Groq AI completion failed');
      }

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
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn({ timeoutMs, model: this.model }, 'Groq completion request timed out');
        throw new InternalError(`AI request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof InternalError) throw err;
      logger.error({ err }, 'Network error during Groq completion');
      throw new InternalError('AI service encountered a network error');
    }
  }
}
