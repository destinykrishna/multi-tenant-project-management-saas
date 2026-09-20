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

  resetHandler(): void {
    this.customHandler = undefined;
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmResponse> {
    if (this.customHandler) {
      return this.customHandler(messages, options);
    }

    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
    const toolMessages = messages.filter((m) => m.role === 'tool');

    // Simulate timeout if requested in query
    if (userMessage.includes('SIMULATE_TIMEOUT') || lastMessage.includes('SIMULATE_TIMEOUT')) {
      await new Promise((resolve) => setTimeout(resolve, (options?.timeoutMs ?? 100) + 50));
    }

    // Agent tool calling simulation if tools provided
    if (options?.tools && options.tools.length > 0) {
      // 1. Multi-step flow: Find member -> search tasks -> summarize
      if (userMessage.toLowerCase().includes('rahul') || userMessage.toLowerCase().includes('overdue')) {
        const memberToolMsg = toolMessages.find((m) => m.name === 'searchMembers');
        const tasksToolMsg = toolMessages.find((m) => m.name === 'searchTasks');

        if (!memberToolMsg) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-mem-1',
                name: 'searchMembers',
                arguments: { search: 'Rahul' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        if (!tasksToolMsg) {
          // Parse member ID from tool result if available
          let memberId = '00000000-0000-0000-0000-000000000000';
          try {
            const parsed = JSON.parse(memberToolMsg.content) as { data?: Array<{ userId?: string }> };
            if (parsed.data && parsed.data[0]?.userId) {
              memberId = parsed.data[0].userId;
            }
          } catch {
            // Ignore parse errors
          }

          // Extract project ID from query or dummy
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-tsk-1',
                name: 'searchTasks',
                arguments: {
                  projectId: '11111111-1111-1111-1111-111111111111',
                  assigneeId: memberId,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        return {
          content: 'Rahul was found as an active member. He has 1 high-priority overdue task: "Fix overdue database connection pool saturation".',
          finishReason: 'stop',
        };
      }

      // 3. Multi-step workflow: schedule meeting + send email
      if (
        userMessage.toLowerCase().includes('schedule') ||
        userMessage.toLowerCase().includes('meeting') ||
        userMessage.toLowerCase().includes('send email') ||
        userMessage.toLowerCase().includes('email him') ||
        userMessage.toLowerCase().includes('email her')
      ) {
        const meetingToolMsg = toolMessages.find((m) => m.name === 'scheduleMeeting');
        const emailToolMsg = toolMessages.find((m) => m.name === 'sendEmail');

        // Step 1: Schedule the meeting first
        if (!meetingToolMsg) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(15, 0, 0, 0);
          const endTime = new Date(tomorrow);
          endTime.setHours(16, 0, 0, 0);

          return {
            content: '',
            toolCalls: [
              {
                id: 'call-meet-1',
                name: 'scheduleMeeting',
                arguments: {
                  title: 'Review Meeting',
                  startTime: tomorrow.toISOString(),
                  endTime: endTime.toISOString(),
                  description: 'Scheduled via AI assistant',
                  createGoogleMeet: true,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Step 2: Send email with meeting details (if email requested and meeting created)
        if (!emailToolMsg && (userMessage.toLowerCase().includes('email') || userMessage.toLowerCase().includes('send'))) {
          let meetLink = 'https://meet.google.com/test-link';
          try {
            const parsed = JSON.parse(meetingToolMsg.content) as {
              data?: { googleMeetLink?: string; title?: string };
            };
            meetLink = parsed.data?.googleMeetLink ?? meetLink;
          } catch {
            // Ignore parse errors
          }

          return {
            content: '',
            toolCalls: [
              {
                id: 'call-email-1',
                name: 'sendEmail',
                arguments: {
                  to: 'rahul@example.com',
                  subject: 'Meeting Scheduled: Review Meeting',
                  body: `Hi,\n\nA review meeting has been scheduled.\nMeet Link: ${meetLink}\n\nBest regards`,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Step 3: Final summary response
        return {
          content:
            'I have successfully scheduled the review meeting and sent the email with meeting details including the Google Meet link.',
          finishReason: 'stop',
        };
      }

      // 2. Single tool flow: Project searching
      if (userMessage.toLowerCase().includes('project')) {
        const projectToolMsg = toolMessages.find((m) => m.name === 'searchProjects');
        if (!projectToolMsg) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-prj-1',
                name: 'searchProjects',
                arguments: { search: 'Alpha' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        return {
          content: 'I retrieved the organization projects: Alpha AI Platform (Key: AIP, Status: ACTIVE).',
          finishReason: 'stop',
        };
      }
    }

    // Default grounded direct answer
    let content = `AI response grounded in provided instructions: "${userMessage.slice(0, 100)}".`;

    if (
      systemPrompt.includes('RETRIEVED ORGANIZATION CONTEXT') ||
      systemPrompt.includes('RELEVANT ORGANIZATION KNOWLEDGE')
    ) {
      content = `AI response incorporating verified organization context: "${userMessage.slice(0, 100)}".`;
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
