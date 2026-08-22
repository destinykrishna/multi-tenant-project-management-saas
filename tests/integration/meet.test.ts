import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { encryptToken } from '../../src/utils/encryption.js';

describe('Google Meet API & Meeting Integration', () => {
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let org1Id: string;
  let org2Id: string;

  const testEmail1 = `meet.test.user1.${Date.now()}@example.com`;
  const testEmail2 = `meet.test.user2.${Date.now()}@example.com`;

  const mockGoogleId = 'google-sub-meet-12345';
  const mockGoogleEmail = 'user1.meet@gmail.com';
  const initialAccessToken = 'ya29.meet_initial_access_token_12345';
  const refreshedAccessToken = 'ya29.meet_refreshed_access_token_67890';
  const mockRefreshToken = '1//0gMockRefreshTokenMeetValue';

  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    (env as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'test-google-client-id';
    (env as { GOOGLE_CLIENT_SECRET: string }).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    (env as { GOOGLE_REDIRECT_URI: string }).GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/v1/integrations/google/callback';

    // Register User 1 + Org 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Meet User 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Meet Org 1',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // Register User 2 + Org 2 (Unconnected Google)
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Meet User 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Meet Org 2',
      })
      .expect(201);

    user2Token = res2.body.data.accessToken;
    user2Id = res2.body.data.user.id;
    org2Id = res2.body.data.organization.id;

    // Setup connected Google account with Calendar Scope for User 1
    await prisma.googleAccount.create({
      data: {
        userId: user1Id,
        googleId: mockGoogleId,
        email: mockGoogleEmail,
        accessTokenEncrypted: encryptToken(initialAccessToken),
        refreshTokenEncrypted: encryptToken(mockRefreshToken),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour valid
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/calendar.events',
        ],
      },
    });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [testEmail1, testEmail2] } },
      include: { ownedOrganizations: true },
    });

    for (const u of users) {
      await prisma.$transaction([
        prisma.meeting.deleteMany({ where: { organization: { ownerId: u.id } } }),
        prisma.googleAccount.deleteMany({ where: { userId: u.id } }),
        prisma.activityLog.deleteMany({ where: { userId: u.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: u.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: u.id } }),
        prisma.organization.deleteMany({ where: { ownerId: u.id } }),
        prisma.user.delete({ where: { id: u.id } }),
      ]);
    }

    await disconnectDatabase();
  });

  beforeEach(() => {
    originalFetch = global.fetch;

    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      // 1. Mock Google Token Refresh Endpoint
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        const bodyStr = init?.body ? init.body.toString() : '';

        if (bodyStr.includes('revoked_refresh_token')) {
          return {
            ok: false,
            status: 400,
            text: async () => '{"error": "invalid_grant", "error_description": "Token has been revoked."}',
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: refreshedAccessToken,
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid https://www.googleapis.com/auth/calendar.events',
          }),
          text: async () => '',
        } as unknown as Response;
      }

      // 2. Mock Google Calendar Events Endpoint with Google Meet conferenceData
      if (urlStr.includes('googleapis.com/calendar/v3/calendars/primary/events')) {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization || '';

        if (authHeader.includes('invalid_access_token')) {
          return {
            ok: false,
            status: 401,
            text: async () => '{"error": {"code": 401, "message": "Invalid Credentials"}}',
          } as unknown as Response;
        }

        if (authHeader.includes('rate_limited_token')) {
          return {
            ok: false,
            status: 429,
            text: async () => '{"error": {"code": 429, "message": "Rate limit exceeded"}}',
          } as unknown as Response;
        }

        // CREATE Event
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body ? init.body.toString() : '{}');
          const isMeet = urlStr.includes('conferenceDataVersion=1') || body.conferenceData;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_meet_event_id_456',
              summary: body.summary,
              description: body.description,
              location: body.location,
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_meet_event_id_456',
              hangoutLink: isMeet ? 'https://meet.google.com/abc-defg-hij' : undefined,
              conferenceData: isMeet
                ? {
                    conferenceId: 'abc-defg-hij',
                    entryPoints: [
                      {
                        entryPointType: 'video',
                        uri: 'https://meet.google.com/abc-defg-hij',
                        label: 'meet.google.com/abc-defg-hij',
                      },
                    ],
                    conferenceSolution: {
                      key: { type: 'hangoutsMeet' },
                      name: 'Google Meet',
                    },
                  }
                : undefined,
              status: 'confirmed',
              start: body.start,
              end: body.end,
              attendees: body.attendees,
            }),
            text: async () => '',
          } as unknown as Response;
        }

        // UPDATE Event
        if (init?.method === 'PATCH') {
          const body = JSON.parse(init.body ? init.body.toString() : '{}');
          const isMeet = urlStr.includes('conferenceDataVersion=1') || body.conferenceData;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_meet_event_id_456',
              summary: body.summary || 'Updated Meeting',
              description: body.description,
              location: body.location,
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_meet_event_id_456',
              hangoutLink: isMeet ? 'https://meet.google.com/abc-defg-hij' : undefined,
              conferenceData: isMeet
                ? {
                    conferenceId: 'abc-defg-hij',
                    entryPoints: [
                      {
                        entryPointType: 'video',
                        uri: 'https://meet.google.com/abc-defg-hij',
                        label: 'meet.google.com/abc-defg-hij',
                      },
                    ],
                    conferenceSolution: {
                      key: { type: 'hangoutsMeet' },
                      name: 'Google Meet',
                    },
                  }
                : undefined,
              status: 'confirmed',
              start: body.start,
              end: body.end,
            }),
            text: async () => '',
          } as unknown as Response;
        }

        // DELETE Event
        if (init?.method === 'DELETE') {
          return {
            ok: true,
            status: 204,
            text: async () => '',
          } as unknown as Response;
        }

        // GET Single Event
        if (urlStr.includes('/mock_google_meet_event_id_456')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_meet_event_id_456',
              summary: 'Retrieved Meet Event',
              description: 'Event Description',
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_meet_event_id_456',
              hangoutLink: 'https://meet.google.com/abc-defg-hij',
              conferenceData: {
                conferenceId: 'abc-defg-hij',
                entryPoints: [
                  {
                    entryPointType: 'video',
                    uri: 'https://meet.google.com/abc-defg-hij',
                    label: 'meet.google.com/abc-defg-hij',
                  },
                ],
              },
              status: 'confirmed',
              start: { dateTime: '2026-09-01T10:00:00Z' },
              end: { dateTime: '2026-09-01T11:00:00Z' },
            }),
            text: async () => '',
          } as unknown as Response;
        }

        // LIST Events
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'mock_google_meet_event_id_456',
                summary: 'Meet Planning',
                hangoutLink: 'https://meet.google.com/abc-defg-hij',
                start: { dateTime: '2026-09-01T10:00:00Z' },
                end: { dateTime: '2026-09-01T11:00:00Z' },
              },
            ],
          }),
          text: async () => '',
        } as unknown as Response;
      }

      return {
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as unknown as Response;
    }) as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Direct Google Meet Standalone Generation (/api/v1/integrations/google/meet/generate)', () => {
    it('should generate a standalone Google Meet link', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/meet/generate')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Quick Ad-Hoc Meet',
          startTime: '2026-09-05T14:00:00.000Z',
          endTime: '2026-09-05T15:00:00.000Z',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.meetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(response.body.data.conferenceId).toBe('abc-defg-hij');

      // Zero token exposure
      const resStr = JSON.stringify(response.body);
      expect(resStr).not.toContain(initialAccessToken);
      expect(resStr).not.toContain(mockRefreshToken);
    });

    it('should fail with 404 NO_GOOGLE_CONNECTION for user without Google connection', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/meet/generate')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          title: 'Unconnected User Meet',
          startTime: '2026-09-05T14:00:00.000Z',
          endTime: '2026-09-05T15:00:00.000Z',
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_GOOGLE_CONNECTION');
    });
  });

  describe('Meeting Domain with Google Meet Conference Workflow', () => {
    let meetMeetingId: string;

    it('should create a meeting in PostgreSQL with Google Meet enabled and log activity', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/meetings`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Client Demo & Strategy Session',
          description: 'Demonstrating new SaaS features with Google Meet',
          startTime: '2026-09-06T15:00:00.000Z',
          endTime: '2026-09-06T16:00:00.000Z',
          createGoogleMeet: true,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.isMeetEnabled).toBe(true);
      expect(response.body.data.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(response.body.data.googleMeetId).toBe('abc-defg-hij');
      expect(response.body.data.googleEventId).toBe('mock_google_meet_event_id_456');

      meetMeetingId = response.body.data.id;

      // Verify PostgreSQL (Source of Truth)
      const dbMeeting = await prisma.meeting.findUnique({
        where: { id: meetMeetingId },
      });
      expect(dbMeeting).toBeDefined();
      expect(dbMeeting?.isMeetEnabled).toBe(true);
      expect(dbMeeting?.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(dbMeeting?.googleMeetId).toBe('abc-defg-hij');

      // Verify MEET_LINK_CREATED activity log recorded
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityId: meetMeetingId,
          action: 'MEET_LINK_CREATED',
        },
      });
      expect(activity).toBeDefined();
      expect(activity?.metadata).toMatchObject({
        googleMeetLink: 'https://meet.google.com/abc-defg-hij',
      });
    });

    it('should retrieve meeting details including Google Meet link', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/meetings/${meetMeetingId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(meetMeetingId);
      expect(response.body.data.isMeetEnabled).toBe(true);
      expect(response.body.data.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
    });

    it('should attach Google Meet link to an existing meeting via POST /:meetingId/meet', async () => {
      // Create regular meeting without Meet
      const createRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/meetings`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Originally In-Person Meeting',
          startTime: '2026-09-07T10:00:00.000Z',
          endTime: '2026-09-07T11:00:00.000Z',
          syncWithGoogle: false,
          createGoogleMeet: false,
        })
        .expect(201);

      const regularMeetingId = createRes.body.data.id;
      expect(createRes.body.data.isMeetEnabled).toBe(false);
      expect(createRes.body.data.googleMeetLink).toBeNull();

      // Attach Meet link
      const attachRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/meetings/${regularMeetingId}/meet`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(attachRes.body.success).toBe(true);
      expect(attachRes.body.data.isMeetEnabled).toBe(true);
      expect(attachRes.body.data.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(attachRes.body.data.googleMeetId).toBe('abc-defg-hij');

      // Verify DB updated
      const dbMeeting = await prisma.meeting.findUnique({
        where: { id: regularMeetingId },
      });
      expect(dbMeeting?.isMeetEnabled).toBe(true);
      expect(dbMeeting?.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
    });

    it('should enforce tenant isolation (User 2 cannot generate Meet link on Org 1 meeting)', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/meetings/${meetMeetingId}/meet`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should handle auto-refresh token during Meet creation when token is expired', async () => {
      // Expire user1 token in database
      await prisma.googleAccount.update({
        where: { userId: user1Id },
        data: {
          tokenExpiresAt: new Date(Date.now() - 5000),
        },
      });

      const response = await request(app)
        .post('/api/v1/integrations/google/meet/generate')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Post-Refresh Meet Test',
          startTime: '2026-09-08T10:00:00.000Z',
          endTime: '2026-09-08T11:00:00.000Z',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.meetLink).toBe('https://meet.google.com/abc-defg-hij');

      const updatedAccount = await prisma.googleAccount.findUnique({
        where: { userId: user1Id },
      });
      expect(updatedAccount?.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
