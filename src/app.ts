import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestIdMiddleware } from './middlewares/request-id.middleware.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import { sendSuccess } from './utils/response.js';
import { checkRedisHealth } from './config/redis.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { organizationRouter } from './modules/organizations/organization.routes.js';
import { projectRouter } from './modules/projects/project.routes.js';
import { taskRouter } from './modules/tasks/task.routes.js';
import { commentRouter } from './modules/comments/comment.routes.js';
import { activityRouter } from './modules/activity/activity.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { meetingRouter } from './modules/meetings/meeting.routes.js';
import { googleRouter } from './modules/integrations/google/google.routes.js';
import { ragRouter } from './modules/rag/rag.routes.js';
import { generalRateLimiter } from './middlewares/rate-limit.middleware.js';

const app = express();

// Enable trust proxy for reverse proxy / load balancer (e.g., Nginx)
app.set('trust proxy', 1);

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  }),
);

// ─── Request Parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Request ID & Logging ──────────────────────────────────────────────────────
app.use(requestIdMiddleware);
app.use(
  pinoHttp({
    logger,
    customProps(req) {
      return { requestId: req.id };
    },
    // Don't log health check requests to reduce noise
    autoLogging: {
      ignore(req) {
        return req.url === '/health';
      },
    },
  }),
);

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const redisHealth = await checkRedisHealth();

  sendSuccess(res, {
    status: redisHealth.status === 'healthy' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    services: {
      redis: redisHealth,
    },
  });
});

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', generalRateLimiter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organizations', organizationRouter);
app.use('/api/v1/organizations/:organizationId/projects', projectRouter);
app.use('/api/v1/organizations/:organizationId/projects/:projectId/tasks', taskRouter);
app.use(
  '/api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments',
  commentRouter,
);
app.use('/api/v1/organizations/:organizationId/activity', activityRouter);
app.use('/api/v1/organizations/:organizationId/dashboard', dashboardRouter);
app.use('/api/v1/organizations/:organizationId/meetings', meetingRouter);
app.use('/api/v1/organizations/:organizationId/rag', ragRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/integrations/google', googleRouter);

// ─── Error Handling ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
