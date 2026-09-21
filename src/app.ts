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
import { attachmentRouter } from './modules/attachments/attachment.routes.js';
import { activityRouter } from './modules/activity/activity.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { meetingRouter } from './modules/meetings/meeting.routes.js';
import { teamRouter } from './modules/teams/team.routes.js';
import { googleRouter } from './modules/integrations/google/google.routes.js';
import { ragRouter } from './modules/rag/rag.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { generalRateLimiter } from './middlewares/rate-limit.middleware.js';
import { cloudflareEdgeMiddleware, isTrustedProxy } from './middlewares/cloudflare.middleware.js';
import { edgeRouter } from './modules/system/edge.routes.js';

const app = express();

// Enable secure trust proxy boundary for reverse proxy / load balancer (e.g., Cloudflare Anycast + Nginx)
app.set('trust proxy', isTrustedProxy);

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'http:', 'https:', 'ws:', 'wss:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: {
      maxAge: 63072000, // 2 years in seconds
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-request-id',
      'cf-ray',
      'cf-connecting-ip',
      'cf-ipcountry',
      'x-origin-verify-secret',
    ],
  }),
);

// ─── Request Parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Request ID & Logging ──────────────────────────────────────────────────────
app.use(requestIdMiddleware);
app.use(cloudflareEdgeMiddleware);
app.use(
  pinoHttp({
    logger,
    customProps(req) {
      return { requestId: req.id, cfRay: req.edge?.rayId, clientIp: req.edge?.clientIp };
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
app.use('/api/v1/system', edgeRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organizations', organizationRouter);
app.use('/api/v1/organizations/:organizationId/projects', projectRouter);
app.use('/api/v1/organizations/:organizationId/teams', teamRouter);
app.use('/api/v1/organizations/:organizationId/projects/:projectId/tasks', taskRouter);
app.use(
  '/api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments',
  commentRouter,
);
app.use(
  '/api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/attachments',
  attachmentRouter,
);
app.use('/api/v1/organizations/:organizationId/activity', activityRouter);
app.use('/api/v1/organizations/:organizationId/dashboard', dashboardRouter);
app.use('/api/v1/organizations/:organizationId/meetings', meetingRouter);
app.use('/api/v1/organizations/:organizationId/rag', ragRouter);
app.use('/api/v1/organizations/:organizationId/ai', aiRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/integrations/google', googleRouter);

// ─── Error Handling ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
