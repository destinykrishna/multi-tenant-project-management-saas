import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { encryptToken } from '../../src/utils/encryption.js';

describe('Meeting Attendee Selection & Multi-Tenant Integration Tests', () => {
  let ownerToken: string;
  let ownerId: string;
  let member1Token: string;
  let member1Id: string;
  let member2Token: string;
  let member2Id: string;
  let viewerToken: string;
  let viewerId: string;

  let orgAId: string;
  let orgBId: string;
  let orgBOwnerToken: string;
  let orgBOwnerId: string;

  const ownerEmail = `meet.owner.${Date.now()}@example.com`;
  const member1Email = `meet.member1.${Date.now()}@example.com`;
  const member2Email = `meet.member2.${Date.now()}@example.com`;
  const viewerEmail = `meet.viewer.${Date.now()}@example.com`;
  const orgBOwnerEmail = `meet.orgb.owner.${Date.now()}@example.com`;

  let originalFetch: typeof global.fetch;
  let lastGoogleApiRequestBody: any = null;

  beforeAll(async () => {
    (env as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'test-google-client-id';
    (env as { GOOGLE_CLIENT_SECRET: string }).GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    (env as { GOOGLE_REDIRECT_URI: string }).GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/v1/integrations/google/callback';

    // 1. Create Organization A Owner
    const regOwner = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Org A Owner',
        email: ownerEmail,
        password: 'Password123!',
        organizationName: 'Meeting Org A',
      })
      .expect(201);

    ownerToken = regOwner.body.data.accessToken;
    ownerId = regOwner.body.data.user.id;
    orgAId = regOwner.body.data.organization.id;

    // Setup connected Google account with Calendar Scope for Owner
    await prisma.googleAccount.create({
      data: {
        userId: ownerId,
        googleId: 'google-sub-owner-12345',
        email: 'owner.google@gmail.com',
        accessTokenEncrypted: encryptToken('ya29.mock_owner_access_token'),
        refreshTokenEncrypted: encryptToken('1//mock_owner_refresh_token'),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/calendar.events',
        ],
      },
    });

    // 2. Create Member 1 in Org A
    const regM1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Member One',
        email: member1Email,
        password: 'Password123!',
        organizationName: 'Temp Org M1',
      })
      .expect(201);
    member1Id = regM1.body.data.user.id;
    // Move to Org A as MEMBER
    await prisma.organizationMember.deleteMany({ where: { userId: member1Id } });
    await prisma.organization.deleteMany({ where: { ownerId: member1Id } });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: member1Id, role: 'MEMBER' },
    });
    // Log in to get fresh token
    const loginM1 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: member1Email, password: 'Password123!' })
      .expect(200);
    member1Token = loginM1.body.data.accessToken;

    // 3. Create Member 2 in Org A
    const regM2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Member Two',
        email: member2Email,
        password: 'Password123!',
        organizationName: 'Temp Org M2',
      })
      .expect(201);
    member2Id = regM2.body.data.user.id;
    await prisma.organizationMember.deleteMany({ where: { userId: member2Id } });
    await prisma.organization.deleteMany({ where: { ownerId: member2Id } });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: member2Id, role: 'MEMBER' },
    });
    const loginM2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: member2Email, password: 'Password123!' })
      .expect(200);
    member2Token = loginM2.body.data.accessToken;

    // 4. Create Viewer in Org A
    const regV = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Viewer User',
        email: viewerEmail,
        password: 'Password123!',
        organizationName: 'Temp Org V',
      })
      .expect(201);
    viewerId = regV.body.data.user.id;
    await prisma.organizationMember.deleteMany({ where: { userId: viewerId } });
    await prisma.organization.deleteMany({ where: { ownerId: viewerId } });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: viewerId, role: 'VIEWER' },
    });
    const loginV = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password: 'Password123!' })
      .expect(200);
    viewerToken = loginV.body.data.accessToken;

    // 5. Create Organization B with its own Owner
    const regOrgB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Org B Owner',
        email: orgBOwnerEmail,
        password: 'Password123!',
        organizationName: 'Meeting Org B',
      })
      .expect(201);
    orgBOwnerToken = regOrgB.body.data.accessToken;
    orgBOwnerId = regOrgB.body.data.user.id;
    orgBId = regOrgB.body.data.organization.id;
  });

  afterAll(async () => {
    const emails = [ownerEmail, member1Email, member2Email, viewerEmail, orgBOwnerEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
    });

    for (const u of users) {
      await prisma.$transaction([
        prisma.meetingAttendee.deleteMany({ where: { meeting: { organizationId: { in: [orgAId, orgBId] } } } }),
        prisma.meeting.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }),
        prisma.googleAccount.deleteMany({ where: { userId: u.id } }),
        prisma.activityLog.deleteMany({ where: { userId: u.id } }),
        prisma.refreshSession.deleteMany({ where: { userId: u.id } }),
        prisma.organizationMember.deleteMany({ where: { userId: u.id } }),
        prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }),
        prisma.user.delete({ where: { id: u.id } }),
      ]);
    }

    await disconnectDatabase();
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    lastGoogleApiRequestBody = null;

    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('googleapis.com/calendar/v3/calendars/primary/events')) {
        if (init?.body) {
          lastGoogleApiRequestBody = JSON.parse(init.body.toString());
        }

        const isMeet = urlStr.includes('conferenceDataVersion=1') || lastGoogleApiRequestBody?.conferenceData;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'mock_calendar_event_attendee_test',
            summary: lastGoogleApiRequestBody?.summary || 'Test Meeting',
            description: lastGoogleApiRequestBody?.description,
            htmlLink: 'https://www.google.com/calendar/event?eid=mock_calendar_event_attendee_test',
            hangoutLink: isMeet ? 'https://meet.google.com/xyz-uvwx-rst' : undefined,
            conferenceData: isMeet
              ? {
                  conferenceId: 'xyz-uvwx-rst',
                  entryPoints: [
                    {
                      entryPointType: 'video',
                      uri: 'https://meet.google.com/xyz-uvwx-rst',
                      label: 'meet.google.com/xyz-uvwx-rst',
                    },
                  ],
                }
              : undefined,
            status: 'confirmed',
            start: lastGoogleApiRequestBody?.start,
            end: lastGoogleApiRequestBody?.end,
            attendees: lastGoogleApiRequestBody?.attendees,
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

  describe('1. Role-Based Access Control (RBAC)', () => {
    it('should allow OWNER to schedule a meeting with attendees', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Owner Architecture Sync',
          startTime: '2026-10-15T14:00:00.000Z',
          endTime: '2026-10-15T15:00:00.000Z',
          attendeeUserIds: [member1Id],
        })
        .expect(201);

      expect(res.body.data.title).toBe('Owner Architecture Sync');
      expect(res.body.data.attendees).toHaveLength(1);
      expect(res.body.data.attendees[0].userId).toBe(member1Id);
    });

    it('should allow MEMBER to schedule a meeting with attendees', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${member1Token}`)
        .send({
          title: 'Member Team Sync',
          startTime: '2026-10-15T16:00:00.000Z',
          endTime: '2026-10-15T17:00:00.000Z',
          attendeeUserIds: [ownerId, member2Id],
        })
        .expect(201);

      expect(res.body.data.title).toBe('Member Team Sync');
      expect(res.body.data.attendees).toHaveLength(2);
      const userIds = res.body.data.attendees.map((a: any) => a.userId);
      expect(userIds).toContain(ownerId);
      expect(userIds).toContain(member2Id);
    });

    it('should FORBID VIEWER from scheduling a meeting (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          title: 'Unauthorized Viewer Meeting',
          startTime: '2026-10-15T18:00:00.000Z',
          endTime: '2026-10-15T19:00:00.000Z',
          attendeeUserIds: [member1Id],
        })
        .expect(403);

      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('2. Attendee Selection Combinations', () => {
    it('should schedule meeting with zero attendees selected', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Solo Planning Session',
          startTime: '2026-10-16T10:00:00.000Z',
          endTime: '2026-10-16T11:00:00.000Z',
          attendeeUserIds: [],
        })
        .expect(201);

      expect(res.body.data.title).toBe('Solo Planning Session');
      expect(res.body.data.attendees).toHaveLength(0);
    });

    it('should schedule meeting with 1 selected attendee', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: '1-on-1 Review',
          startTime: '2026-10-16T11:00:00.000Z',
          endTime: '2026-10-16T11:30:00.000Z',
          attendeeUserIds: [member1Id],
        })
        .expect(201);

      expect(res.body.data.attendees).toHaveLength(1);
      expect(res.body.data.attendees[0].userId).toBe(member1Id);
      expect(res.body.data.attendees[0].user.email).toBe(member1Email);
    });

    it('should schedule meeting with multiple selected attendees', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Tri-Party Architecture Review',
          startTime: '2026-10-16T13:00:00.000Z',
          endTime: '2026-10-16T14:00:00.000Z',
          attendeeUserIds: [member1Id, member2Id],
        })
        .expect(201);

      expect(res.body.data.attendees).toHaveLength(2);
      const userIds = res.body.data.attendees.map((a: any) => a.userId);
      expect(userIds).toContain(member1Id);
      expect(userIds).toContain(member2Id);
    });

    it('should schedule meeting with all organization members selected', async () => {
      const allOrgAMembers = [ownerId, member1Id, member2Id, viewerId];

      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'All-Hands Sync',
          startTime: '2026-10-16T15:00:00.000Z',
          endTime: '2026-10-16T16:00:00.000Z',
          attendeeUserIds: allOrgAMembers,
        })
        .expect(201);

      expect(res.body.data.attendees).toHaveLength(4);
    });

    it('should deduplicate duplicate attendee IDs in request', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Duplicate ID Test Meeting',
          startTime: '2026-10-16T17:00:00.000Z',
          endTime: '2026-10-16T18:00:00.000Z',
          attendeeUserIds: [member1Id, member1Id, member2Id, member1Id],
        })
        .expect(201);

      expect(res.body.data.attendees).toHaveLength(2);
      const userIds = res.body.data.attendees.map((a: any) => a.userId);
      expect(userIds).toContain(member1Id);
      expect(userIds).toContain(member2Id);
    });
  });

  describe('3. Multi-Tenant Security & Isolation Validation', () => {
    it('should REJECT scheduling with a nonexistent user ID (400 INVALID_ATTENDEE)', async () => {
      const nonExistentUuid = randomUUID();

      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Bogus User Meeting',
          startTime: '2026-10-17T10:00:00.000Z',
          endTime: '2026-10-17T11:00:00.000Z',
          attendeeUserIds: [nonExistentUuid],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_ATTENDEE');
      expect(res.body.error.message).toContain('not active members of this organization');
    });

    it('should REJECT scheduling with an attendee belonging to another organization (Org B user in Org A meeting)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Cross-Tenant Attack Meeting',
          startTime: '2026-10-17T11:00:00.000Z',
          endTime: '2026-10-17T12:00:00.000Z',
          attendeeUserIds: [orgBOwnerId], // Belongs strictly to Org B!
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_ATTENDEE');
      expect(res.body.error.message).toContain('not active members of this organization');
    });

    it('should REJECT scheduling when mixing valid Org A attendee with cross-tenant Org B attendee', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Mixed Attack Meeting',
          startTime: '2026-10-17T13:00:00.000Z',
          endTime: '2026-10-17T14:00:00.000Z',
          attendeeUserIds: [member1Id, orgBOwnerId],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_ATTENDEE');
      expect(res.body.error.message).toContain('not active members of this organization');
    });

    it('should REJECT attendee who was removed from the organization', async () => {
      // Create a temporary user and remove membership
      const removedEmail = `meet.removed.${Date.now()}@example.com`;
      const regRemoved = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Removed User',
          email: removedEmail,
          password: 'Password123!',
          organizationName: 'Temp Org Rem',
        })
        .expect(201);
      const removedUserId = regRemoved.body.data.user.id;
      // Completely remove their organization memberships
      await prisma.organizationMember.deleteMany({ where: { userId: removedUserId } });
      await prisma.organization.deleteMany({ where: { ownerId: removedUserId } });

      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Meeting with Removed User',
          startTime: '2026-10-17T15:00:00.000Z',
          endTime: '2026-10-17T16:00:00.000Z',
          attendeeUserIds: [removedUserId],
        })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_ATTENDEE');
      expect(res.body.error.message).toContain('not active members of this organization');

      // Cleanup
      await prisma.user.delete({ where: { id: removedUserId } });
    });
  });

  describe('4. Google Calendar / Meet Attendees Pass-Through', () => {
    it('should pass only the selected attendee email addresses to Google Calendar event creation', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Google Synced Meeting With Selected Attendees',
          startTime: '2026-10-18T10:00:00.000Z',
          endTime: '2026-10-18T11:00:00.000Z',
          attendeeUserIds: [member1Id, member2Id],
          syncWithGoogle: true,
          createGoogleMeet: true,
        })
        .expect(201);

      expect(res.body.data.isMeetEnabled).toBe(true);
      expect(res.body.data.googleMeetLink).toBe('https://meet.google.com/xyz-uvwx-rst');

      // Verify Google Calendar payload
      expect(lastGoogleApiRequestBody).not.toBeNull();
      expect(lastGoogleApiRequestBody.summary).toBe('Google Synced Meeting With Selected Attendees');
      expect(lastGoogleApiRequestBody.attendees).toBeDefined();
      expect(lastGoogleApiRequestBody.attendees).toHaveLength(2);

      const passedEmails = lastGoogleApiRequestBody.attendees.map((a: any) => a.email);
      expect(passedEmails).toContain(member1Email);
      expect(passedEmails).toContain(member2Email);
      // Non-selected members must NOT be included
      expect(passedEmails).not.toContain(viewerEmail);
      expect(passedEmails).not.toContain(orgBOwnerEmail);
    });

    it('should pass no attendees to Google Calendar when attendeeUserIds is empty', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Google Synced Solo Meeting',
          startTime: '2026-10-18T12:00:00.000Z',
          endTime: '2026-10-18T13:00:00.000Z',
          attendeeUserIds: [],
          syncWithGoogle: true,
          createGoogleMeet: true,
        })
        .expect(201);

      expect(res.body.data.isMeetEnabled).toBe(true);
      expect(lastGoogleApiRequestBody.attendees).toBeUndefined();
    });
  });

  describe('5. Meeting Details & Attendees Updates', () => {
    it('should retrieve meeting with populated attendee details', async () => {
      const createRes = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Inspection Meeting',
          startTime: '2026-10-19T09:00:00.000Z',
          endTime: '2026-10-19T10:00:00.000Z',
          attendeeUserIds: [member1Id],
        })
        .expect(201);

      const meetingId = createRes.body.data.id;

      const getRes = await request(app)
        .get(`/api/v1/organizations/${orgAId}/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${member2Token}`)
        .expect(200);

      expect(getRes.body.data.id).toBe(meetingId);
      expect(getRes.body.data.attendees).toHaveLength(1);
      expect(getRes.body.data.attendees[0].user.name).toBe('Member One');
      expect(getRes.body.data.attendees[0].user.email).toBe(member1Email);
    });

    it('should update meeting attendees correctly and replace the attendee list', async () => {
      const createRes = await request(app)
        .post(`/api/v1/organizations/${orgAId}/meetings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Meeting To Update',
          startTime: '2026-10-19T11:00:00.000Z',
          endTime: '2026-10-19T12:00:00.000Z',
          attendeeUserIds: [member1Id],
        })
        .expect(201);

      const meetingId = createRes.body.data.id;
      expect(createRes.body.data.attendees).toHaveLength(1);

      // Update to replace member 1 with member 2 and viewer
      const updateRes = await request(app)
        .patch(`/api/v1/organizations/${orgAId}/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          attendeeUserIds: [member2Id, viewerId],
        })
        .expect(200);

      expect(updateRes.body.data.attendees).toHaveLength(2);
      const updatedUserIds = updateRes.body.data.attendees.map((a: any) => a.userId);
      expect(updatedUserIds).toContain(member2Id);
      expect(updatedUserIds).toContain(viewerId);
      expect(updatedUserIds).not.toContain(member1Id);
    });
  });
});
