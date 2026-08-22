import type { ILlmProvider, LlmGenerationOptions, LlmMessage, LlmResponse } from '../ai.types.js';

export class MockAiLlmProvider implements ILlmProvider {
  readonly name = 'mock' as const;
  private customHandler?: (
    messages: LlmMessage[],
    options?: LlmGenerationOptions,
  ) => Promise<LlmResponse>;

  constructor(
    customHandler?: (
      messages: LlmMessage[],
      options?: LlmGenerationOptions,
    ) => Promise<LlmResponse>,
  ) {
    this.customHandler = customHandler;
  }

  setHandler(
    handler: (messages: LlmMessage[], options?: LlmGenerationOptions) => Promise<LlmResponse>,
  ): void {
    this.customHandler = handler;
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmResponse> {
    if (this.customHandler) {
      return this.customHandler(messages, options);
    }

    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';

    // Simulate timeout if requested in query
    if (lastMessage.includes('SIMULATE_TIMEOUT')) {
      await new Promise((resolve) => setTimeout(resolve, (options?.timeoutMs ?? 100) + 50));
    }

    // Grounded synthesis simulation
    let content = `AI response grounded in provided instructions: "${lastMessage.slice(0, 100)}".`;

    if (systemPrompt.includes('RETRIEVED ORGANIZATION CONTEXT')) {
      content = `AI response incorporating verified organization context: "${lastMessage.slice(0, 100)}".`;
    }

    return {
      content,
      usage: {
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
      },
      finishReason: 'stop',
    };
  }
}
