import http from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { app } from '../../src/app.js';
import { initSocketServer, closeSocketServer } from '../../src/config/socket.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { tokenRevocationBloom } from '../../src/utils/bloom.js';

describe('Realtime Socket.IO Integration Tests', () => {
  let httpServer: http.Server;
  let port: number;

  let ownerUser: { id: string; email: string; token: string };
  let memberUser: { id: string; email: string; token: string };
  let outsideUser: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;
  let task1Id: string;
  let task2Id: string;

  const createdUserIds: string[] = [];
  const openSockets: ClientSocket[] = [];

  function createClient(token?: string): ClientSocket {
    const client = ioc(`http://localhost:${port}`, {
      auth: token ? { token } : undefined,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    openSockets.push(client);
    return client;
  }

  beforeAll(async () => {
    // 1. Create test users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'RT Owner',
          email: `rt.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'RT Member',
          email: `rt.member.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'RT Outside',
          email: `rt.outside.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    users.forEach((u) => createdUserIds.push(u.id));

    ownerUser = {
      id: users[0].id,
      email: users[0].email,
      token: generateAccessToken({ userId: users[0].id, email: users[0].email }),
    };

    memberUser = {
      id: users[1].id,
      email: users[1].email,
      token: generateAccessToken({ userId: users[1].id, email: users[1].email }),
    };

    outsideUser = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };

    // 2. Create organizations
    const org1 = await prisma.organization.create({
      data: {
        name: 'RT Org 1',
        slug: `rt-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'RT Org 2',
        slug: `rt-org-2-${randomUUID()}`,
        ownerId: outsideUser.id,
      },
    });
    org2Id = org2.id;

    // 3. Organization memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: memberUser.id, role: 'MEMBER' },
        { organizationId: org2Id, userId: outsideUser.id, role: 'OWNER' },
      ],
    });

    // 4. Projects
    const p1 = await prisma.project.create({
      data: {
        organizationId: org1Id,
        name: 'RT Project 1',
        key: `RTP1${Date.now().toString().slice(-4)}`,
        createdById: ownerUser.id,
      },
    });
    project1Id = p1.id;

    const p2 = await prisma.project.create({
      data: {
        organizationId: org2Id,
        name: 'RT Project 2',
        key: `RTP2${Date.now().toString().slice(-4)}`,
        createdById: outsideUser.id,
      },
    });
    project2Id = p2.id;

    // 5. Tasks
    const t1 = await prisma.task.create({
      data: {
        projectId: project1Id,
        title: 'Initial Task 1',
        createdById: ownerUser.id,
      },
    });
    task1Id = t1.id;

    const t2 = await prisma.task.create({
      data: {
        projectId: project2Id,
        title: 'Initial Task 2 (Org 2)',
        createdById: outsideUser.id,
      },
    });
    task2Id = t2.id;

    // 6. Start HTTP + Socket.IO server on ephemeral port
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close client sockets
    for (const s of openSockets) {
      try {
        s.disconnect();
        s.close();
      } catch {}
    }

    await closeSocketServer();

    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    // Teardown database
    if (org1Id || org2Id) {
      await prisma.comment.deleteMany({
        where: { taskId: { in: [task1Id, task2Id].filter(Boolean) } },
      });
      await prisma.taskAssignee.deleteMany({
        where: { taskId: { in: [task1Id, task2Id].filter(Boolean) } },
      });
      await prisma.task.deleteMany({
        where: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [org1Id, org2Id].filter(Boolean) } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await disconnectDatabase();
    await disconnectRedis();
  });

  afterEach(() => {
    while (openSockets.length > 0) {
      const s = openSockets.pop();
      try {
        s?.removeAllListeners();
        s?.disconnect();
        s?.close();
      } catch {
        // ignore
      }
    }
  });

  // ─── 1. Socket Authentication ───────────────────────────────────────────────
  describe('Socket Authentication', () => {
    it('should connect successfully with valid access token', async () => {
      const client = createClient(memberUser.token);

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          expect(client.connected).toBe(true);
          resolve();
        });
        client.on('connect_error', (err) => {
          reject(err);
        });
      });
    });

    it('should reject connection when no token is provided', async () => {
      const client = createClient();

      await new Promise<void>((resolve) => {
        client.on('connect_error', (err) => {
          expect(err.message).toBe('AUTHENTICATION_REQUIRED');
          resolve();
        });
      });
    });

    it('should reject connection with invalid token', async () => {
      const client = createClient('invalid-token-string');

      await new Promise<void>((resolve) => {
        client.on('connect_error', (err) => {
          expect(err.message).toBe('INVALID_ACCESS_TOKEN');
          resolve();
        });
      });
    });

    it('should reject connection with revoked token', async () => {
      const jti = randomUUID();
      const revokedToken = generateAccessToken({
        userId: memberUser.id,
        email: memberUser.email,
        jti,
      });

      tokenRevocationBloom.revoke(jti);

      const client = createClient(revokedToken);

      await new Promise<void>((resolve) => {
        client.on('connect_error', (err) => {
          expect(err.message).toBe('TOKEN_REVOKED');
          resolve();
        });
      });
    });
  });

  // ─── 2. Room Authorization & Cross-Tenant Isolation ─────────────────────────
  describe('Room Authorization & Cross-Tenant Isolation', () => {
    it('should allow organization member to join project room', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; room?: string }>((resolve) => {
        client.emit(
          'join_project',
          { organizationId: org1Id, projectId: project1Id },
          (ack: { success: boolean; room?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(true);
      expect(response.room).toBe(`org:${org1Id}:project:${project1Id}`);
    });

    it('should reject non-member joining an organization project room', async () => {
      const client = createClient(outsideUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit(
          'join_project',
          { organizationId: org1Id, projectId: project1Id },
          (ack: { success: boolean; error?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('FORBIDDEN_NOT_MEMBER');
    });

    it('should reject joining project that belongs to another organization', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit(
          'join_project',
          { organizationId: org1Id, projectId: project2Id },
          (ack: { success: boolean; error?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('PROJECT_NOT_FOUND');
    });

    it('should allow member to join task room in their organization', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; room?: string }>((resolve) => {
        client.emit(
          'join_task',
          { organizationId: org1Id, taskId: task1Id },
          (ack: { success: boolean; room?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(true);
      expect(response.room).toBe(`org:${org1Id}:task:${task1Id}`);
    });

    it('should reject non-member joining task room', async () => {
      const client = createClient(outsideUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit(
          'join_task',
          { organizationId: org1Id, taskId: task1Id },
          (ack: { success: boolean; error?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('FORBIDDEN_NOT_MEMBER');
    });

    it('should reject joining task belonging to another organization', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit(
          'join_task',
          { organizationId: org1Id, taskId: task2Id },
          (ack: { success: boolean; error?: string }) => resolve(ack),
        );
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('TASK_NOT_FOUND');
    });
  });

  // ─── 3. Task Events ────────────────────────────────────────────────────────
  describe('Task Events', () => {
    it('should emit task.created to project room after successful REST write', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_project', { organizationId: org1Id, projectId: project1Id }, () =>
          resolve(),
        );
      });

      const eventPromise = new Promise<{ title: string; projectId: string }>((resolve) => {
        client.on('task.created', (data: { title: string; projectId: string }) => resolve(data));
      });

      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: 'Realtime Created Task',
          status: 'TODO',
          priority: 'HIGH',
        });

      expect(res.status).toBe(201);

      const eventData = await eventPromise;
      expect(eventData.title).toBe('Realtime Created Task');
      expect(eventData.projectId).toBe(project1Id);
    });

    it('should emit task.updated and task.status_changed when status is changed', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_project', { organizationId: org1Id, projectId: project1Id }, () =>
          resolve(),
        );
      });

      const updatedPromise = new Promise<{ id: string; status: string }>((resolve) => {
        client.on('task.updated', (data: { id: string; status: string }) => resolve(data));
      });

      const statusChangedPromise = new Promise<{
        id: string;
        previousStatus: string;
        newStatus: string;
      }>((resolve) => {
        client.on(
          'task.status_changed',
          (data: { id: string; previousStatus: string; newStatus: string }) => resolve(data),
        );
      });

      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          status: 'IN_PROGRESS',
        });

      expect(res.status).toBe(200);

      const updatedData = await updatedPromise;
      expect(updatedData.id).toBe(task1Id);
      expect(updatedData.status).toBe('IN_PROGRESS');

      const statusData = await statusChangedPromise;
      expect(statusData.id).toBe(task1Id);
      expect(statusData.previousStatus).toBe('TODO');
      expect(statusData.newStatus).toBe('IN_PROGRESS');
    });

    it('should emit task.assignment_changed when task assignees are updated', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_project', { organizationId: org1Id, projectId: project1Id }, () =>
          resolve(),
        );
      });

      const assignChangedPromise = new Promise<{
        id: string;
        newAssigneeIds: string[];
      }>((resolve) => {
        client.on(
          'task.assignment_changed',
          (data: { id: string; newAssigneeIds: string[] }) => resolve(data),
        );
      });

      const res = await request(app)
        .patch(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          assigneeUserIds: [memberUser.id],
        });

      expect(res.status).toBe(200);

      const assignData = await assignChangedPromise;
      expect(assignData.id).toBe(task1Id);
      expect(assignData.newAssigneeIds).toContain(memberUser.id);
    });

    it('should emit task.deleted when task is removed', async () => {
      // Create a temporary task to delete
      const created = await prisma.task.create({
        data: {
          projectId: project1Id,
          title: 'Task To Delete',
          createdById: ownerUser.id,
        },
      });

      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_project', { organizationId: org1Id, projectId: project1Id }, () =>
          resolve(),
        );
      });

      const deletedPromise = new Promise<{ id: string }>((resolve) => {
        client.on('task.deleted', (data: { id: string }) => resolve(data));
      });

      const res = await request(app)
        .delete(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${created.id}`)
        .set('Authorization', `Bearer ${ownerUser.token}`);

      expect(res.status).toBe(200);

      const deletedData = await deletedPromise;
      expect(deletedData.id).toBe(created.id);
    });

    it('should NOT leak task events across organizations', async () => {
      // Outside user joins Org 2 project room
      const outsideClient = createClient(outsideUser.token);
      await new Promise<void>((res) => outsideClient.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        outsideClient.emit(
          'join_project',
          { organizationId: org2Id, projectId: project2Id },
          () => resolve(),
        );
      });

      let receivedEvent = false;
      outsideClient.on('task.created', () => {
        receivedEvent = true;
      });

      // Create task in Org 1
      await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .send({
          title: 'Org 1 Private Task',
          status: 'TODO',
          priority: 'LOW',
        });

      // Wait 300ms to verify no cross-tenant emission
      await new Promise((r) => setTimeout(r, 300));
      expect(receivedEvent).toBe(false);
    });
  });

  // ─── 4. Comment Events ──────────────────────────────────────────────────────
  describe('Comment Events', () => {
    let createdCommentId: string;

    it('should emit comment.created to task room when comment is created', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_task', { organizationId: org1Id, taskId: task1Id }, () => resolve());
      });

      const eventPromise = new Promise<{ id: string; content: string; taskId: string }>(
        (resolve) => {
          client.on(
            'comment.created',
            (data: { id: string; content: string; taskId: string }) => resolve(data),
          );
        },
      );

      const res = await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          content: 'Hello realtime comment!',
        });

      expect(res.status).toBe(201);
      createdCommentId = res.body.data.id;

      const eventData = await eventPromise;
      expect(eventData.id).toBe(createdCommentId);
      expect(eventData.content).toBe('Hello realtime comment!');
      expect(eventData.taskId).toBe(task1Id);
    });

    it('should emit comment.updated when comment is modified', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_task', { organizationId: org1Id, taskId: task1Id }, () => resolve());
      });

      const eventPromise = new Promise<{ id: string; content: string }>((resolve) => {
        client.on('comment.updated', (data: { id: string; content: string }) => resolve(data));
      });

      const res = await request(app)
        .patch(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${createdCommentId}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          content: 'Updated realtime comment content',
        });

      expect(res.status).toBe(200);

      const eventData = await eventPromise;
      expect(eventData.id).toBe(createdCommentId);
      expect(eventData.content).toBe('Updated realtime comment content');
    });

    it('should emit comment.deleted when comment is deleted', async () => {
      const client = createClient(memberUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_task', { organizationId: org1Id, taskId: task1Id }, () => resolve());
      });

      const eventPromise = new Promise<{ id: string; taskId: string }>((resolve) => {
        client.on('comment.deleted', (data: { id: string; taskId: string }) => resolve(data));
      });

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments/${createdCommentId}`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`);

      expect(res.status).toBe(200);

      const eventData = await eventPromise;
      expect(eventData.id).toBe(createdCommentId);
      expect(eventData.taskId).toBe(task1Id);
    });

    it('should NOT leak comment events to a different task room', async () => {
      // Client joins Org 2 task room
      const client = createClient(outsideUser.token);
      await new Promise<void>((res) => client.on('connect', () => res()));

      await new Promise<void>((resolve) => {
        client.emit('join_task', { organizationId: org2Id, taskId: task2Id }, () => resolve());
      });

      let receivedEvent = false;
      client.on('comment.created', () => {
        receivedEvent = true;
      });

      // Post comment on Org 1 task
      await request(app)
        .post(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/comments`,
        )
        .set('Authorization', `Bearer ${memberUser.token}`)
        .send({
          content: 'Private Org 1 Comment',
        });

      await new Promise((r) => setTimeout(r, 300));
      expect(receivedEvent).toBe(false);
    });
  });
});
