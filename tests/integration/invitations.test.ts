import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken, hashToken } from '../../src/utils/jwt.js';

describe('Organization Member Invitations Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let existingCandidate: { id: string; email: string; token: string };
  let otherOwnerUser: { id: string; email: string; token: string };

  let orgId: string;
  let otherOrgId: string;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    // 1. Create test users
    const [uOwner, uMember, uViewer, uCandidate, uOtherOwner] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Org Owner',
          email: `owner.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
          isEmailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org Member',
          email: `member.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
          isEmailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Org Viewer',
          email: `viewer.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
          isEmailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Existing Candidate',
          email: `candidate.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
          isEmailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Other Org Owner',
          email: `other.owner.${Date.now()}.${randomUUID().slice(0, 6)}@example.com`,
          passwordHash: 'dummy-hash',
          isEmailVerified: true,
        },
      }),
    ]);

    createdUserIds.push(uOwner.id, uMember.id, uViewer.id, uCandidate.id, uOtherOwner.id);

    ownerUser = { id: uOwner.id, email: uOwner.email, token: generateAccessToken({ userId: uOwner.id, email: uOwner.email }) };
    memberUser = { id: uMember.id, email: uMember.email, token: generateAccessToken({ userId: uMember.id, email: uMember.email }) };
    viewerUser = { id: uViewer.id, email: uViewer.email, token: generateAccessToken({ userId: uViewer.id, email: uViewer.email }) };
    existingCandidate = { id: uCandidate.id, email: uCandidate.email, token: generateAccessToken({ userId: uCandidate.id, email: uCandidate.email }) };
    otherOwnerUser = { id: uOtherOwner.id, email: uOtherOwner.email, token: generateAccessToken({ userId: uOtherOwner.id, email: uOtherOwner.email }) };

    // 2. Create primary organization
    const org = await prisma.organization.create({
      data: {
        name: 'Invitation Test Org',
        slug: `inv-org-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    orgId = org.id;
    createdOrgIds.push(org.id);

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: orgId, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: orgId, userId: viewerUser.id, role: 'VIEWER' },
      ],
    });

    // 3. Create second organization with distinct owner for tenant boundary checks
    const otherOrg = await prisma.organization.create({
      data: {
        name: 'Other Tenant Org',
        slug: `other-org-${randomUUID()}`,
        ownerId: otherOwnerUser.id,
      },
    });
    otherOrgId = otherOrg.id;
    createdOrgIds.push(otherOrg.id);

    await prisma.organizationMember.create({
      data: { organizationId: otherOrgId, userId: otherOwnerUser.id, role: 'OWNER' },
    });
  });

  afterAll(async () => {
    // Cleanup invitations, memberships, orgs, users
    if (createdOrgIds.length > 0) {
      await prisma.organizationInvitation.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.refreshSession.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.organizationMember.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await disconnectDatabase();
  });

  describe('1. Member Invitation Permissions & Flows', () => {
    it('should create a pending invitation when OWNER invites an existing user without forcing membership (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: existingCandidate.email,
          role: 'ADMIN',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isPending).toBe(true);
      expect(res.body.data.role).toBe('ADMIN');
      expect(res.body.data.userId).toBe(existingCandidate.id);

      // Verify membership was NOT created automatically (no forced membership)
      const memberInDb = await prisma.organizationMember.findUnique({
        where: {
          userId: existingCandidate.id,
        },
      });
      expect(memberInDb).toBeNull();

      // Verify invitation was created in PENDING status
      const inviteInDb = await prisma.organizationInvitation.findFirst({
        where: {
          organizationId: orgId,
          email: existingCandidate.email,
        },
      });
      expect(inviteInDb).not.toBeNull();
      expect(inviteInDb?.status).toBe('PENDING');
    });

    it('should require an authenticated session to accept invitation for an existing user (401)', async () => {
      const rawToken = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: existingCandidate.email,
          role: 'ADMIN',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: rawToken,
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject a mismatched authenticated user from accepting an existing user invitation (403)', async () => {
      const rawToken = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: existingCandidate.email,
          role: 'ADMIN',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .set('Authorization', `Bearer ${memberUser.token}`) // different user
        .send({
          token: rawToken,
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVITATION_RECIPIENT_MISMATCH');
    });

    it('should allow the matching authenticated user to accept their invitation (200)', async () => {
      const rawToken = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: existingCandidate.email,
          role: 'ADMIN',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .set('Authorization', `Bearer ${existingCandidate.token}`)
        .send({
          token: rawToken,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(existingCandidate.id);
      expect(res.body.data.organization.id).toBe(orgId);

      // Verify membership was now created
      const memberInDb = await prisma.organizationMember.findUnique({
        where: {
          userId: existingCandidate.id,
        },
      });
      expect(memberInDb).not.toBeNull();
      expect(memberInDb?.role).toBe('ADMIN');
    });

    it('should reject inviting someone who is already a member (409 Conflict)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: existingCandidate.email,
          role: 'MEMBER',
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
    });

    it('should forbid regular MEMBER from inviting teammates (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          email: `new.member.${Date.now()}@example.com`,
          role: 'VIEWER',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should forbid VIEWER from inviting teammates (403 Insufficient Permissions)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .send({
          email: `new.viewer.${Date.now()}@example.com`,
          role: 'VIEWER',
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('2. Non-Existing User Invitation & Token Lifecycle', () => {
    const nonExistentEmail = `fresh.invitee.${Date.now()}@example.com`;

    it('should successfully invite a non-existent user and create a pending invitation (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: nonExistentEmail,
          role: 'MEMBER',
          name: 'Fresh Invitee',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isPending).toBe(true);
      expect(res.body.data.role).toBe('MEMBER');
      expect(res.body.data.user.email).toBe(nonExistentEmail);

      // Verify row in database
      const invitation = await prisma.organizationInvitation.findFirst({
        where: {
          organizationId: orgId,
          email: nonExistentEmail,
        },
      });

      expect(invitation).not.toBeNull();
      expect(invitation?.status).toBe('PENDING');
      expect(invitation?.tokenHash).toBeDefined();
      expect(invitation?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should handle duplicate invite to the same email idempotently by refreshing the token (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          email: nonExistentEmail,
          role: 'ADMIN',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isPending).toBe(true);
      expect(res.body.data.role).toBe('ADMIN');

      // Verify only one pending invitation exists, updated to ADMIN
      const invitations = await prisma.organizationInvitation.findMany({
        where: {
          organizationId: orgId,
          email: nonExistentEmail,
          status: 'PENDING',
        },
      });
      expect(invitations.length).toBe(1);
      expect(invitations[0].role).toBe('ADMIN');
    });
  });

  describe('3. Invitation Acceptance & Account Creation', () => {
    let testRawToken: string;
    let testEmail: string;

    beforeEach(async () => {
      testRawToken = randomBytes(32).toString('hex');
      testEmail = `accept.test.${Date.now()}.${randomUUID()}@example.com`;

      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: testEmail,
          role: 'MEMBER',
          tokenHash: hashToken(testRawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });
    });

    it('should retrieve invitation details by public token (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/auth/invitations/${testRawToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testEmail);
      expect(res.body.data.organizationName).toBe('Invitation Test Org');
      expect(res.body.data.role).toBe('MEMBER');
      expect(res.body.data.tokenHash).toBeUndefined();
    });

    it('should accept invitation, create user, hash password, and issue JWT tokens (200)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: testRawToken,
          name: 'Accepted User',
          password: 'SecurePassword123!',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe(testEmail);
      expect(res.body.data.user.name).toBe('Accepted User');
      expect(res.body.data.organization.id).toBe(orgId);

      const createdUser = await prisma.user.findUnique({ where: { email: testEmail } });
      expect(createdUser).not.toBeNull();
      createdUserIds.push(createdUser!.id);

      // Verify membership exists
      const membership = await prisma.organizationMember.findUnique({
        where: {
          userId: createdUser!.id,
        },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe('MEMBER');

      // Verify invitation is marked ACCEPTED
      const updatedInvite = await prisma.organizationInvitation.findFirst({
        where: { email: testEmail },
      });
      expect(updatedInvite?.status).toBe('ACCEPTED');
      expect(updatedInvite?.acceptedAt).not.toBeNull();
    });

    it('should reject reusing an already-accepted token (400 Bad Request)', async () => {
      // First accept
      await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: testRawToken,
          name: 'Accepted User',
          password: 'SecurePassword123!',
        })
        .expect(200);

      // Second attempt with same token
      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: testRawToken,
          name: 'Accepted User Replay',
          password: 'SecurePassword123!',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVITATION_ALREADY_ACCEPTED');
    });

    it('should reject an expired token (400 Bad Request)', async () => {
      const expiredRawToken = randomBytes(32).toString('hex');
      const expiredEmail = `expired.${Date.now()}@example.com`;

      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: expiredEmail,
          role: 'MEMBER',
          tokenHash: hashToken(expiredRawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() - 1000), // Expired in past
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .get(`/api/v1/auth/invitations/${expiredRawToken}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    });

    it('should reject an invalid non-existent token (404 Not Found)', async () => {
      const res = await request(app)
        .get(`/api/v1/auth/invitations/${randomBytes(32).toString('hex')}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVITATION_NOT_FOUND');
    });
  });

  describe('4. Single-Organization Invariant, Invalidation & Concurrency Tests', () => {
    it('Scenario 1: User with no organization accepts invitation A successfully', async () => {
      const email = `single.org.s1.${Date.now()}@example.com`;
      const rawToken = randomBytes(32).toString('hex');

      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email,
          role: 'MEMBER',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: rawToken,
          name: 'Scenario 1 User',
          password: 'ValidPassword123!',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.id).toBe(orgId);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      createdUserIds.push(user!.id);

      const membership = await prisma.organizationMember.findUnique({
        where: { userId: user!.id },
      });
      expect(membership?.organizationId).toBe(orgId);
    });

    it('Scenario 2 & 3: User has pending invitations from A and B and accepts A; B becomes INVALIDATED', async () => {
      const email = `dual.invite.${Date.now()}@example.com`;
      const tokenA = randomBytes(32).toString('hex');
      const tokenB = randomBytes(32).toString('hex');

      // Invitation from Org A
      const invA = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email,
          role: 'ADMIN',
          tokenHash: hashToken(tokenA),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Invitation from Org B
      const invB = await prisma.organizationInvitation.create({
        data: {
          organizationId: otherOrgId,
          email,
          role: 'MEMBER',
          tokenHash: hashToken(tokenB),
          invitedById: otherOwnerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Also create an invitation for an UNRELATED user to ensure unrelated invites are NOT touched
      const unrelatedEmail = `unrelated.${Date.now()}@example.com`;
      const unrelatedToken = randomBytes(32).toString('hex');
      const invUnrelated = await prisma.organizationInvitation.create({
        data: {
          organizationId: otherOrgId,
          email: unrelatedEmail,
          role: 'MEMBER',
          tokenHash: hashToken(unrelatedToken),
          invitedById: otherOwnerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // User accepts Org A's invitation
      const res = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: tokenA,
          name: 'Accepted Org A Teammate',
          password: 'PasswordA123!',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      createdUserIds.push(user!.id);

      // Verify Org A invitation is ACCEPTED
      const updatedInvA = await prisma.organizationInvitation.findUnique({ where: { id: invA.id } });
      expect(updatedInvA?.status).toBe('ACCEPTED');

      // Verify Org B invitation is atomically INVALIDATED!
      const updatedInvB = await prisma.organizationInvitation.findUnique({ where: { id: invB.id } });
      expect(updatedInvB?.status).toBe('INVALIDATED');

      // Verify UNRELATED invitation remains PENDING!
      const checkUnrelated = await prisma.organizationInvitation.findUnique({ where: { id: invUnrelated.id } });
      expect(checkUnrelated?.status).toBe('PENDING');

      // Verify attempting to accept the invalidated Org B invitation is REJECTED
      const rejectRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: tokenB,
          name: 'Trying Org B',
          password: 'PasswordB123!',
        })
        .expect(400);

      expect(rejectRes.body.success).toBe(false);
      expect(rejectRes.body.error.code).toBe('INVITATION_INVALIDATED');

      // Also verify public lookup of invalidated invitation returns 400 INVITATION_INVALIDATED
      const lookupRes = await request(app)
        .get(`/api/v1/auth/invitations/${tokenB}`)
        .expect(400);

      expect(lookupRes.body.error.code).toBe('INVITATION_INVALIDATED');
    });

    it('Scenario 4: User already belongs to Org A and Org B attempts to invite them (409 Conflict)', async () => {
      // existingCandidate already belongs to orgId from test 1
      const res = await request(app)
        .post(`/api/v1/organizations/${otherOrgId}/members`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .send({
          email: existingCandidate.email,
          role: 'MEMBER',
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('USER_ALREADY_IN_ORGANIZATION');
      expect(res.body.error.message).toBe('This user already belongs to an organization.');

      // Zero-knowledge privacy check: must NOT leak orgId, org name, or slug
      const bodyString = JSON.stringify(res.body);
      expect(bodyString).not.toContain(orgId);
      expect(bodyString).not.toContain('Invitation Test Org');
      expect(bodyString).not.toContain('inv-org-');
    });

    it('Scenario 5: User already belongs to Org A and attempts to accept Org B old invitation', async () => {
      // Create a pending invitation in Org B for existingCandidate directly
      const oldTokenB = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: otherOrgId,
          email: existingCandidate.email,
          role: 'MEMBER',
          tokenHash: hashToken(oldTokenB),
          invitedById: otherOwnerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Public lookup rejects because user already in another org
      const lookupRes = await request(app)
        .get(`/api/v1/auth/invitations/${oldTokenB}`)
        .expect(400);

      expect(lookupRes.body.success).toBe(false);
      expect(lookupRes.body.error.code).toBe('USER_ALREADY_IN_ORGANIZATION');

      // Acceptance rejects with 409 USER_ALREADY_IN_ORGANIZATION
      const acceptRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: oldTokenB,
        })
        .expect(409);

      expect(acceptRes.body.success).toBe(false);
      expect(acceptRes.body.error.code).toBe('USER_ALREADY_IN_ORGANIZATION');

      // Must NOT leak org details
      expect(JSON.stringify(acceptRes.body)).not.toContain('Invitation Test Org');
    });

    it('Scenario 6: Two organizations attempt concurrent acceptance race condition', async () => {
      const email = `concurrent.race.${Date.now()}.${randomUUID().slice(0, 4)}@example.com`;
      const tokenA = randomBytes(32).toString('hex');
      const tokenB = randomBytes(32).toString('hex');

      await prisma.organizationInvitation.createMany({
        data: [
          {
            organizationId: orgId,
            email,
            role: 'MEMBER',
            tokenHash: hashToken(tokenA),
            invitedById: ownerUser.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: 'PENDING',
          },
          {
            organizationId: otherOrgId,
            email,
            role: 'MEMBER',
            tokenHash: hashToken(tokenB),
            invitedById: otherOwnerUser.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: 'PENDING',
          },
        ],
      });

      // Fire concurrent acceptance requests
      const [resA, resB] = await Promise.all([
        request(app).post('/api/v1/auth/invitations/accept').send({
          token: tokenA,
          name: 'Concurrent Winner A',
          password: 'PasswordRace123!',
        }),
        request(app).post('/api/v1/auth/invitations/accept').send({
          token: tokenB,
          name: 'Concurrent Winner B',
          password: 'PasswordRace123!',
        }),
      ]);

      const successCount = [resA, resB].filter((r) => r.status === 200).length;
      const failureCount = [resA, resB].filter((r) => r.status === 400 || r.status === 409).length;

      // Exactly ONE request succeeds, and the other is rejected
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify the failing response returned appropriate business error
      const failedRes = resA.status !== 200 ? resA : resB;
      expect(['USER_ALREADY_IN_ORGANIZATION', 'INVITATION_INVALIDATED']).toContain(
        failedRes.body.error.code,
      );

      // Database-level verification: User must have EXACTLY ONE membership in the entire database!
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      createdUserIds.push(user!.id);

      const memberships = await prisma.organizationMember.findMany({
        where: { userId: user!.id },
      });
      expect(memberships.length).toBe(1);
    });

    it('Scenario 7: Database UNIQUE constraint prevents duplicate membership creation directly', async () => {
      // memberUser already belongs to orgId
      await expect(
        prisma.organizationMember.create({
          data: {
            organizationId: otherOrgId,
            userId: memberUser.id,
            role: 'MEMBER',
          },
        }),
      ).rejects.toThrow();
    });

    it('Scenario 8: Unauthorized organization cannot manipulate another organization members or invitations', async () => {
      // otherOwnerUser (not a member of orgId) tries to list orgId members
      const listRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .expect(403);

      expect(listRes.body.success).toBe(false);
      expect(listRes.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');

      // otherOwnerUser tries to add a member to orgId
      const addRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .send({
          email: `attacker.${Date.now()}@example.com`,
          role: 'MEMBER',
        })
        .expect(403);

      expect(addRes.body.success).toBe(false);
      expect(addRes.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');
    });

    it('Scenario 9: Token remains single-use after acceptance', async () => {
      const email = `single.use.${Date.now()}@example.com`;
      const token = randomBytes(32).toString('hex');

      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email,
          role: 'VIEWER',
          tokenHash: hashToken(token),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // First use: 200 OK
      await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({ token, name: 'Single Use User', password: 'Password123!' })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { email } });
      if (user) createdUserIds.push(user.id);

      // Re-use attempt: 400 INVITATION_ALREADY_ACCEPTED
      const reuseRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({ token, name: 'Replay User', password: 'Password123!' })
        .expect(400);

      expect(reuseRes.body.success).toBe(false);
      expect(reuseRes.body.error.code).toBe('INVITATION_ALREADY_ACCEPTED');
    });

    it('Scenario 10: Expired and invalidated invitations cannot be accepted', async () => {
      // 1. Manually invalidated invite
      const invalidatedToken = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: `invalidated.${Date.now()}@example.com`,
          role: 'MEMBER',
          tokenHash: hashToken(invalidatedToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'INVALIDATED',
        },
      });

      const invRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({ token: invalidatedToken, name: 'Invalidated', password: 'Password123!' })
        .expect(400);

      expect(invRes.body.error.code).toBe('INVITATION_INVALIDATED');

      // 2. Expired invite
      const expToken = randomBytes(32).toString('hex');
      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: `exp.${Date.now()}@example.com`,
          role: 'MEMBER',
          tokenHash: hashToken(expToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() - 5000),
          status: 'PENDING',
        },
      });

      const expRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({ token: expToken, name: 'Expired', password: 'Password123!' })
        .expect(400);

      expect(expRes.body.error.code).toBe('INVITATION_EXPIRED');
    });
  });

  describe('5. Pending Separation, Invitation Management & Tenant Isolation', () => {
    it('pending invitation is NOT an active member in GET /members, but appears in GET /invitations', async () => {
      const pendingEmail = `pending.only.${Date.now()}@example.com`;
      const rawToken = randomBytes(32).toString('hex');

      const inv = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: pendingEmail,
          role: 'MEMBER',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // 1. GET /members should NOT contain pendingEmail
      const membersRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(membersRes.body.success).toBe(true);
      const foundInMembers = membersRes.body.data.some(
        (m: any) => m.user?.email === pendingEmail,
      );
      expect(foundInMembers).toBe(false);

      // 2. GET /invitations should contain the pending invitation
      const invRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(invRes.body.success).toBe(true);
      const foundInInvites = invRes.body.data.some(
        (i: any) => i.id === inv.id && i.email === pendingEmail,
      );
      expect(foundInInvites).toBe(true);
    });

    it('accepted invitation becomes an active member and leaves pending invitations', async () => {
      const acceptEmail = `accept.lifecycle.${Date.now()}@example.com`;
      const rawToken = randomBytes(32).toString('hex');

      const inv = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: acceptEmail,
          role: 'MEMBER',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Accept invitation
      const acceptRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: rawToken,
          name: 'Accepted Member',
          password: 'Password123!',
        })
        .expect(200);

      expect(acceptRes.body.success).toBe(true);
      const newUserId = acceptRes.body.data.user.id;
      createdUserIds.push(newUserId);

      // Now GET /members should contain the new user
      const membersRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      const foundMember = membersRes.body.data.find(
        (m: any) => m.user?.email === acceptEmail,
      );
      expect(foundMember).toBeDefined();
      expect(foundMember.userId).toBe(newUserId);

      // And GET /invitations should no longer contain this accepted invite
      const invRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/invitations`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      const stillInInvites = invRes.body.data.some((i: any) => i.id === inv.id);
      expect(stillInInvites).toBe(false);
    });

    it('revoked invitation is NOT deleted, has status REVOKED, and cannot be accepted', async () => {
      const revokeEmail = `revoke.lifecycle.${Date.now()}@example.com`;
      const rawToken = randomBytes(32).toString('hex');

      const inv = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: revokeEmail,
          role: 'MEMBER',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Revoke invitation via DELETE endpoint
      const delRes = await request(app)
        .delete(`/api/v1/organizations/${orgId}/invitations/${inv.id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(delRes.body.success).toBe(true);
      expect(delRes.body.data.status).toBe('REVOKED');

      // Verify row is NOT deleted from DB, but marked REVOKED
      const dbInv = await prisma.organizationInvitation.findUnique({
        where: { id: inv.id },
      });
      expect(dbInv).not.toBeNull();
      expect(dbInv?.status).toBe('REVOKED');

      // Attempt to accept revoked invitation -> 400 INVITATION_INVALID
      const acceptRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: rawToken,
          name: 'Revoked User',
          password: 'Password123!',
        })
        .expect(400);

      expect(acceptRes.body.success).toBe(false);
      expect(acceptRes.body.error.code).toBe('INVITATION_INVALID');
    });

    it('resend invalidates the old token and issues a new valid token', async () => {
      const resendEmail = `resend.lifecycle.${Date.now()}@example.com`;
      const oldRawToken = randomBytes(32).toString('hex');
      const oldTokenHash = hashToken(oldRawToken);

      const inv = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: resendEmail,
          role: 'ADMIN',
          tokenHash: oldTokenHash,
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Call resend endpoint
      const resendRes = await request(app)
        .post(`/api/v1/organizations/${orgId}/invitations/${inv.id}/resend`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(resendRes.body.success).toBe(true);
      expect(resendRes.body.data.id).toBe(inv.id);

      // Verify tokenHash changed in DB
      const updatedInv = await prisma.organizationInvitation.findUnique({
        where: { id: inv.id },
      });
      expect(updatedInv?.tokenHash).not.toBe(oldTokenHash);

      // Attempt to accept using old token -> 404 INVITATION_NOT_FOUND (tokenHash no longer matches)
      const failAccept = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: oldRawToken,
          name: 'Old Token User',
          password: 'Password123!',
        })
        .expect(404);

      expect(failAccept.body.success).toBe(false);
      expect(failAccept.body.error.code).toBe('INVITATION_NOT_FOUND');
    });

    it('Organization A invitation CANNOT create Organization B membership even if requested', async () => {
      const orgAEmail = `orgA.exclusive.${Date.now()}@example.com`;
      const rawToken = randomBytes(32).toString('hex');

      await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId, // Organization A
          email: orgAEmail,
          role: 'MEMBER',
          tokenHash: hashToken(rawToken),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // Malicious client sends organizationId of Organization B
      const acceptRes = await request(app)
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: rawToken,
          name: 'Org A User',
          password: 'Password123!',
          organizationId: otherOrgId, // Attempt to spoof destination org
        })
        .expect(200);

      const userId = acceptRes.body.data.user.id;
      createdUserIds.push(userId);

      // Verify user has membership ONLY in orgId (Org A)
      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
      });

      expect(memberships.length).toBe(1);
      expect(memberships[0].organizationId).toBe(orgId);
      expect(memberships[0].organizationId).not.toBe(otherOrgId);
    });

    it('cross-organization invitation management is rejected', async () => {
      // Create invitation in Org A
      const inviteOrgA = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: `cross.org.${Date.now()}@example.com`,
          role: 'MEMBER',
          tokenHash: hashToken(randomBytes(32).toString('hex')),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // 1. otherOwnerUser tries to list Org A invitations -> 403 NOT_AN_ORGANIZATION_MEMBER
      const listRes = await request(app)
        .get(`/api/v1/organizations/${orgId}/invitations`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .expect(403);
      expect(listRes.body.error.code).toBe('NOT_AN_ORGANIZATION_MEMBER');

      // 2. otherOwnerUser tries to resend Org A invite under otherOrgId -> 404 INVITATION_NOT_FOUND
      const resendRes = await request(app)
        .post(`/api/v1/organizations/${otherOrgId}/invitations/${inviteOrgA.id}/resend`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .expect(404);
      expect(resendRes.body.error.code).toBe('INVITATION_NOT_FOUND');

      // 3. otherOwnerUser tries to revoke Org A invite under otherOrgId -> 404 INVITATION_NOT_FOUND
      const revokeRes = await request(app)
        .delete(`/api/v1/organizations/${otherOrgId}/invitations/${inviteOrgA.id}`)
        .set('Authorization', `Bearer ${otherOwnerUser.token}`)
        .expect(404);
      expect(revokeRes.body.error.code).toBe('INVITATION_NOT_FOUND');
    });

    it('MEMBER and VIEWER roles cannot list, resend, or revoke invitations (403)', async () => {
      const dummyInvite = await prisma.organizationInvitation.create({
        data: {
          organizationId: orgId,
          email: `rbac.invite.${Date.now()}@example.com`,
          role: 'MEMBER',
          tokenHash: hashToken(randomBytes(32).toString('hex')),
          invitedById: ownerUser.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });

      // MEMBER cannot list invitations
      const memberList = await request(app)
        .get(`/api/v1/organizations/${orgId}/invitations`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(403);
      expect(memberList.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      // VIEWER cannot list invitations
      const viewerList = await request(app)
        .get(`/api/v1/organizations/${orgId}/invitations`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(403);
      expect(viewerList.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      // MEMBER cannot resend invitation
      const memberResend = await request(app)
        .post(`/api/v1/organizations/${orgId}/invitations/${dummyInvite.id}/resend`)
        .set('Authorization', `Bearer ${memberUser.token}`)
        .expect(403);
      expect(memberResend.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      // VIEWER cannot revoke invitation
      const viewerRevoke = await request(app)
        .delete(`/api/v1/organizations/${orgId}/invitations/${dummyInvite.id}`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(403);
      expect(viewerRevoke.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });
});
