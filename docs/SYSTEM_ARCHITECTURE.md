# System Architecture — Multi-Tenant Project Management SaaS Backend

> **This document describes the ACTUAL implementation.** Every claim maps to real code in the repository. Nothing here is aspirational unless explicitly marked **[FUTURE / NOT IMPLEMENTED]**.

---

## 1. What This Product Is

This is a **multi-tenant project management SaaS backend** — think a simplified, self-hosted Jira or Linear.

**The problem it solves:** Teams inside separate organizations need a shared workspace to create projects, break work into tasks with priorities and status workflows, assign tasks to members, discuss tasks via comments, get notified about changes, and track who did what through an audit log. Each organization's data must be completely isolated from every other organization.

**What it is NOT (yet):** It has no frontend, no AI features, no calendar integration, and no file uploads. It is a pure JSON API designed to be consumed by any frontend client.

---

## 2. Complete System Architecture

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#1-high-level-system-architecture))*

**Why this architecture:**
- **Nginx in front** — A single public entry point means you can add TLS, rate limiting, and IP banning in one place. The app containers never receive raw internet traffic.
- **Two API instances** — Proves the app is stateless. If one crashes, the other keeps serving. Nginx's `least_conn` algorithm automatically routes new requests to whichever container has fewer active connections.
- **Workers are a separate container** — Background jobs (sending emails, creating notifications, cleaning up expired sessions) must not block or slow down HTTP responses. If a worker crashes processing a 10-second email send, no API request is affected.
- **PostgreSQL and Redis have no public ports** — They exist only on the internal Docker bridge network (`expense_network`). This is a genuine security boundary, not just a convention.

**What simpler alternative could have been used:** A single Node.js process with `setTimeout`-based background work and SQLite. That works fine for a prototype but breaks the moment you need two server instances, a deployment that survives crashes, or any real concurrency.

---

## 3. Every Module and Its Responsibility

The codebase lives in `src/` and follows a strict layered architecture. Each module has the same internal shape:

| Layer | File | Responsibility |
|:------|:-----|:---------------|
| **Schema** | `*.schema.ts` | Zod validation schemas — defines what input looks like |
| **Controller** | `*.controller.ts` | Extracts data from `req`, calls service, calls `sendSuccess`/`sendError` |
| **Service** | `*.service.ts` | Business logic, validation rules, cross-module orchestration |
| **Repository** | `*.repository.ts` | Prisma queries — the only files that touch the database |
| **Types** | `*.types.ts` | TypeScript response/internal types |
| **Routes** | `*.routes.ts` | Express Router with middleware chain |

### The 8 Modules

