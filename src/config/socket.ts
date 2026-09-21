import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { env } from './env.js';
import { logger } from './logger.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { tokenRevocationBloom } from '../utils/bloom.js';
import { prisma } from './database.js';

export interface SocketUser {
  id: string;
  email: string;
}

export function projectRoom(orgId: string, projectId: string): string {
  return `org:${orgId}:project:${projectId}`;
}

export function taskRoom(orgId: string, taskId: string): string {
  return `org:${orgId}:task:${taskId}`;
}

let io: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return io;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  if (io) {
    return io;
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Socket Authentication Middleware
  io.use((socket, next) => {
    void (async () => {
      try {
        const authHeader = socket.handshake.headers.authorization;
        const bearerToken = authHeader?.replace(/^Bearer\s+/i, '');
        const authObj = socket.handshake.auth as Record<string, unknown> | undefined;
        const token = (authObj?.['token'] as string | undefined) || bearerToken;

        if (!token) {
          next(new Error('AUTHENTICATION_REQUIRED'));
          return;
        }

        const payload = verifyAccessToken(token);

        // Distributed Redis-authoritative revocation check (fails closed on Redis error)
        try {
          if (payload.jti && (await tokenRevocationBloom.isRevokedDistributed(payload.jti))) {
            next(new Error('TOKEN_REVOKED'));
            return;
          }
        } catch (revocationError) {
          logger.warn(
            { revocationError, jti: payload.jti, userId: payload.userId },
            'Socket auth failed: revocation service unavailable',
          );
          next(new Error('AUTH_SERVICE_UNAVAILABLE'));
          return;
        }

        const socketData = socket.data as { user?: SocketUser };
        socketData.user = {
          id: payload.userId,
          email: payload.email,
        };

        next();
      } catch {
        next(new Error('INVALID_ACCESS_TOKEN'));
        return;
      }
    })();
  });

  io.on('connection', (socket) => {
    const socketData = socket.data as { user?: SocketUser };
    const user = socketData.user;

    logger.debug({ userId: user?.id, socketId: socket.id }, 'Socket client connected');

    // Join Project Room with server-side authorization
    socket.on(
      'join_project',
      async (
        data?: { organizationId?: string; projectId?: string },
        callback?: (res: { success: boolean; error?: string; room?: string }) => void,
      ) => {
        try {
          if (!user?.id) {
            callback?.({ success: false, error: 'AUTHENTICATION_REQUIRED' });
            return;
          }

          const { organizationId, projectId } = data ?? {};
          if (!organizationId || !projectId) {
            callback?.({ success: false, error: 'INVALID_PARAMETERS' });
            return;
          }

          // Verify organization membership in database
          const member = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId,
                userId: user.id,
              },
            },
          });

          if (!member) {
            callback?.({ success: false, error: 'FORBIDDEN_NOT_MEMBER' });
            return;
          }

          // Verify project belongs to organization
          const project = await prisma.project.findFirst({
            where: {
              id: projectId,
              organizationId,
            },
            select: { id: true },
          });

          if (!project) {
            callback?.({ success: false, error: 'PROJECT_NOT_FOUND' });
            return;
          }

          const room = projectRoom(organizationId, projectId);
          await socket.join(room);
          callback?.({ success: true, room });
        } catch (error) {
          logger.error({ error, socketId: socket.id }, 'Error joining project room');
          callback?.({ success: false, error: 'INTERNAL_SERVER_ERROR' });
        }
      },
    );

    // Leave Project Room
    socket.on(
      'leave_project',
      async (
        data?: { organizationId?: string; projectId?: string },
        callback?: (res: { success: boolean }) => void,
      ) => {
        try {
          const { organizationId, projectId } = data ?? {};
          if (organizationId && projectId) {
            const room = projectRoom(organizationId, projectId);
            await socket.leave(room);
          }
          callback?.({ success: true });
        } catch {
          callback?.({ success: false });
        }
      },
    );

    // Join Task Room with server-side authorization
    socket.on(
      'join_task',
      async (
        data?: { organizationId?: string; taskId?: string },
        callback?: (res: { success: boolean; error?: string; room?: string }) => void,
      ) => {
        try {
          if (!user?.id) {
            callback?.({ success: false, error: 'AUTHENTICATION_REQUIRED' });
            return;
          }

          const { organizationId, taskId } = data ?? {};
          if (!organizationId || !taskId) {
            callback?.({ success: false, error: 'INVALID_PARAMETERS' });
            return;
          }

          // Verify organization membership in database
          const member = await prisma.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId,
                userId: user.id,
              },
            },
          });

          if (!member) {
            callback?.({ success: false, error: 'FORBIDDEN_NOT_MEMBER' });
            return;
          }

          // Verify task belongs to project in this organization
          const task = await prisma.task.findFirst({
            where: {
              id: taskId,
              project: { organizationId },
            },
            select: { id: true },
          });

          if (!task) {
            callback?.({ success: false, error: 'TASK_NOT_FOUND' });
            return;
          }

          const room = taskRoom(organizationId, taskId);
          await socket.join(room);
          callback?.({ success: true, room });
        } catch (error) {
          logger.error({ error, socketId: socket.id }, 'Error joining task room');
          callback?.({ success: false, error: 'INTERNAL_SERVER_ERROR' });
        }
      },
    );

    // Leave Task Room
    socket.on(
      'leave_task',
      async (
        data?: { organizationId?: string; taskId?: string },
        callback?: (res: { success: boolean }) => void,
      ) => {
        try {
          const { organizationId, taskId } = data ?? {};
          if (organizationId && taskId) {
            const room = taskRoom(organizationId, taskId);
            await socket.leave(room);
          }
          callback?.({ success: true });
        } catch {
          callback?.({ success: false });
        }
      },
    );

    socket.on('disconnect', () => {
      logger.debug({ userId: user?.id, socketId: socket.id }, 'Socket client disconnected');
    });
  });

  return io;
}

export function emitToProject(
  organizationId: string,
  projectId: string,
  event: string,
  data: unknown,
): void {
  if (!io) return;
  const room = projectRoom(organizationId, projectId);
  io.to(room).emit(event, data);
}

export function emitToTask(
  organizationId: string,
  taskId: string,
  event: string,
  data: unknown,
): void {
  if (!io) return;
  const room = taskRoom(organizationId, taskId);
  io.to(room).emit(event, data);
}

export async function closeSocketServer(): Promise<void> {
  if (io) {
    const activeIo = io;
    io = null;
    activeIo.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      void activeIo.close(() => {
        resolve();
      });
    });
  }
}
