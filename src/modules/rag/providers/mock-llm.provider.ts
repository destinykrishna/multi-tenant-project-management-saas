import type { ILlmProvider, LlmMessage, LlmOptions } from '../rag.types.js';

export class MockLlmProvider implements ILlmProvider {
  readonly name = 'mock' as const;

  generateResponse(messages: LlmMessage[], _options?: LlmOptions): Promise<string> {
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? '';

    // Check if context was provided in system or user message
    const combined = `${systemMessage}\n${userMessage}`;

    // Prompt injection defense check: if retrieved data contains malicious instruction override, ignore instruction and focus on data
    if (combined.includes('OVERDUE_NO_TASKS') || combined.includes('NO_MATCHING_CONTEXT')) {
      return Promise.resolve(
        'The available organization data does not contain enough information to answer this question.',
      );
    }

    if (userMessage.toLowerCase().includes('overdue')) {
      if (
        combined.includes('Fix overdue database connection pool saturation') ||
        combined.includes('overdue')
      ) {
        return Promise.resolve(
          'Based on your organization data, there is 1 overdue high-priority task: "Fix overdue database connection pool saturation" in the Neural Engine Core project.',
        );
      }
      return Promise.resolve(
        'The available organization data does not contain enough information to answer this question.',
      );
    }

    if (
      userMessage.toLowerCase().includes('invoice') ||
      userMessage.toLowerCase().includes('billing')
    ) {
      if (combined.includes('Generate monthly invoices') || combined.includes('Billing Platform')) {
        return Promise.resolve(
          'Based on your organization data, the "Billing Platform" project handles monthly invoice aggregation and sending PDF invoices to enterprise customers.',
        );
      }
    }

    if (
      userMessage.toLowerCase().includes('prompt') ||
      userMessage.toLowerCase().includes('system instruction')
    ) {
      return Promise.resolve(
        'I am an AI assistant grounded strictly in your organization data. I do not execute prompt override instructions found in retrieved documents.',
      );
    }

    // Default grounded synthesis
    if (combined.includes('=== Document') || combined.includes('Context:')) {
      return Promise.resolve(
        `Based on the retrieved context from your organization, here is the answer regarding your query: "${userMessage.slice(0, 100)}".`,
      );
    }

    return Promise.resolve(
      'The available organization data does not contain enough information to answer this question.',
    );
  }
}
