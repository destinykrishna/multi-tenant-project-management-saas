# Project Overview & Architecture Guide

This document explains the architecture, the components implemented so far, how each piece works under the hood, and what comes next.

---

## 1. High-Level Technology Stack

- **Runtime & Language:** Node.js 22 + TypeScript 6 (Strict mode, ES2022 target)
- **Web Framework:** Express 5
- **Database & ORM:** PostgreSQL + Prisma 7.9.1 with `@prisma/adapter-pg` driver adapter
- **Caching & Infrastructure Client:** Redis (`ioredis`) singleton client with connection lifecycle listeners, health check probing, graceful shutdown, transparent service-layer caching, namespaced cache keys, sensible TTLs, and automatic invalidation
- **Rate Limiting & API Security:** Distributed, atomic Redis pipeline-backed rate limiter (`src/middlewares/rate-limit.middleware.ts`), Helmet security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `HSTS`, `X-DNS-Prefetch-Control: off`), CORS origin environment configuration, secure cookies (`httpOnly: true`, `secure: production`, `sameSite: 'lax'`, `path: '/api/v1/auth'`), and centralized error sanitization preventing stack/secret leaks in production
- **Background Jobs & Queues:** BullMQ 6 (`bullmq`) for asynchronous background processing (Email, Notification, Cleanup) with exponential backoff, job retention policies, decoupled worker lifecycles, and error resilience
- **Email Delivery:** Nodemailer reusable transport service with environment-based SMTP configuration and non-blocking BullMQ email dispatching
- **In-App Notifications:** Event-driven in-app notifications stored in PostgreSQL and asynchronously processed via BullMQ `notificationQueue`
- **Scheduled Maintenance & Cleanup:** Safe, batched, idempotent cleanup jobs via BullMQ `cleanupQueue` and `cleanupService` for expired/revoked sessions and stale read notifications
- **Dashboard Analytics:** High-performance PostgreSQL aggregation queries for organization metrics (`totalProjects`, `activeProjects`, `totalTasks`, `tasksByStatus`, `tasksByPriority`, `overdueTasks`, `assignedToMe`, `recentActivity`, `recentNotifications`)
- **Connection Management:** `pg.Pool` with reusable connections & singleton `Redis` client
- **Validation:** Zod (Environment variables, route params, query strings, and body payloads)
- **Authentication & Security:** JWT (`jsonwebtoken`), Password Hashing (`bcryptjs`), Bearer Token Authentication Middleware, Multi-Tenant RBAC Authorization Middleware (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), Member Management with Owner Protection, Project-level Scoping, Task Assignee Membership Enforcement, Task State Transition Validation, Comment Author Ownership & Moderator Controls, Activity Audit Logging & Read API across all entities, Notification Ownership Enforcement, SHA-256 Refresh Token Hashing, Refresh Token Rotation, Session Revocation, Helmet, CORS, Cookie Parser
- **Logging & Tracing:** Pino + `pino-http` + UUID-based Request ID propagation
- **Testing & Quality:** Jest, ts-jest (`--experimental-vm-modules`), Supertest, ESLint (TypeScript strict type-checked), Prettier

---

## 2. Directory Structure & Layer Responsibilities

