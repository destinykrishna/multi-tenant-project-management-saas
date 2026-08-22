import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { encryptToken } from '../../src/utils/encryption.js';

describe('Google Calendar API & Meeting Integration', () => {
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let org1Id: string;
  let org2Id: string;

  const testEmail1 = `cal.test.user1.${Date.now()}@example.com`;
  const testEmail2 = `cal.test.user2.${Date.now()}@example.com`;

  const mockGoogleId = 'google-sub-cal-12345';
  const mockGoogleEmail = 'user1.calendar@gmail.com';
  const initialAccessToken = 'ya29.cal_initial_access_token_12345';
  const refreshedAccessToken = 'ya29.cal_refreshed_access_token_67890';
  const mockRefreshToken = '1//0gMockRefreshTokenCalValue';

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
        name: 'Calendar User 1',
        email: testEmail1,
        password: 'Password123!',
        organizationName: 'Calendar Org 1',
      })
      .expect(201);

    user1Token = res1.body.data.accessToken;
    user1Id = res1.body.data.user.id;
    org1Id = res1.body.data.organization.id;

    // Register User 2 + Org 2 (Unconnected Google)
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Calendar User 2',
        email: testEmail2,
        password: 'Password123!',
        organizationName: 'Calendar Org 2',
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

      // 2. Mock Google Calendar Events Endpoint
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
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_event_id_123',
              summary: body.summary,
              description: body.description,
              location: body.location,
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_event_id_123',
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
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_event_id_123',
              summary: body.summary || 'Updated Meeting',
              description: body.description,
              location: body.location,
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_event_id_123',
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
        if (urlStr.includes('/mock_google_event_id_123')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 'mock_google_event_id_123',
              summary: 'Retrieved Event',
              description: 'Event Description',
              htmlLink: 'https://www.google.com/calendar/event?eid=mock_google_event_id_123',
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
                id: 'mock_google_event_id_123',
                summary: 'Sprint Planning',
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

  describe('Direct Google Calendar Integration Endpoints (/api/v1/integrations/google/calendar)', () => {
    it('should create standalone calendar event and return output without exposing tokens', async () => {
      const response = await request(app)
        .post('/api/v1/integrations/google/calendar/events')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Direct Google Calendar Event',
          description: 'Discussing project roadmap',
          startTime: '2026-09-01T14:00:00.000Z',
          endTime: '2026-09-01T15:00:00.000Z',
          location: 'Virtual Room A',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('mock_google_event_id_123');
      expect(response.body.data.title).toBe('Direct Google Calendar Event');
      expect(response.body.data.htmlLink).toBeDefined();

      // Zero token exposure
      const resStr = JSON.stringify(response.body);
      expect(resStr).not.toContain(initialAccessToken);
      expect(resStr).not.toContain(mockRefreshToken);
    });

    it('should list calendar events for connected user', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/calendar/events')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should get single calendar event by eventId', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/calendar/events/mock_google_event_id_123')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('mock_google_event_id_123');
    });

    it('should update calendar event by eventId', async () => {
      const response = await request(app)
        .patch('/api/v1/integrations/google/calendar/events/mock_google_event_id_123')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Updated Event Title',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('mock_google_event_id_123');
    });

    it('should delete calendar event by eventId', async () => {
      const response = await request(app)
        .delete('/api/v1/integrations/google/calendar/events/mock_google_event_id_123')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
    });

    it('should fail with 404 NO_GOOGLE_CONNECTION when user 2 (unconnected) tries calendar operations', async () => {
      const response = await request(app)
        .get('/api/v1/integrations/google/calendar/events')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NO_GOOGLE_CONNECTION');
    });
  });

  describe('Organization Meeting Domain Endpoints & Google Sync', () => {
    let createdMeetingId: string;

    it('should create meeting in PostgreSQL and sync to Google Calendar with activity logging', async () => {
      const response = await request(app)
        .post(`/api/v1/organizations/${org1Id}/meetings`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Sprint Retrospective',
          description: 'Review previous sprint outcomes',
          startTime: '2026-09-02T10:00:00.000Z',
          endTime: '2026-09-02T11:00:00.000Z',
          location: 'Conference Room 1',
          syncWithGoogle: true,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.title).toBe('Sprint Retrospective');
      expect(response.body.data.googleEventId).toBe('mock_google_event_id_123');
      expect(response.body.data.googleHtmlLink).toBeDefined();
      expect(response.body.data.googleSyncedAt).toBeDefined();

      createdMeetingId = response.body.data.id;

      // Verify Meeting persisted in PostgreSQL (Source of Truth)
      const dbMeeting = await prisma.meeting.findUnique({
        where: { id: createdMeetingId },
      });
      expect(dbMeeting).toBeDefined();
      expect(dbMeeting?.organizationId).toBe(org1Id);
      expect(dbMeeting?.title).toBe('Sprint Retrospective');
      expect(dbMeeting?.googleEventId).toBe('mock_google_event_id_123');

      // Verify Activity Log created
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityId: createdMeetingId,
          action: 'CREATED',
        },
      });
      expect(activity).toBeDefined();
      expect(activity?.entityType).toBe('MEETING');
    });

    it('should list meetings for organization with pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/meetings`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      expect(response.body.data.pagination.total).toBeGreaterThan(0);
    });

    it('should get meeting by ID for organization member', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/meetings/${createdMeetingId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(createdMeetingId);
    });

    it('should update meeting and sync changes to Google Calendar with activity logging', async () => {
      const response = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/meetings/${createdMeetingId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Updated Sprint Retrospective Title',
          location: 'Updated Conference Room 2',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Updated Sprint Retrospective Title');
      expect(response.body.data.location).toBe('Updated Conference Room 2');

      // Verify Activity Log updated
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityId: createdMeetingId,
          action: 'UPDATED',
        },
      });
      expect(activity).toBeDefined();
    });

    it('should delete meeting, remove from Google Calendar and log deletion activity', async () => {
      const response = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/meetings/${createdMeetingId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);

      // Verify removed from Database
      const dbMeeting = await prisma.meeting.findUnique({
        where: { id: createdMeetingId },
      });
      expect(dbMeeting).toBeNull();

      // Verify Activity Log for deletion
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: org1Id,
          entityId: createdMeetingId,
          action: 'DELETED',
        },
      });
      expect(activity).toBeDefined();
    });

    it('should enforce tenant isolation (User 2 cannot access Org 1 meetings)', async () => {
      const response = await request(app)
        .get(`/api/v1/organizations/${org1Id}/meetings`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('should auto-refresh expired access token during calendar API calls', async () => {
      // Expire user 1 access token in database
      await prisma.googleAccount.update({
        where: { userId: user1Id },
        data: {
          tokenExpiresAt: new Date(Date.now() - 5000),
        },
      });

      const response = await request(app)
        .post('/api/v1/integrations/google/calendar/events')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          title: 'Post-Refresh Calendar Event',
          startTime: '2026-09-03T10:00:00.000Z',
          endTime: '2026-09-03T11:00:00.000Z',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('mock_google_event_id_123');

      // Verify database updated with fresh expiration
      const updatedAccount = await prisma.googleAccount.findUnique({
        where: { userId: user1Id },
      });
      expect(updatedAccount?.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should handle missing calendar scope when user connected without calendar permissions', async () => {
      // Setup a connection without calendar scope for User 2
      await prisma.googleAccount.create({
        data: {
          userId: user2Id,
          googleId: 'google-user-2-no-cal',
          email: 'user2.nocal@gmail.com',
          accessTokenEncrypted: encryptToken('ya29.user2_token'),
          refreshTokenEncrypted: encryptToken('refresh_user2'),
          tokenExpiresAt: new Date(Date.now() + 3600000),
          scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'],
        },
      });

      const response = await request(app)
        .post('/api/v1/integrations/google/calendar/events')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          title: 'Should Fail Due To Scope',
          startTime: '2026-09-03T10:00:00.000Z',
          endTime: '2026-09-03T11:00:00.000Z',
        })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('GOOGLE_CALENDAR_SCOPE_MISSING');
    });
  });
});
