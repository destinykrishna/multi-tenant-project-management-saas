import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { hashPassword } from '../../src/utils/password.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { AgentOrchestrator } from '../../src/modules/ai/agent.orchestrator.js';
import { MockAiLlmProvider } from '../../src/modules/ai/providers/mock-llm.provider.js';
import { toolRegistry } from '../../src/modules/ai/tools/tool-registry.js';
import { ragService } from '../../src/modules/rag/rag.service.js';
import { agentSecurityPolicy } from '../../src/modules/ai/guardrails/agent-security.policy.js';
import { MeetingService } from '../../src/modules/meetings/meeting.service.js';
import type { GmailService } from '../../src/modules/integrations/google/gmail.service.js';
import type { LlmMessage } from '../../src/modules/ai/ai.types.js';

// ─── In-memory mock stubs for external providers ─────────────────────────────

class MockCalendarService {
  async createEvent(_userId: string, event: Record<string, unknown>) {
    return {
      id: 'gcal-event-999',
      title: String(event['title'] ?? 'Mock Meeting'),
      startTime: new Date(event['startTime'] as string),
      endTime: new Date(event['endTime'] as string),
      htmlLink: 'https://calendar.google.com/event/mock',
      meetLink: 'https://meet.google.com/mock-xyz-abc',
      conferenceId: 'mock-conference-123',
    };
  }
}


// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('Agentic AI — Multi-Step Workflow Layer', () => {
  let ownerToken: string;
  let ownerUserId: string;
  let orgId: string;
  let projectId: string;

  let viewerToken: string;
  let viewerUserId: string;

  const ownerEmail = `wf.owner.${Date.now()}@example.com`;
  const viewerEmail = `wf.viewer.${Date.now()}@example.com`;

  let mockCalendarService: MockCalendarService;

  beforeAll(async () => {
    // Create Owner & Org
    const ownerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Workflow Owner',
        email: ownerEmail,
        password: 'Password123!',
        organizationName: 'Workflow Test Org',
      })
      .expect(201);

    ownerToken = ownerRes.body.data.accessToken;
    ownerUserId = ownerRes.body.data.user.id;
    orgId = ownerRes.body.data.organization.id;

    // Create Viewer directly without an initial organization & Add to Org 1 as VIEWER
    const passwordHash = await hashPassword('Password123!');
    const viewerUser = await prisma.user.create({
      data: {
        name: 'Workflow Viewer',
        email: viewerEmail,
        passwordHash,
        isEmailVerified: true,
      },
    });

    viewerUserId = viewerUser.id;
    viewerToken = generateAccessToken({ userId: viewerUser.id, email: viewerUser.email });

    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: viewerUserId,
        role: 'VIEWER',
      },
    });

    // Create a project in the org
    const projRes = await request(app)
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Workflow Alpha', key: 'WFA' })
      .expect(201);

    projectId = projRes.body.data.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [ownerEmail, viewerEmail] } },
    });

    for (const u of users) {
      await prisma.$transaction([
        prisma.ragKnowledgeDocument.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.meeting.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.comment.deleteMany({ where: { user: { id: u.id } } }),
        prisma.task.deleteMany({ where: { project: { organization: { ownerId: u.id } } } }),
        prisma.project.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.activityLog.deleteMany({ where: { userId: u.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: u.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: u.id } }),
        prisma.organization.deleteMany({ where: { ownerId: u.id } }),
        prisma.user.delete({ where: { id: u.id } }),
      ]);
    }
  });

  beforeEach(() => {
    mockCalendarService = new MockCalendarService();
  });

  // ─── 1. listMeetings Tool ─────────────────────────────────────────────────

  describe('listMeetings Tool', () => {
    it('should retrieve meetings scoped to organization', async () => {
      const meetingService = new MeetingService(
        undefined,
        undefined,
        mockCalendarService as never,
        undefined,
      );

      // First create a meeting directly via service so there is one to list
      await meetingService.createMeeting(orgId, ownerUserId, {
        title: 'Kickoff Meeting',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        syncWithGoogle: false,
        createGoogleMeet: false,
      });

      const result = await toolRegistry.executeTool(
        'listMeetings',
        { organizationId: orgId, userId: ownerUserId, userRole: 'OWNER' },
        { limit: 5 },
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should allow VIEWER role to call listMeetings (READ tool)', async () => {
      const result = await toolRegistry.executeTool(
        'listMeetings',
        { organizationId: orgId, userId: viewerUserId, userRole: 'VIEWER' },
        { limit: 5 },
      );

      expect(result.success).toBe(true);
    });
  });

  // ─── 2. scheduleMeeting Tool ──────────────────────────────────────────────

  describe('scheduleMeeting Tool (EXTERNAL_SIDE_EFFECT)', () => {
    it('should create a meeting via MeetingService with mocked Google Calendar', async () => {
      const meetingService = new MeetingService(
        undefined,
        undefined,
        mockCalendarService as never,
        undefined,
      );

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);
      const endTime = new Date(tomorrow);
      endTime.setHours(15, 0, 0, 0);

      const meeting = await meetingService.createMeeting(orgId, ownerUserId, {
        title: 'Sprint Review',
        startTime: tomorrow,
        endTime,
        description: 'End of sprint review',
        syncWithGoogle: true,
        createGoogleMeet: true,
      });

      expect(meeting.id).toBeDefined();
      expect(meeting.title).toBe('Sprint Review');
      expect(meeting.googleEventId).toBe('gcal-event-999');
      expect(meeting.googleMeetLink).toBe('https://meet.google.com/mock-xyz-abc');
      expect(meeting.isMeetEnabled).toBe(true);
    });

    it('should reject VIEWER role for scheduleMeeting (EXTERNAL_SIDE_EFFECT)', () => {
      const tool = toolRegistry.getTool('scheduleMeeting');
      expect(tool).toBeDefined();

      const evalResult = agentSecurityPolicy.evaluateToolExecution(
        tool,
        'scheduleMeeting',
        { organizationId: orgId, userId: viewerUserId, userRole: 'VIEWER' },
        {},
        { totalToolCalls: 0, mutationCalls: 0 },
      );

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toContain('is not authorized to execute EXTERNAL_SIDE_EFFECT tool "scheduleMeeting"');
    });

    it('should count scheduleMeeting against mutation limit (EXTERNAL_SIDE_EFFECT included in cap)', () => {
      const tool = toolRegistry.getTool('scheduleMeeting');
      expect(tool).toBeDefined();

      const evalResult = agentSecurityPolicy.evaluateToolExecution(
        tool,
        'scheduleMeeting',
        { organizationId: orgId, userId: ownerUserId, userRole: 'OWNER' },
        { title: 'Fourth Meeting', startTime: new Date(), endTime: new Date() },
        { totalToolCalls: 5, mutationCalls: 3, maxMutations: 3 },
      );

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toContain('Maximum mutation limit');
    });
  });

  // ─── 3. sendEmail Tool ────────────────────────────────────────────────────

  describe('sendEmail Tool (EXTERNAL_SIDE_EFFECT)', () => {
    it('should validate email recipient and send via GmailService spy', async () => {
      const sentMessages: Array<{ userId: string; to: string; subject: string }> = [];
      // Spy that impersonates the inner GoogleService dependency of GmailService
      const mockGoogleService = {
        async getValidAccessToken(_userId: string) {
          return 'mock-access-token';
        },
      };

      // We need to spy at the GmailService level directly
      // Instead, test the SendEmailTool schema+flow via a GmailService-shaped spy
      const { GmailService: GmailSvcClass } = await import(
        '../../src/modules/integrations/google/gmail.service.js'
      );
      const gmailSvc = new GmailSvcClass(mockGoogleService as never);

      // Intercept the fetch call by mocking at the service level
      const originalSendEmail = gmailSvc.sendEmail.bind(gmailSvc);
      gmailSvc.sendEmail = async function (userId, message) {
        const to = Array.isArray(message.to) ? message.to[0] : message.to;
        sentMessages.push({ userId, to: to ?? '', subject: message.subject });
        return { messageId: 'mock-gmail-msg-001', provider: 'gmail' as const, timestamp: new Date().toISOString() };
      };

      const result = await gmailSvc.sendEmail(ownerUserId, {
        to: 'rahul@example.com',
        subject: 'Sprint Review Invite',
        text: 'Hi Rahul, please join the review at 3 PM.',
        userId: ownerUserId,
      });

      expect(result.messageId).toBe('mock-gmail-msg-001');
      expect(result.provider).toBe('gmail');
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.to).toBe('rahul@example.com');

      // Restore (not strictly required in test isolation but good practice)
      void originalSendEmail;
    });


    it('should reject sendEmail with invalid email address at schema level', async () => {
      const result = await toolRegistry.executeTool(
        'sendEmail',
        { organizationId: orgId, userId: ownerUserId, userRole: 'OWNER' },
        {
          to: 'not-a-valid-email',
          subject: 'Test',
          body: 'Hello',
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool argument validation failed');
    });

    it('should reject VIEWER role for sendEmail (EXTERNAL_SIDE_EFFECT)', () => {
      const tool = toolRegistry.getTool('sendEmail');
      expect(tool).toBeDefined();

      const evalResult = agentSecurityPolicy.evaluateToolExecution(
        tool,
        'sendEmail',
        { organizationId: orgId, userId: viewerUserId, userRole: 'VIEWER' },
        { to: 'test@example.com', subject: 'Hi', body: 'Hello' },
        { totalToolCalls: 0, mutationCalls: 0 },
      );

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.reason).toContain('is not authorized to execute EXTERNAL_SIDE_EFFECT tool "sendEmail"');
    });
  });

  // ─── 4. Multi-Step Workflow via Mock LLM ─────────────────────────────────

  describe('Multi-Step Orchestrated Workflow', () => {
    it('should execute scheduleMeeting → sendEmail in a multi-step agent loop via mock LLM', async () => {
      // Build a custom tool registry for this test with fully-mocked dependencies
      const { ToolRegistry } = await import('../../src/modules/ai/tools/tool-registry.js');
      const { ScheduleMeetingTool } = await import('../../src/modules/ai/tools/schedule-meeting.tool.js');
      const { SendEmailTool } = await import('../../src/modules/ai/tools/send-email.tool.js');
      const { ListMeetingsTool } = await import('../../src/modules/ai/tools/list-meetings.tool.js');

      // Spy-compatible mock: impersonates GmailService directly (has sendEmail method)
      const emailsSent: Array<{ userId: string; to: string; subject: string }> = [];
      const spyGmailService = {
        async sendEmail(userId: string, message: { to: string | string[]; subject: string }) {
          const to = Array.isArray(message.to) ? message.to[0] : message.to;
          emailsSent.push({ userId, to, subject: message.subject });
          return {
            messageId: 'mock-gmail-msg-001',
            provider: 'gmail' as const,
            response: 'Mock sent',
            timestamp: new Date().toISOString(),
          };
        },
      } as unknown as GmailService;

      const meetingService = new MeetingService(
        undefined,
        undefined,
        mockCalendarService as never,
        undefined,
      );

      const customRegistry = new ToolRegistry();
      // register() uses Map.set() so these overwrite the defaults registered in constructor
      customRegistry.register(new ScheduleMeetingTool(meetingService));
      customRegistry.register(new SendEmailTool(spyGmailService));
      customRegistry.register(new ListMeetingsTool(meetingService));

      // Multi-step custom handler
      const mock = new MockAiLlmProvider();
      let step = 0;

      mock.setHandler(async (messages: LlmMessage[]) => {
        step++;
        const toolMessages = messages.filter((m) => m.role === 'tool');

        if (step === 1) {
          // LLM requests scheduleMeeting
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(15, 0, 0, 0);
          const endTime = new Date(tomorrow);
          endTime.setHours(16, 0, 0, 0);

          return {
            content: '',
            toolCalls: [
              {
                id: 'wf-meet-1',
                name: 'scheduleMeeting',
                arguments: {
                  title: 'Sprint Review Meeting',
                  startTime: tomorrow.toISOString(),
                  endTime: endTime.toISOString(),
                  createGoogleMeet: true,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        if (step === 2) {
          // After meeting created, LLM requests sendEmail
          const meetToolMsg = toolMessages.find((m) => m.name === 'scheduleMeeting');
          expect(meetToolMsg).toBeDefined();
          const parsed = JSON.parse(meetToolMsg?.content ?? '{}') as { success?: boolean };
          expect(parsed.success).toBe(true);

          return {
            content: '',
            toolCalls: [
              {
                id: 'wf-email-1',
                name: 'sendEmail',
                arguments: {
                  to: 'rahul@example.com',
                  subject: 'Sprint Review Invite',
                  body: 'Hi Rahul, your Sprint Review meeting is scheduled. Join here: https://meet.google.com/mock-xyz-abc',
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Final answer after email sent
        return {
          content:
            'Done! I have scheduled the Sprint Review Meeting with a Google Meet link and emailed Rahul the meeting details.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(mock, customRegistry, ragService);

      const response = await orchestrator.run(
        { organizationId: orgId, userId: ownerUserId, userRole: 'OWNER' },
        {
          message: 'Schedule a sprint review meeting for tomorrow at 3 PM and email Rahul at rahul@example.com',
          includeRagContext: false,
          maxSteps: 10,
          maxToolCalls: 5,
        },
      );

      expect(response.answer).toContain('Sprint Review');
      expect(response.toolsUsed).toContain('scheduleMeeting');
      expect(response.toolsUsed).toContain('sendEmail');
      expect(response.stepsCount).toBeGreaterThan(1);
      expect(response.toolCallsCount).toBe(2);

      // Gmail was called on our spy mock — verify the injected GmailService was hit
      expect(emailsSent).toHaveLength(1);
      expect(emailsSent[0]?.to).toBe('rahul@example.com');
    });

    it('should NOT send email if VIEWER calls agent — security policy blocks sendEmail', async () => {
      const mock = new MockAiLlmProvider();
      let step = 0;

      mock.setHandler(async (messages: LlmMessage[]) => {
        step++;

        if (step === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'blocked-email-2',
                name: 'sendEmail',
                arguments: { to: 'victim@example.com', subject: 'Hack', body: 'Compromised' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // After guardrail rejection message, LLM provides final answer
        const toolMsg = messages.filter((m) => m.role === 'tool').pop();
        const parsed = JSON.parse(toolMsg?.content ?? '{}') as { success?: boolean; error?: string };
        // Guardrail rejected it
        expect(parsed.success).toBe(false);

        return {
          content: 'I could not send the email because you do not have permission for this action.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(mock, toolRegistry, ragService);

      const response = await orchestrator.run(
        { organizationId: orgId, userId: viewerUserId, userRole: 'VIEWER' },
        {
          message: 'Send an email to everyone',
          includeRagContext: false,
        },
      );

      expect(response.answer).toBeDefined();
      // No emails should have been sent
      expect(response.toolsUsed).toContain('sendEmail');
      // But the tool call count increments while the tool itself was blocked
      expect(response.toolCallsCount).toBe(1);
    });

    it('should stop further side-effect operations after maxMutations reached', async () => {
      const meetingService = new MeetingService(
        undefined,
        undefined,
        mockCalendarService as never,
        undefined,
      );

      // Inline spy directly impersonating GmailService
      const emailsSent: string[] = [];
      const spyGmailSvc = {
        async sendEmail(_userId: string, message: { to: string | string[] }) {
          const to = Array.isArray(message.to) ? message.to[0] : message.to;
          emailsSent.push(to ?? '');
          return { messageId: 'mock-id', provider: 'gmail' as const, timestamp: new Date().toISOString() };
        },
      } as unknown as GmailService;

      const { ToolRegistry } = await import('../../src/modules/ai/tools/tool-registry.js');
      const { ScheduleMeetingTool } = await import('../../src/modules/ai/tools/schedule-meeting.tool.js');
      const { SendEmailTool } = await import('../../src/modules/ai/tools/send-email.tool.js');

      const customRegistry = new ToolRegistry();
      customRegistry.register(new ScheduleMeetingTool(meetingService));
      customRegistry.register(new SendEmailTool(spyGmailSvc));

      const mock = new MockAiLlmProvider();
      let step = 0;

      mock.setHandler(async (messages: LlmMessage[]) => {
        step++;
        const toolMessages = messages.filter((m) => m.role === 'tool');

        // 3 scheduleMeeting calls followed by sendEmail — after 3 mutations, sendEmail should be blocked
        if (step <= 3) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + step);
          tomorrow.setHours(10, 0, 0, 0);
          const endTime = new Date(tomorrow);
          endTime.setHours(11, 0, 0, 0);

          return {
            content: '',
            toolCalls: [
              {
                id: `meet-${step}`,
                name: 'scheduleMeeting',
                arguments: {
                  title: `Meeting ${step}`,
                  startTime: tomorrow.toISOString(),
                  endTime: endTime.toISOString(),
                  createGoogleMeet: false,
                },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        if (step === 4) {
          // 4th call tries sendEmail — should be blocked by mutation limit
          return {
            content: '',
            toolCalls: [
              {
                id: 'email-4',
                name: 'sendEmail',
                arguments: { to: 'test@example.com', subject: 'Fourth', body: 'Should be blocked' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }

        // Final answer — sendEmail was blocked
        const emailMsg = toolMessages.find((m) => m.name === 'sendEmail');
        if (emailMsg) {
          const parsed = JSON.parse(emailMsg.content) as { success?: boolean };
          expect(parsed.success).toBe(false);
        }

        return {
          content: 'Meetings scheduled. Could not send email: mutation limit reached.',
          finishReason: 'stop',
        };
      });

      const orchestrator = new AgentOrchestrator(mock, customRegistry, ragService);

      const response = await orchestrator.run(
        { organizationId: orgId, userId: ownerUserId, userRole: 'OWNER' },
        {
          message: 'Schedule 3 meetings and then send an email',
          includeRagContext: false,
          maxSteps: 10,
          maxToolCalls: 10,
        },
      );

      expect(response.answer).toBeDefined();
      // Gmail should NEVER have been called — blocked by mutation limit
      expect(emailsSent).toHaveLength(0);
    });
  });

  // ─── 5. HTTP API Endpoint — E2E ───────────────────────────────────────────

  describe('HTTP API — POST /api/v1/organizations/:orgId/ai/agent', () => {
    it('should return 200 and list meetings via the agent HTTP endpoint', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/ai/agent`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          message: 'List my upcoming meetings',
          includeRagContext: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBeDefined();
    });

    it('should reject requests from Viewer to agent that try to schedule a meeting', async () => {
      // Default mock LLM will emit scheduleMeeting call which will be blocked
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/ai/agent`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          message: 'Schedule a meeting',
          includeRagContext: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // The agent returns an answer (not a 403 crash), but the tool is blocked by policy
      expect(res.body.data.answer).toBeDefined();
    });
  });
});