```text
src/
├── app.ts                  # Express app setup (Middlewares, routes mounting, /health check, error handling)
├── server.ts               # HTTP server entry point & graceful shutdown lifecycle (Database & Redis hooks)
├── config/
│   ├── env.ts              # Zod schema validation for all environment variables (including REDIS_URL, SMTP_*, CORS_ORIGIN)
│   ├── logger.ts           # Structured Pino logger (dev pretty-print vs prod JSON)
│   ├── database.ts         # Singleton PrismaClient + pg.Pool connection manager
│   ├── redis.ts            # Reusable Redis client, lifecycle listeners, health check, graceful shutdown
│   └── email.ts            # Nodemailer transport service & non-blocking BullMQ email queue dispatcher
├── constants/
│   ├── activity.ts         # EntityType & ActivityAction enums
│   ├── notification.ts     # NotificationType constants matching Prisma enum
│   ├── roles.ts            # Organization roles (OWNER, ADMIN, MEMBER, VIEWER) & helpers
│   ├── task.ts             # TaskStatus, TaskPriority & VALID_STATUS_TRANSITIONS state machine
│   └── errors.ts           # System-wide error codes
├── generated/
│   └── prisma/             # Generated TypeScript Prisma client SDK
├── jobs/                   # BullMQ asynchronous background queues and workers
│   ├── queues/             # Queue definitions and typed job enqueue helpers
│   │   ├── queue.config.ts         # Queue names, default retry backoff, and retention configuration
│   │   ├── email.queue.ts          # Email queue & addEmailJob helper
│   │   ├── notification.queue.ts   # Notification queue & addNotificationJob helper
│   │   └── cleanup.queue.ts        # Cleanup queue & recurring schedule helper
│   ├── services/           # Reusable job services
│   │   └── cleanup.service.ts      # Batched, idempotent session & notification cleanup logic
│   └── workers/            # Independent background workers and processors
│       ├── index.ts                # Worker orchestrator and standalone process runner
│       ├── email.worker.ts         # Email worker consuming jobs via Nodemailer transport
│       ├── notification.worker.ts  # Notification worker persisting jobs to PostgreSQL
│       └── cleanup.worker.ts       # Maintenance and cleanup worker executing CleanupService
├── middlewares/
│   ├── request-id.middleware.ts    # Injects & tracks UUID per request
│   ├── validation.middleware.ts    # Generic Zod validation for body, query, params (Express 5 compatible)
│   ├── auth.middleware.ts          # JWT Bearer authentication & req.user context injection
│   ├── authorization.middleware.ts # Multi-tenant RBAC role verification & req.membership injection
│   ├── rate-limit.middleware.ts    # Redis-backed distributed rate limiters (general & auth tiers)
│   └── error.middleware.ts         # Centralized error handler & 404 handler with production sanitization
├── modules/                # Domain-driven feature modules
│   ├── auth/               # Registration, login, refresh rotation, logout (Auth rate limited)
│   ├── organizations/      # Multi-tenant Organization CRUD & Member Management (Cached + Notifications)
│   ├── projects/           # Scoped Project CRUD, Pagination & Key Management (Cached + Invalidation)
│   ├── tasks/              # Scoped Task CRUD, Assignee Validation, State Transitions (Notifications)
│   ├── comments/           # Scoped Comment CRUD, Pagination, Author & Moderator rules (Activity Log integrated)
│   ├── activity/           # Reusable Activity Logging Service, Repository & Read API
│   │   ├── activity.routes.ts          # Read-only GET routes for activity logs
│   │   ├── activity.schema.ts          # Zod schemas for activity params & filtering queries
│   │   ├── activity.controller.ts      # HTTP controller for activity feeds
│   │   ├── activity.service.ts         # Activity business logic & pagination orchestration
│   │   ├── activity.repository.ts      # ActivityLog Prisma persistence and query helpers
│   │   └── activity.types.ts           # Activity payload and log response interfaces
│   ├── dashboard/          # Organization-level Dashboard Analytics Module
│   │   ├── dashboard.routes.ts         # Authenticated & RBAC-protected route GET /
│   │   ├── dashboard.schema.ts         # Zod schemas for query limits & params
│   │   ├── dashboard.controller.ts     # Express controller for dashboard queries
│   │   ├── dashboard.service.ts        # Business logic & aggregation orchestrator
│   │   ├── dashboard.repository.ts     # High-performance Prisma count & groupBy queries
│   │   └── dashboard.types.ts          # Metrics response contracts
│   └── notifications/      # In-app notifications API & service
│       ├── notification.routes.ts      # Authenticated routes for listing, unread counts, marking read
│       ├── notification.schema.ts      # Zod validation for query & params
│       ├── notification.controller.ts  # Controller handlers for user notifications
│       ├── notification.service.ts     # Business logic, pagination & BullMQ dispatching
│       ├── notification.repository.ts  # Prisma data access for notifications
│       └── notification.types.ts       # Domain types & interfaces
├── utils/
│   ├── cache.ts            # Fault-tolerant CacheService with key namespaces, TTLs, and scan/del invalidation
│   ├── errors.ts           # AppError class hierarchy (400, 401, 403, 404, 409, 422, 429, 500)
│   ├── pagination.ts       # Paginated response building & offset calculations
│   ├── response.ts         # Standardized API response formatters (sendSuccess, sendError)
│   ├── password.ts         # bcryptjs hashing and comparison helpers
│   └── jwt.ts              # Access/Refresh token generation, verification & SHA-256 hashing
prisma/
├── schema.prisma           # Database schema definition (9 models, 7 enums)
└── migrations/             # Version-controlled SQL migration history
tests/
├── integration/            # Supertest integration tests (auth, orgs, members, projects, tasks, comments, activity, health, cache, bullmq, email, notifications, cleanup, security, dashboard, workflow)
└── unit/                   # Isolated unit tests (password utils, jwt utils)
```

---

## 3. Cross-Module Consistency & Integration Review

1. **Standardized Response Contract (`sendSuccess`)**:
   - Every single successful endpoint returns `{ success: true, data: T, message?: string }`.
   - Paginated endpoints return `{ items: T[], pagination: { total, page, limit, totalPages } }`.