| Module | What It Does | Key Decisions |
|:-------|:-------------|:--------------|
| **auth** | Register, login, refresh token rotation, logout | Refresh tokens stored as SHA-256 hashes in PostgreSQL, not in Redis. Reuse detection revokes entire session family. |
| **organizations** | CRUD organizations, manage members, assign roles | An organization is the tenant boundary. Every data query filters by `organizationId`. |
| **projects** | CRUD projects within an organization | Projects have a unique `key` (like Jira's `PROJ-123`). Auto-generated from project name if not provided. |
| **tasks** | CRUD tasks within a project, status transitions, assignment | Status transitions are validated against a state machine (`VALID_STATUS_TRANSITIONS`). Assignment validates that the assignee is a member of the organization. |
| **comments** | CRUD comments on tasks | Authors can edit/delete their own. `OWNER`/`ADMIN` can delete anyone's. Notifies the task assignee when someone comments. |
| **activity** | Read-only audit log | Every create/update/delete across projects, tasks, comments, and members writes an `ActivityLog` row. This is append-only. |
| **notifications** | List, mark-read, mark-all-read | Notifications are created asynchronously via BullMQ, not in the HTTP request path. The user polls for them. |
| **dashboard** | Aggregated organization metrics | Runs 4 parallel `Promise.all` database queries: project counts, task breakdowns by status/priority, overdue tasks, recent activity. |

---

## 4. Request Lifecycle

This is the exact sequence for every HTTP request in this system:

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#2-request-lifecycle))*

**Why this order matters:**
1. `requestId` is set FIRST so every log line from this request can be correlated.
2. Rate limiting runs BEFORE authentication so brute-force attempts are blocked even if the token is invalid.
3. Authentication runs BEFORE authorization because you need to know WHO the user is before checking WHAT they can do.
4. Zod validation runs AFTER auth so we don't waste CPU validating request bodies from unauthenticated users.

**What happens when it fails:**
- If Nginx can't reach either API instance → client gets a `502 Bad Gateway` and Nginx retries on the other instance (up to 3 tries).
- If Redis is down → rate limiting silently passes (fail-open design in `rate-limit.middleware.ts` line 86-91), caching returns `null` and falls through to the database.
- If PostgreSQL is down → Prisma throws, the error handler returns a `500` with the message "Internal server error" in production (no stack traces leaked).

---

## 5. Authentication — The Complete Flow

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#3-authentication-flow))*

### Key Security Decisions (all actually implemented):

1. **Refresh tokens are NEVER stored in plain text.** The database only holds `sha256(token)`. If the database is compromised, the attacker has hashes, not usable tokens.
2. **Token rotation** — every refresh creates a NEW token and revokes the old one. A stolen token can only be used once.
3. **Reuse detection (RFC 6819)** — if someone tries to use an already-rotated token, ALL of that user's sessions are revoked. This is in [`auth.service.ts` line 173-180](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.service.ts#L173-L180).
4. **Cookie settings** — `HttpOnly` (JavaScript can't read it), `SameSite=Lax` (protects against CSRF), `Secure` (HTTPS only in production), `Path=/api/v1/auth` (cookie only sent to auth endpoints).
5. **Separate secrets** — `JWT_SECRET` for access tokens, `JWT_REFRESH_SECRET` for refresh tokens. Compromising one doesn't compromise the other.

**What simpler alternative could have been used:** Store the refresh token in `localStorage` and skip cookies entirely. This is what many tutorials teach. It's simpler but vulnerable to XSS attacks — any JavaScript on the page can steal the token.

---

## 6. Multi-Tenancy and RBAC

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#4-multi-tenancy--rbac))*

### How Tenant Isolation Actually Works

Every API route under `/api/v1/organizations/:organizationId/...` goes through the `authorizeOrgRole` middleware ([`authorization.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/authorization.middleware.ts)). This middleware:

1. Extracts `organizationId` from `req.params`.
2. Queries the `organization_members` table for a row matching `(organizationId, userId)`.
3. If no row exists → `403 NOT_AN_ORGANIZATION_MEMBER`.
4. If the row exists but the role isn't in the allowed list → `403 INSUFFICIENT_PERMISSIONS`.
5. Attaches `req.membership` with the verified role.

**This means:** Alice at Acme Corp cannot see, modify, or even know about Globex Inc's projects. The isolation is enforced at the middleware level (before any controller code runs) AND at the database query level (every repository query includes `WHERE organizationId = ...`).

### Role Permission Matrix (as implemented in route files)

| Action | OWNER | ADMIN | MEMBER | VIEWER |
|:-------|:-----:|:-----:|:------:|:------:|
| View organization / projects / tasks | ✅ | ✅ | ✅ | ✅ |
| Create projects | ✅ | ✅ | ✅ | ❌ |
| Create tasks | ✅ | ✅ | ✅ | ❌ |
| Update tasks / projects | ✅ | ✅ | ✅ | ❌ |
| Delete tasks / projects | ✅ | ✅ | ✅ | ❌ |
| Add / remove members | ✅ | ✅ | ❌ | ❌ |
| Update member roles | ✅ | ✅ | ❌ | ❌ |
| Update organization | ✅ | ✅ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ |

**Why not a permissions table?** A role-based approach is simpler and more predictable for a 4-role system. A permissions table (like `can_create_task`, `can_delete_project`) makes sense when you have custom roles, which this system doesn't need yet.

---

## 7. PostgreSQL, Prisma, and Connection Pooling

### The Database Stack

```
Application Code
      │
      ▼
Prisma Client (ORM — generates type-safe queries)
      │
      ▼
@prisma/adapter-pg (Prisma 7 driver adapter)
      │
      ▼
pg.Pool (connection pool — max 20 connections, 5s connect timeout, 30s idle timeout)
      │
      ▼
PostgreSQL 16 (actual database)
```

**Why Prisma 7 with `@prisma/adapter-pg`:** Prisma 7 removed the built-in Rust query engine. Instead, it uses a "driver adapter" pattern where you supply your own `pg.Pool`. This gives you direct control over connection pool sizing, timeouts, and error handling — things the old Rust engine hid from you.

**Why `pg.Pool` with `max: 20`:** Each API container gets a pool of up to 20 database connections. With 2 containers, that's 40 total connections to PostgreSQL. PostgreSQL's default `max_connections` is 100, so this leaves room for the worker container, `prisma migrate`, and admin tools.

**Singleton pattern** ([`database.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/config/database.ts)): In development, the PrismaClient is stored on `globalThis` so that hot-reloading (via `tsx watch`) doesn't create a new pool on every file change. In production, this doesn't matter because the process starts once.

### Database Schema (9 tables)

| Table | Purpose | Key Indexes |
|:------|:--------|:------------|
| `users` | User accounts | `email` (unique) |
| `refresh_sessions` | JWT refresh token hashes | `tokenHash` (unique), `userId` |
| `organizations` | Tenant containers | `slug` (unique), `ownerId` |
| `organization_members` | Tenant membership + roles | `(organizationId, userId)` (unique compound) |
| `projects` | Work containers within a tenant | `(organizationId, key)` (unique compound) |
| `tasks` | Individual work items | `(projectId, status, position)`, `(assigneeId, status)`, `(projectId, dueDate)` |
| `comments` | Discussion threads on tasks | `(taskId, createdAt)` |
| `activity_logs` | Append-only audit trail | `(organizationId, createdAt)`, `(entityType, entityId)` |
| `notifications` | In-app notification records | `(userId, isRead, createdAt)` |

---

## 8. Redis and Caching

Redis serves **three distinct purposes** in this system. Each is independent — if Redis dies, each degrades differently.

### Purpose 1: Cache (Read-Through Pattern)

Implemented in [`cache.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/cache.ts) with the `CacheService.getOrSet()` method:

```
Client requests GET /projects
      │
      ▼
CacheService.getOrSet(key, fetcherFunction, ttl)
      │
      ├── Redis has key? → Return cached JSON (skip database entirely)
      │
      └── Redis missing key? → Call fetcherFunction() → query PostgreSQL
                                  → Store result in Redis with TTL
                                  → Return result
```

**What's cached:**
- `org:{orgId}:projects:{queryHash}` — Project listing (TTL: 120s)
- `org:{orgId}:project:{projectId}` — Single project (TTL: 300s)

**Cache invalidation:** On create/update/delete of a project, the service explicitly calls `cache.del()` and `cache.delByPattern()` to remove stale entries. This is active invalidation, not TTL-based expiration.

**What happens if Redis is down:** Every `get`/`set`/`del` method in `CacheService` has a try-catch that logs a warning and continues. The application falls through to PostgreSQL for every request — slower but correct.

### Purpose 2: Rate Limiting (Sliding Window Counter)

Implemented in [`rate-limit.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/rate-limit.middleware.ts):

- **General API**: 200 requests per 60 seconds per IP (`ratelimit:gen:{ip}`)
- **Auth endpoints**: 20 requests per 15 minutes per IP+email (`ratelimit:auth:{ip}:{email}`)

The mechanism: `INCR` the key, check `TTL`, set `EXPIRE` if new. If count exceeds limit, respond with `429` and `Retry-After` header.

**What happens if Redis is down:** The rate limiter catches the error and calls `next()` — requests pass through unthrottled. This is a deliberate fail-open design: it's better to serve unthrottled traffic than to block all users because Redis is temporarily unreachable.

### Purpose 3: BullMQ Job Queue Broker

Redis is the message broker for BullMQ. Job data is stored in Redis lists and sorted sets. Workers poll Redis for new jobs to process.

---

## 9. BullMQ Queues and Workers

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#7-bullmq-architecture))*

### The Three Queues

| Queue | Producer | Consumer | What It Does |
|:------|:---------|:---------|:-------------|
| `notification-queue` | TaskService, CommentService | NotificationWorker (concurrency: 10) | Creates `Notification` rows in PostgreSQL |
| `email-queue` | EmailService | EmailWorker (concurrency: 5) | Sends emails via Nodemailer SMTP transport |
| `cleanup-queue` | Self (repeatable cron) | CleanupWorker | Deletes expired/revoked RefreshSessions and 30-day-old read Notifications in batches of 500 |

### Job Reliability Configuration ([`queue.config.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/jobs/queues/queue.config.ts))

- **3 retry attempts** with exponential backoff (1s, 2s, 4s)
- **Completed jobs retained** for 24 hours or 500 max
- **Failed jobs retained** for 7 days or 1000 max (for debugging)

**Why BullMQ instead of just calling the function directly?** Two reasons: (1) If sending an email takes 5 seconds, the API response would be blocked for 5 seconds. With a queue, the API responds immediately and the email sends in the background. (2) If the email fails, BullMQ retries it automatically. Without a queue, you'd need to build your own retry logic.

**What simpler alternative could have been used:** Call `notificationRepository.create()` directly in the service. This works but couples HTTP response time to notification database write time and provides no retry mechanism if the write fails.

---

## 10. Email and In-App Notifications

### Email (Nodemailer + BullMQ)

The email system ([`email.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/config/email.ts)) has two send paths:

1. **`sendDirect()`** — Synchronous SMTP send. Used when you absolutely must know if the email succeeded (not currently called by any production code).
2. **`queueEmail()`** — Adds a job to the `email-queue`. The EmailWorker picks it up and sends via SMTP. This is the production path.

In test mode (`NODE_ENV === 'test'`), Nodemailer uses `jsonTransport` — it serializes the email to JSON instead of actually sending it. This lets tests verify email content without an SMTP server.

### In-App Notifications

When something happens that a user should know about (task assigned, comment on their task, member added), the service calls `notificationService.queueNotification()`. This adds a job to the `notification-queue`. The NotificationWorker creates a `Notification` row in PostgreSQL.

The user retrieves notifications via `GET /api/v1/notifications` and marks them read via `PATCH /api/v1/notifications/:id/read`.

**Currently implemented notification triggers:**
- Task assigned to someone
- Task status changed (assignee is notified)
- Comment added on a task (assignee is notified)
- Member added to an organization
- Member removed from an organization

---

## 11. Activity / Audit Logging

Every mutation in the system calls `activityService.logActivity()` which writes an `ActivityLog` row:

```typescript
{
  organizationId: "...",   // tenant scoping
  userId: "...",           // who did it
  entityType: "TASK",      // what type of thing
  entityId: "...",         // which specific thing
  action: "CREATED",       // what happened
  metadata: { ... },       // context (varies by action)
  createdAt: Date          // when
}
```

The activity log is **append-only** — there is no update or delete endpoint. This is intentional. An audit log that can be modified is worthless.

**Currently logged actions:** CREATED, UPDATED, DELETED, TASK_STATUS_CHANGED, TASK_ASSIGNED, MEMBER_ADDED, MEMBER_REMOVED.

**Accessible via:** `GET /api/v1/organizations/:orgId/activity` with filters for `entityType`, `action`, and pagination.

---

## 12. Rate Limiting and Security

### Security Middleware Stack (applied in order in [`app.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/app.ts))

| Middleware | What It Does |
|:-----------|:-------------|
| `helmet()` | Sets 11 security headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, etc. |
| `cors()` | Only allows requests from `CORS_ORIGIN` (default: `http://localhost:3000`). Requires `credentials: true` for cookie-based auth. |
| `express.json({ limit: '10mb' })` | Prevents request body bombs. |
| `app.set('trust proxy', 1)` | Tells Express to read the real client IP from Nginx's `X-Forwarded-For` header (first hop only). Critical for rate limiting to work correctly behind a reverse proxy. |

### Nginx-Level Security ([`nginx.conf`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docker/nginx.conf))

- `server_tokens off` — Hides Nginx version from response headers.
- `X-Content-Type-Options: nosniff` — Prevents MIME-sniffing attacks.
- `X-Frame-Options: DENY` — Prevents clickjacking via iframes.
- `X-XSS-Protection: 1; mode=block` — Legacy XSS protection for older browsers.
- `client_max_body_size 10M` — Matches Express's JSON limit.

### Error Response Safety ([`error.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/error.middleware.ts))

In production (`NODE_ENV === 'production'`), if an error is NOT an `AppError` with `isOperational: true`, the response message is replaced with the generic "Internal server error" and no stack trace is included. This prevents leaking database connection strings, file paths, or internal state in error responses.

---

## 13. Docker Architecture

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#11-deployment-architecture))*

**Why multi-stage?** The `node_modules` with dev dependencies is ~400MB. The final image only includes production dependencies and compiled JavaScript — roughly 150MB. TypeScript source, test files, `.env`, and development tools are never in the production image.

**Why `dumb-init`?** Node.js doesn't handle Linux signals (SIGTERM, SIGINT) correctly as PID 1 inside a container. `dumb-init` is a tiny init system that forwards signals properly, enabling graceful shutdown.

**Why non-root user?** If an attacker exploits a vulnerability in the app, they get shell access as the `node` user (UID 1000), not as `root`. This limits the blast radius.

### Docker Compose Services ([`docker-compose.yml`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docker-compose.yml))

| Service | Image | Command | Health Check |
|:--------|:------|:--------|:-------------|
| `nginx` | `nginx:1.27-alpine` | Default | `wget http://127.0.0.1/health` |
| `api_1` | Built from Dockerfile | `node dist/server.js` | `wget http://127.0.0.1:5000/health` |
| `api_2` | Built from Dockerfile | `node dist/server.js` | `wget http://127.0.0.1:5000/health` |
| `workers` | Built from Dockerfile | `node dist/jobs/workers/index.js --run-workers` | None (daemon) |
| `postgres` | `postgres:16-alpine` | Default | `pg_isready` |
| `redis` | `redis:7-alpine` | `redis-server --appendonly yes` | `redis-cli ping` |

The `api_1` and `api_2` services use a YAML anchor (`&api-common`) to avoid duplicating configuration. Both services are identical — the only difference is the container name.

---

## 14. Nginx Reverse Proxy and Load Balancing

*(Visual diagram available in [`docs/ARCHITECTURE_DIAGRAMS.md`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docs/ARCHITECTURE_DIAGRAMS.md#10-nginx-load-balancing))*

**How `least_conn` works:** Unlike round-robin (which alternates blindly), `least_conn` checks which backend currently has fewer active connections and routes the new request there. This naturally handles the case where one instance is processing a slow database query — new requests go to the instance that's free.

**Keepalive connections (`keepalive 32`):** Without this, Nginx would open a new TCP connection for every request it proxies. With keepalive, it maintains a pool of 32 persistent connections to the backend, eliminating TCP handshake overhead.

**Failover (`proxy_next_upstream`):** If `api_1` returns a 502, 503, or 504, Nginx automatically retries the request on `api_2` (up to 3 attempts). The client never sees the error unless ALL instances fail.

---

## 15. GitHub Actions CI/CD

### CI Pipeline (`.github/workflows/ci.yml`) — runs on every PR and push

```
Install deps → Prisma generate → Lint → Typecheck → Unit tests (with Postgres + Redis service containers) → Build → Docker build
```

### CD Pipeline (`.github/workflows/cd.yml`) — runs on push to `main`

```
Run full CI checks → Build Docker image → Push to GitHub Container Registry (GHCR) → SSH deploy to production server (if DEPLOY_HOST secret is set)
```

**Key design decision:** Secrets (`DEPLOY_HOST`, `DEPLOY_USER`, etc.) are bound to step-level `env:` variables and checked with `if: env.DEPLOY_HOST != ''`. This is because GitHub Actions runner context doesn't allow `secrets.*` in `if:` conditionals directly.

---

## 16. Load Testing

The load testing setup uses Autocannon ([`scripts/load-test.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/scripts/load-test.ts)) to benchmark the API through the Nginx load balancer.

**What the results demonstrate:**
- The system scales from ~2,800 req/s at 10 concurrent connections to ~4,600 req/s at 100 concurrent connections on the health endpoint.
- Redis-cached endpoints (`/projects`) achieve 2x higher throughput than PostgreSQL aggregation endpoints (`/dashboard`).
- Zero 5xx errors across all concurrency levels — the system degrades gracefully under load.

**What the results do NOT demonstrate:** Production capacity. These numbers are from a local Docker environment. Real-world performance depends on network latency, cloud instance size, database IOPS, and actual query complexity.

---

## 17. How the System Can Horizontally Scale

The architecture is designed so that scaling is a configuration change, not a code change:

1. **Add more API instances** — Add `api_3`, `api_4`, etc. to `docker-compose.yml` and `nginx.conf`. No code changes. Works because the API is stateless (sessions in PostgreSQL, cache/rate-limits in Redis).
2. **Add more workers** — Run additional worker containers. BullMQ distributes jobs across workers automatically via Redis.
3. **Read replicas for PostgreSQL** — Prisma 7 supports read replicas. Route read-heavy queries (dashboard, activity log) to replicas.
4. **Redis Cluster** — Replace the single Redis instance with a Redis Cluster for higher throughput and availability.

**What would break:** The current `pg.Pool` configuration (`max: 20` per instance) means 10 API containers = 200 connections to PostgreSQL. You'd need to increase PostgreSQL's `max_connections` or add PgBouncer as a connection pooler.

---

## 18. Current Limitations and Potential Bottlenecks

| Limitation | Impact | Mitigation Path |
|:-----------|:-------|:----------------|
| **Dashboard queries hit PostgreSQL directly** | The dashboard runs 4-5 aggregation queries per request. Under high load, this stresses the database. | Add short-lived Redis caching (TTL: 10-30s) for dashboard summaries. |
| **Activity log is unbounded** | The `activity_logs` table grows forever. Over months/years, queries against it will slow down. | Implement time-based partitioning or archival to cold storage. |
| **Single PostgreSQL instance** | Single point of failure for data. | Add read replicas and automated backups. |
| **No WebSocket/SSE for notifications** | Clients must poll for new notifications. | Add a WebSocket gateway or Server-Sent Events endpoint. |
| **No file uploads** | Tasks and comments can't have attachments. | Add S3-compatible storage with pre-signed URLs. |
| **No email verification enforcement** | `isEmailVerified` field exists but isn't enforced in auth middleware. | Add a middleware that blocks unverified users from non-auth endpoints. |
| **Cache invalidation is manual** | Developers must remember to call `cache.del()` after mutations. Missing a call means stale data. | Consider event-driven invalidation or shorter TTLs. |

---

## 19. How This Could Evolve Into Microservices

The current monolith is well-structured for eventual decomposition:

| Current Module | Future Microservice | Communication |
|:---------------|:-------------------|:--------------|
| `auth` | **Auth Service** | JWT validation stays local (stateless). Token management becomes a gRPC/HTTP service. |
| `notifications` + BullMQ workers | **Notification Service** | Already decoupled via the job queue. The queue IS the service boundary. |
| `activity` | **Audit Service** | Already append-only. Could become an event consumer reading from a message broker (Kafka/RabbitMQ). |
| `dashboard` | **Analytics Service** | Could read from materialized views or a separate analytics database. |
| `organizations` + `projects` + `tasks` + `comments` | **Core Service** | The domain logic that stays together longest. Split only when team boundaries demand it. |

**When to split:** Not until you have 3+ teams needing independent deploy cycles, or a specific module needs different scaling characteristics (e.g., the notification service needs to handle 10x more throughput than the core API).

---

## 20. Future Integration Points [NOT IMPLEMENTED]

> **Everything below is planned architecture, not implemented code.**

### Google Calendar / Meet Integration
- **Where it would connect:** `TaskService.createTask()` and `TaskService.updateTask()` — when a task has a `dueDate`, create a Google Calendar event. When a task enters `IN_REVIEW`, auto-create a Google Meet link for the review meeting.
- **How:** OAuth 2.0 flow for Google, stored per-user. Google Calendar API v3 for events. Google Meet API for meeting links.
- **New module:** `src/modules/integrations/google/`

### WhatsApp Notifications
- **Where it would connect:** The existing `notification-queue`. Add a new worker that checks user preferences and sends WhatsApp messages via the WhatsApp Business API (or Twilio).
- **How:** New `whatsapp.worker.ts` consuming from the existing `notification-queue` or a dedicated `whatsapp-queue`.

### RAG (Retrieval-Augmented Generation) for Tasks
- **What it would do:** Allow natural-language search across tasks, comments, and activity logs. "Show me all overdue tasks assigned to Alice that were discussed last week."
- **Where it would connect:** A new `/api/v1/organizations/:orgId/search` endpoint backed by vector embeddings stored in pgvector (PostgreSQL extension) or a dedicated vector database.
- **Architecture:** Embed task titles/descriptions/comments → store vectors → on query, embed the question → cosine similarity search → feed results to an LLM as context.

### Agentic AI (Autonomous Task Management)
- **What it would do:** An AI agent that can be instructed in natural language: "Create a project called 'Q4 Launch', add 5 tasks for the marketing team, assign them based on workload, set priorities based on the deadline."
- **Where it would connect:** A new `/api/v1/organizations/:orgId/ai/agent` endpoint that receives natural language instructions, plans actions using the existing service layer, and executes them.
- **Architecture:** LLM with tool-calling capabilities where the "tools" are the existing service methods (`projectService.createProject()`, `taskService.createTask()`, etc.).

---

## How I Should Learn This Codebase

### Reading Order (Easiest → Most Complex)

**Phase 1: Understand the shape**
1. [`prisma/schema.prisma`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/prisma/schema.prisma) — Read the database schema. This tells you every entity, every relationship, and every constraint in the system.
2. [`src/config/env.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/config/env.ts) — See every configuration knob the system has.
3. [`src/utils/errors.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/errors.ts) and [`src/utils/response.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/response.ts) — Understand the error hierarchy and the consistent `{success, data, error}` response envelope.
4. [`src/constants/`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/constants) — Read all 4 files. These define every enum, role, status, and transition rule.

**Phase 2: Follow one request end-to-end**
5. [`src/app.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/app.ts) — See the middleware stack and route mounting. This is the "table of contents" for the API.
6. [`src/middlewares/request-id.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/request-id.middleware.ts) → [`auth.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/auth.middleware.ts) → [`authorization.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/authorization.middleware.ts) → [`validation.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/validation.middleware.ts) → [`error.middleware.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/middlewares/error.middleware.ts) — Read them in this order. This IS the request lifecycle.

**Phase 3: Understand authentication deeply**
7. [`src/utils/jwt.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/jwt.ts) and [`src/utils/password.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/password.ts) — The crypto primitives.
8. [`src/modules/auth/auth.schema.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.schema.ts) → [`auth.routes.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.routes.ts) → [`auth.controller.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.controller.ts) → [`auth.service.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.service.ts) → [`auth.repository.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/modules/auth/auth.repository.ts) — Follow the register flow from route to database.

**Phase 4: Understand one domain module fully**
9. Read the entire `tasks` module in this order: `task.schema.ts` → `task.routes.ts` → `task.controller.ts` → `task.service.ts` → `task.repository.ts` → `task.types.ts`. Tasks are the most complex module because they involve status transitions, assignment validation, notifications, and activity logging.

**Phase 5: Infrastructure**
10. [`src/config/database.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/config/database.ts) → [`src/config/redis.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/config/redis.ts) → [`src/utils/cache.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/utils/cache.ts) — Data infrastructure.
11. [`src/jobs/queues/queue.config.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/jobs/queues/queue.config.ts) → [`src/jobs/workers/index.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/jobs/workers/index.ts) → individual workers — Background job infrastructure.
12. [`src/server.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/src/server.ts) — The entrypoint with graceful shutdown logic.
13. [`Dockerfile`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/Dockerfile) → [`docker-compose.yml`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docker-compose.yml) → [`docker/nginx.conf`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/docker/nginx.conf) — Deployment infrastructure.

**Phase 6: Tests as documentation**
14. Read [`tests/integration/workflow.test.ts`](file:///c:/Users/Krishna/Desktop/3d-website/Expense_analyzer/tests/integration/workflow.test.ts) — This is a 12-step end-to-end test that exercises the entire system: register → create org → create project → create task → assign → transition status → comment → check notifications → check activity log → check dashboard.

---

## Interview-Level Questions

### Basic (Understanding the codebase)

1. **What does `sendSuccess(res, data, 201, 'Created')` produce?** Explain the exact JSON structure.
2. **Why does `auth.middleware.ts` split the Authorization header with `.split(/\s+/)` instead of `.split(' ')`?** What edge case does this handle?
3. **What is the difference between `AppError` with `isOperational: true` and `isOperational: false`?** How does `error.middleware.ts` treat each?
4. **Why does the `validateRequest` middleware use `Object.defineProperty` to reassign `req.query` instead of a simple assignment?**
5. **What are the 5 valid task statuses? Can a `DONE` task transition to `CANCELLED`?** (Answer: No. Check `VALID_STATUS_TRANSITIONS`.)

### Intermediate (Design decisions)

6. **Why is the refresh token stored as a SHA-256 hash in PostgreSQL instead of the raw JWT?**
7. **Why does the rate limiter use Redis `INCR` + `TTL` instead of a sorted set sliding window?** What's the trade-off?
8. **Why does `authorizeOrgRole` query the database on every request instead of caching the user's role in the JWT?** When would the cached approach break?
9. **Explain the cache invalidation strategy for projects.** Why does `delByPattern` use `SCAN` instead of `KEYS`?
10. **Why does the notification system use BullMQ instead of creating the notification row directly in the service?** When would the direct approach be acceptable?

### Advanced (Architecture)

11. **The refresh token rotation uses a `$transaction` to revoke the old session and create the new one. What happens if the transaction succeeds but the HTTP response fails (network error)?** Can the user recover?
12. **Two API instances share a Redis-backed rate limiter. A user sends 199 requests, then sends request 200 that hits `api_1` and request 201 that hits `api_2` at the exact same millisecond. Can both pass?** Explain the race condition and why `INCR` is atomic.
13. **The cleanup worker deletes expired sessions in batches of 500. Why not `DELETE FROM refresh_sessions WHERE expires_at < NOW()` in a single statement?**
14. **If you added a third API instance, what configuration files need to change? What application code needs to change?** (Answer: `nginx.conf` and `docker-compose.yml`. Zero application code.)
15. **The dashboard runs 5 parallel queries with `Promise.all`. If one query fails, what happens to the other 4?** What's the alternative?

### System Design Level

16. **Design the WebSocket notification system for this backend.** Where would the WebSocket server live? How would it know when a new notification is created? How would you handle 2 API instances both needing to push to the same connected client?
17. **This system uses a monolithic database. If the `activity_logs` table grows to 100 million rows and slows down every query, what are your options?** Compare: partitioning, archival, separate database, event streaming.
18. **If you had to add real-time collaborative editing of task descriptions (like Google Docs), how would you modify this architecture?** What new components would you need?
19. **The current rate limiter is per-IP. An attacker behind a corporate NAT shares an IP with 1000 employees. How would you redesign the rate limiter to handle this?**
20. **Design the agentic AI integration.** The AI should be able to: create projects, create tasks, assign tasks based on workload, and update task statuses — all via natural language. What safety mechanisms would you implement to prevent the AI from accidentally deleting production data?