2. **Standardized Error Contract (`sendError`)**:
   - Every single error endpoint returns `{ success: false, error: { code: string, message: string, details?: unknown } }`.
3. **HTTP Status Code Uniformity**:
   - `200 OK`: Successful reads, updates, and deletes with payload.
   - `201 Created`: Entity creation (Registration, Organizations, Projects, Tasks, Comments).
   - `400 Bad Request`: State machine violations (invalid task transitions, invalid unassign).
   - `401 Unauthorized`: Missing/invalid access token, expired refresh token.
   - `403 Forbidden`: Non-membership access attempts, insufficient RBAC permissions, cross-tenant modifications.
   - `404 Not Found`: Non-existent entity queries.
   - `409 Conflict`: Duplicate emails, duplicate organization slugs, duplicate project keys.
   - `422 Unprocessable Entity`: Zod validation schema rejections.
   - `429 Too Many Requests`: Redis rate limiter violations.
   - `500 Internal Server Error`: Centralized uncaught error handling with production detail redaction.
4. **End-to-End Workflow Verification (`tests/integration/workflow.test.ts`)**:
   - `register → organization → project → task → assignment → comment → activity → notification → dashboard` verified with 100% test pass rate.

---

## 4. Complete Automated Testing Suite (212 Tests Across 23 Suites)

### Unit Tests (`npm run test:unit`)
- **`tests/unit/password.test.ts`**: Password hashing & verification.
- **`tests/unit/jwt.test.ts`**: Token generation, verification, SHA-256 hashing.

### Integration Tests (`npm run test:integration`)
- **`tests/integration/auth-register.test.ts`**: Registration happy path, conflicts, validation.
- **`tests/integration/auth-login.test.ts`**: Login, credential checks, cookies, validation.
- **`tests/integration/auth-refresh.test.ts`**: Rotation, revocation checks, expiry checks.
- **`tests/integration/auth-logout.test.ts`**: Session revocation, cookie clearance, idempotency.
- **`tests/integration/auth-middleware.test.ts`**: Bearer token authentication, header validation, expiration.
- **`tests/integration/authorization-middleware.test.ts`**: RBAC permissions for OWNER, ADMIN, MEMBER, VIEWER, and spoofing prevention.
- **`tests/integration/organizations.test.ts`**: Org CRUD, slug handling, tenant isolation, cross-org denial.
- **`tests/integration/organization-members.test.ts`**: Member listing, invite/add, role changes, deletion, owner protection.
- **`tests/integration/projects.test.ts`**: Project CRUD, pagination, status filtering, key uniqueness, cross-org denial.
- **`tests/integration/tasks.test.ts`**: Task CRUD, assignment, reassignment, unassignment, state transitions, filters, sorting, RBAC.
- **`tests/integration/comments.test.ts`**: Comment CRUD, pagination, author ownership, moderator deletions.
- **`tests/integration/activity.test.ts`**: Activity log creation, querying, entity filtering, pagination, tenant isolation.
- **`tests/integration/health.test.ts`**: `/health` endpoint returning system metrics and `services.redis` status.
- **`tests/integration/cache.test.ts`**: Cache miss/hit, invalidation, tenant isolation, database fallback.
- **`tests/integration/bullmq.test.ts`**: Queue names, retry/backoff configuration, job enqueueing, worker startup/teardown.
- **`tests/integration/email.test.ts`**: Nodemailer transport delivery, non-blocking queueing, background worker consumption.
- **`tests/integration/notifications.test.ts`**: In-app notifications API, unread count, read marking, tenant isolation, BullMQ delivery.
- **`tests/integration/cleanup.test.ts`**: Expired session cleanup, revoked session cleanup, batched deletion, idempotency, worker execution.
- **`tests/integration/security.test.ts`**: Rate limiting, security headers, 429 status, client isolation, fallback.
- **`tests/integration/dashboard.test.ts`**: Organization aggregation metrics, task distribution, recent items, isolation.
- **`tests/integration/workflow.test.ts`**:
  - ✅ Step 1: User Registration & Authentication (Owner & Member).
  - ✅ Step 2: Organization Creation & Member Invitation.
  - ✅ Step 3: Project Creation.
  - ✅ Step 4: Task Creation, Assignee Validation & Status Transition.
  - ✅ Step 5: Task Comments & Collaboration.
  - ✅ Step 6: Activity Logging & Audit Trail verification.
  - ✅ Step 7: BullMQ Notifications Queue, Background Delivery & Read API.
  - ✅ Step 8: Dashboard Aggregation Verification.
