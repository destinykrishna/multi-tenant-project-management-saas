# Comprehensive Interview Master Guide — Multi-Tenant Project Management SaaS Backend

> **How to use this guide:** This document is engineered for tech interviews, system design discussions, and deep architectural understanding. After reading this, you will be able to explain the entire system, justify every technology choice ("Why X over Y?"), and answer any junior-to-staff level interview question on this project.

---

## Table of Contents

1. [30-Second & 2-Minute Project Elevator Pitches](#1-30-second--2-minute-project-elevator-pitches)
2. [Tech Stack Breakdown: Which Tech for Why? (Trade-offs & Alternatives)](#2-tech-stack-breakdown-which-tech-for-why-trade-offs--alternatives)
3. [End-to-End Request & Data Flow (Step-by-Step Execution)](#3-end-to-end-request--data-flow-step-by-step-execution)
4. [Core Architectural Subsystems & Deep Dives](#4-core-architectural-subsystems--deep-dives)
5. [Top 25 Interview Questions & Battle-Tested Answers](#5-top-25-interview-questions--battle-tested-answers)
6. [Failure Scenarios & Resilience Matrix](#6-failure-scenarios--resilience-matrix)

---

## 1. 30-Second & 2-Minute Project Elevator Pitches

### ⚡ 30-Second Pitch (Quick Summary)
> "I built a high-performance, multi-tenant project management SaaS backend in Node.js, TypeScript, PostgreSQL, and Redis. It enforces strict multi-tenancy with RBAC, RFC 6819 refresh token rotation, Redis-backed rate limiting, and asynchronous background processing using BullMQ queues for emails and notifications. The entire infrastructure is load-balanced via Nginx across stateless API instances in Docker, fully tested with 212 automated tests, and benchmarked at ~4,600 requests per second."

---

### 🎙️ 2-Minute Deep Pitch (System Overview)
> "My project is a production-ready multi-tenant SaaS backend for team project management — similar to a self-hosted Linear or Jira. 
>
> Architecturally, it’s built around **five core pillars**:
> 1. **Multi-Tenant Data Isolation & RBAC**: Every request is scoped by `organizationId`. We enforce role-based access (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) at both the middleware level and the Prisma ORM database query level to guarantee zero cross-tenant data leakage.
> 2. **Bank-Grade Authentication**: It implements JWT access tokens combined with SHA-256 hashed refresh tokens stored in PostgreSQL. It includes RFC 6819 token rotation with automatic reuse detection — if a revoked token is replayed, the system immediately invalidates all sessions for that user family.
> 3. **Async Background Architecture**: To keep HTTP responses under 15ms, we use BullMQ with Redis to process non-blocking background jobs for emails, in-app notifications, and scheduled database cleanups with exponential retry backoff.
> 4. **Resilient Caching & Security**: We implemented transparent read-through Redis caching for project queries with scan-and-del invalidation, distributed sliding-window rate limiting, and 8 security layers (Helmet, CORS, parameterization, error redaction).
> 5. **Containerized Infrastructure & CI/CD**: The system runs as stateless containers behind an Nginx reverse proxy with `least_conn` load balancing, fully automated via GitHub Actions for testing, Docker GHCR publishing, and deployment."

---

## 2. Tech Stack Breakdown: Which Tech for Why? (Trade-offs & Alternatives)

| Technology | Why We Used It (Benefits) | Alternatives Considered | Why We Rejected the Alternative |
|:---|:---|:---|:---|
| **Node.js 22 + Express 5** | Asynchronous non-blocking I/O event loop ideal for high-concurrency JSON APIs. Express 5 provides native promise error handling. | NestJS, Fastify, Go (Gin) | **Fastify/NestJS:** Great frameworks, but Express 5 is light, unopinionated, and universal. Express 5 natively handles rejected promises in async middleware without needing `express-async-errors`. |
| **TypeScript 6 (Strict)** | Compile-time type safety across database entities, Zod schemas, JWT payloads, and service interfaces. Eliminates `undefined is not a function` errors. | Plain JavaScript | Plain JS causes silent runtime crashes in multi-tenant authorization logic and payload validation. |
| **PostgreSQL 16** | ACID compliance, strong relational integrity, compound unique indexing, JSONB support for audit metadata, and complex aggregation capabilities. | MongoDB, MySQL, DynamoDB | **MongoDB:** Weak for complex relational joins (Users ↔ Members ↔ Orgs ↔ Projects ↔ Tasks). Relational schemas naturally prevent orphaned tasks or cross-tenant links via foreign keys. |
| **Prisma 7 (`@prisma/adapter-pg`)** | Full type-safety generated from schema, parameterized queries preventing SQL injection, automatic migrations, and Prisma 7 driver adapter pattern. | TypeORM, Sequelize, Kysely/Knex | **TypeORM/Sequelize:** Prone to legacy ORM bugs and weak TypeScript inference. **Prisma 7 Adapter:** Gives direct control over `pg.Pool` connection pool sizing instead of relying on an opaque Rust engine binary. |
| **Redis 7 (`ioredis`)** | In-memory key-value store for sub-millisecond read caching, atomic pipeline execution for rate limiting (`INCR` + `TTL`), and message broker for BullMQ. | Memcached, RabbitMQ | **Memcached:** Lacks data structures (sorted sets, hashes) required by BullMQ. **RabbitMQ:** Overkill for lightweight background queuing when Redis is already used for caching. |
| **BullMQ 6** | Robust Node.js job queue library built on Redis. Supports delayed jobs, exponential backoff retries, repeatable cron schedules, and job retention policies. | Agenda, Kue, AWS SQS | **Agenda:** Uses MongoDB polling (slow). **AWS SQS:** Locks you into AWS cloud infrastructure; BullMQ runs locally in Docker and cloud identically. |
| **Nginx 1.27 Alpine** | Industry-standard reverse proxy, SSL termination gateway, static compression (Gzip), security header enforcement, and `least_conn` load balancing. | HAProxy, Traefik | **HAProxy:** Excellent, but Nginx is simpler for serving static assets, headers, and rate-limit buffering simultaneously. |
| **Zod 4** | Infer TypeScript types directly from runtime validation schemas. Validates `req.body`, `req.params`, and `req.query` before controller execution. | Joi, Yup, Ajv | **Joi/Yup:** Weak TypeScript type inference. Zod provides 1-to-1 matching between runtime runtime parsers and compile-time TS types (`z.infer<typeof schema>`). |
| **Pino Logger** | Low-overhead JSON logger (up to 5x faster than Winston). Integrates with `pino-http` for UUID `x-request-id` tracking across all log statements. | Winston, Bunyan | **Winston:** Synchronous formatting bottlenecks event loop under heavy load (~4,000 req/sec). Pino logs asynchronously with minimal CPU overhead. |

---

## 3. End-to-End Request & Data Flow (Step-by-Step Execution)

Here is the exact path of an HTTP request (e.g., `POST /api/v1/organizations/org-123/projects/proj-456/tasks`):

```
Client HTTP Request
       │
       ▼
1. Nginx Reverse Proxy (Port 80)
   ├── Hides backend IP, handles client max body size (10MB)
   └── Proxies request using least_conn algorithm to api_1 or api_2 container
       │
       ▼
2. Express Security & Parsing Middleware
   ├── helmet(): Injects 11 security headers (CSP, HSTS, X-Frame-Options)
   ├── cors(): Validates CORS origin against whitelist
   ├── express.json({ limit: '10mb' }): Parses JSON body
   └── requestIdMiddleware: Generates or attaches X-Request-ID (UUID) for tracing
       │
       ▼
3. Redis Rate Limiter Middleware (createRateLimiter)
   ├── Executes Redis pipeline: INCR ratelimit:gen:{ip} + TTL check
   └── If count > 200/min → Returns 429 Too Many Requests. Else → next()
       │
       ▼
4. Authentication Middleware (authenticate)
   ├── Extracts Bearer JWT token from Authorization header
   ├── Verifies cryptographic signature using JWT_SECRET
   └── Attaches user payload to req.user = { id, email }
       │
       ▼
5. Authorization Middleware (authorizeOrgRole)
   ├── Extracts organizationId (org-123) from req.params
   ├── Queries DB: SELECT * FROM organization_members WHERE organizationId = ? AND userId = ?
   ├── Verifies user role (e.g. MEMBER) meets route requirement
   └── Attaches req.membership = { organizationId, role }. If unauthorized → 403 Forbidden
       │
       ▼
6. Validation Middleware (validateRequest)
   ├── Runs Zod schema validation against req.body, req.params, and req.query
   └── If invalid → Returns 422 Unprocessable Entity with error details. Else → next()
       │
       ▼
7. TaskController (task.controller.ts)
   └── Calls TaskService.createTask(orgId, projId, userId, payload)
       │
       ▼
8. TaskService (task.service.ts — Business Logic)
   ├── Validates Project exists within Organization (Tenant boundary check)
   ├── Validates Assignee is an active member of Organization
   ├── Calls TaskRepository.createTask() → Prisma ORM inserts into PostgreSQL
   ├── Logs activity asynchronously via ActivityService
   └── Dispatches notification job via BullMQ notificationQueue.add()
       │
       ▼
9. Response Delivery (sendSuccess)
   └── Formats response into uniform envelope: { success: true, data: task } with 201 Created
```

---

## 4. Core Architectural Subsystems & Deep Dives

### A. Authentication & Refresh Token Rotation (RFC 6819)
- **Short-Lived Access Token:** Signed JWT (15-min expiry) passed in `Authorization: Bearer <token>`.
- **Long-Lived Refresh Token:** Signed JWT (7-day expiry) sent as an `HttpOnly`, `SameSite=Lax`, `Secure` cookie.
- **Hashed Session Storage:** The raw refresh token is NEVER saved in the database. Only `sha256(refreshToken)` is stored in `refresh_sessions`. If the database is leaked, attackers cannot use the hashes to generate tokens.
- **Automatic Reuse Detection:** When a refresh token is presented:
  1. We verify its JWT signature and compute its SHA-256 hash.
  2. We query `refresh_sessions`. If `revokedAt != null` (meaning an old, already-rotated token was replayed), **we immediately execute `revokeAllUserSessions(userId)`**.
  3. Every active session for that user is instantly revoked, forcing re-authentication across all devices and blocking replay attacks.

---

### B. Multi-Tenancy & Authorization Hierarchy
- **Tenant Boundary:** The `Organization` entity is the root isolation boundary.
- **Database Schema Level:** `organizationId` is enforced on `organization_members`, `projects`, `activity_logs`, and `notifications`.
- **Middleware Level:** `authorizeOrgRole([allowedRoles])` intercepts requests BEFORE controller execution, performing a database lookup on `organization_members` to ensure `(organizationId, userId)` exists and holds necessary permissions (`OWNER` > `ADMIN` > `MEMBER` > `VIEWER`).
- **Query Level:** Every repository method includes `WHERE organizationId = req.membership.organizationId` as a secondary safeguard against IDOR / BOLA attacks.

---

### C. Asynchronous Processing & Background Workers (BullMQ + Redis)
- **Problem:** Sending SMTP emails or inserting activity/notification logs synchronously adds 200ms–5000ms latency to HTTP requests.
- **Solution:** HTTP handlers enqueue lightweight JSON jobs to BullMQ queues stored in Redis (`email-queue`, `notification-queue`, `cleanup-queue`) and return a response in < 15ms.
- **Worker Daemon (`workers` container):** Runs as an independent process consuming jobs asynchronously:
  - `EmailWorker` (concurrency: 5): Sends emails via Nodemailer with exponential backoff (1s, 2s, 4s).
  - `NotificationWorker` (concurrency: 10): Inserts in-app notifications into PostgreSQL.
  - `CleanupWorker` (cron every 6h): Batched, idempotent removal of expired/revoked sessions and 30-day-old notifications.

---

### D. Read-Through Caching & Invalidation Strategy
- **Pattern:** Read-Through Cache via `CacheService.getOrSet(key, fetcher, ttl)`.
- **Flow:**
  1. Check Redis for `org:{orgId}:projects:{hash}`.
  2. **Cache Hit:** Return parsed JSON immediately (skips DB).
  3. **Cache Miss:** Execute `fetcher()` (Prisma query), store result in Redis with TTL (120s), and return data.
- **Active Invalidation:** On write operations (Create/Update/Delete project), the service triggers `cache.delByPattern("org:{orgId}:*")` using non-blocking Redis `SCAN` + `DEL` to ensure stale data is never served.
- **Resilience (Fail-Open):** If Redis goes down, `CacheService` catches the exception, logs a warning, and falls back to PostgreSQL seamlessly.

---

## 5. Top 25 Interview Questions & Battle-Tested Answers

### 🟢 Junior / Fundamental Questions

#### Q1: "Tell me about the architecture of your application."
> **Answer:** It's a containerized, multi-tenant REST API built on Node.js 22, Express 5, PostgreSQL, and Redis. It uses Nginx as a reverse proxy load-balancing between two stateless Express API containers. Business logic is organized into 8 domain modules following a strict layered structure (Routes → Middlewares → Controller → Service → Repository → Prisma). Asynchronous tasks like emails and notifications are handled out-of-band by BullMQ background workers.

#### Q2: "Why did you use TypeScript instead of plain JavaScript?"
> **Answer:** TypeScript gives us compile-time type safety across our layered architecture. For example, Prisma generates TypeScript interfaces directly from `schema.prisma`, Zod infers runtime request payload types, and services consume typed objects. This eliminates entire classes of runtime errors like `Cannot read property of undefined` or misnamed database fields.

#### Q3: "What is the difference between Authentication and Authorization in your system?"
> **Answer:** Authentication verifies *who you are* via JWT tokens in `auth.middleware.ts`. Authorization verifies *what you are allowed to do* inside a specific organization via `authorization.middleware.ts`, which checks your role (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) against `organization_members`.

#### Q4: "How do you handle input validation?"
> **Answer:** We use Zod schemas attached to a generic `validateRequest` middleware. It validates `req.body`, `req.params`, and `req.query` against defined schemas before controller logic executes. If validation fails, it returns a standardized `422 Unprocessable Entity` response with field-specific error messages.

#### Q5: "What HTTP status codes does your API return and when?"
> **Answer:** We strictly follow HTTP semantics:
> - `200 OK`: Successful reads/updates.
> - `201 Created`: Entity creation.
> - `400 Bad Request`: Business rule / state machine violations.
> - `401 Unauthorized`: Missing/expired JWT or invalid credentials.
> - `403 Forbidden`: Insufficient RBAC role or cross-tenant access attempt.
> - `404 Not Found`: Resource does not exist.
> - `409 Conflict`: Duplicate registration email or org slug.
> - `422 Unprocessable Entity`: Zod validation errors.
> - `429 Too Many Requests`: Redis rate limit exceeded.
> - `500 Internal Server Error`: Uncaught internal failures (sanitized in production).

---

### 🟡 Intermediate / Architectural Questions

#### Q6: "How do you enforce Multi-Tenancy and prevent Cross-Tenant Data Leakage?"
> **Answer:** Multi-tenancy is enforced in depth:
> 1. Every tenant route is prefixed with `/organizations/:organizationId`.
> 2. `authorizeOrgRole` middleware verifies that `(organizationId, req.user.id)` exists in the database.
> 3. Every single Prisma repository query explicitly includes `WHERE organizationId = ?`. Even if a user knows a valid `projectId` belonging to another organization, the query will return `null` because the `organizationId` filter fails.

#### Q7: "Explain your Refresh Token Rotation and Reuse Detection mechanism."
> **Answer:** When a user refreshes their token via `POST /auth/refresh`, we verify the refresh token cookie, compute its SHA-256 hash, and lookup the session in `refresh_sessions`. 
> - If valid, we issue a new access token and a new refresh token, revoking the old session in a single database transaction.
> - If the token has *already* been revoked (replayed by an attacker), our RFC 6819 reuse detection triggers: it immediately revokes ALL active sessions for that user ID. This logs out the legitimate user and invalidates all stolen tokens across all devices.

#### Q8: "Why do you store Refresh Tokens as SHA-256 hashes instead of raw strings?"
> **Answer:** If our database is ever compromised or exposed via a backup leak, raw refresh tokens would allow an attacker to hijack user sessions. Storing `sha256(refreshToken)` ensures that database hashes cannot be reversed or used as valid HTTP cookies.

#### Q9: "Why did you use Prisma 7 with `@prisma/adapter-pg` instead of standard Prisma?"
> **Answer:** Prisma 7 introduced driver adapters, removing the opaque Rust query engine binary and allowing us to pass a native `pg.Pool` instance directly to Prisma. This gives us explicit control over database connection pool limits (`max: 20`), connection timeouts, idle timeouts, and SSL parameters.

#### Q10: "How does your caching strategy work? How do you prevent stale cache data?"
> **Answer:** We use a Read-Through cache via `CacheService.getOrSet()`. When fetching project listings, we check Redis key `org:{orgId}:projects:{hash}`. If missing, we query PostgreSQL and set a 120-second TTL. To prevent stale data, whenever a project is created, updated, or deleted, we execute active invalidation using `cache.delByPattern("org:{orgId}:*")` (which uses non-blocking Redis `SCAN` + `DEL`).

#### Q11: "What happens if Redis goes down? Does the application crash?"
> **Answer:** No. Every Redis interaction is designed with a **fail-open strategy**:
> - **Rate Limiting:** Catches Redis errors, logs a warning, and calls `next()` to allow HTTP traffic through.
> - **Caching:** Catches Redis errors, logs a warning, and falls back directly to PostgreSQL.
> - The application degrades gracefully in performance rather than suffering complete service outage.

#### Q12: "Why do you use BullMQ for notifications instead of writing directly to PostgreSQL?"
> **Answer:** Writing notifications directly in the main request handler blocks the HTTP response while doing database writes for multiple recipient users. With BullMQ, `taskService.createTask()` adds a lightweight job to `notificationQueue` in Redis and returns `201 Created` in under 15ms. The `NotificationWorker` processes jobs asynchronously with automatic retry backoff if the database is busy.

#### Q13: "How does Nginx load-balance between your API containers?"
> **Answer:** Nginx uses the `least_conn` directive in its `upstream api_cluster` block. Instead of simple round-robin, it routes incoming requests to the API container with the fewest active connections. It also configures `keepalive 32` for persistent TCP connections and `proxy_next_upstream` to automatically retry failed requests on another container if one returns 502/503/504.

#### Q14: "Why do you use `dumb-init` in your Dockerfile?"
> **Answer:** In Docker, Node.js runs as PID 1 by default. Node.js is not designed to act as an init system and does not forward Linux signals (like `SIGTERM` or `SIGINT`) properly to child processes. `dumb-init` acts as a minimal PID 1 process that correctly proxies signals, allowing Express and database pools to execute graceful shutdown logic.

#### Q15: "Why does your Docker container run as a non-root user?"
> **Answer:** By default, Docker containers run as `root`. If an application vulnerability allowed remote code execution, the attacker would have root privileges inside the container. We add `USER node` to our Dockerfile so the process runs under an unprivileged user (UID 1000), drastically reducing the blast radius of container breakouts.

---

### 🔴 Advanced / Staff & System Design Questions

#### Q16: "How does your system handle database connection pool exhaustion under heavy traffic?"
> **Answer:** Each API container configures a `pg.Pool` with `max: 20` connections. Across 2 API instances, maximum concurrent database connections are capped at 40 (well below PostgreSQL's default `max_connections = 100`). If connections are briefly exhausted, `pg.Pool` queues incoming queries up to a 5-second `connectionTimeoutMillis`. For massive scale (>10 API instances), we would introduce **PgBouncer** as a transaction-level connection pooler in front of PostgreSQL.

#### Q17: "How do you handle race conditions during token refresh requests sent simultaneously from multiple browser tabs?"
> **Answer:** If two tabs refresh at the exact same millisecond:
> 1. We execute the session rotation inside a Prisma `$transaction` with row-level locking.
> 2. The first request acquires the lock, revokes the current session, and creates the new session.
> 3. The second request attempts to read the session, finds `revokedAt != null`, but within a 10-second grace window, we can identify concurrent tab rotation vs an actual replay attack before triggering full user account lockouts.

#### Q18: "How does Express know the real client IP behind Nginx for rate limiting?"
> **Answer:** We configure `app.set('trust proxy', 1)` in Express and set `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` in Nginx. Express reads the IP from the first entry in the `X-Forwarded-For` header. Without `trust proxy`, every request would appear to originate from Nginx's internal Docker IP (`172.x.x.x`), causing rate limiting to block all users globally!

#### Q19: "How would you scale this backend from 5,000 requests/sec to 100,000 requests/sec?"
> **Answer:**
> 1. **Stateless API Layer:** Spin up 10–20 API replicas behind Cloud Load Balancers (AWS ALB). Since Express API instances hold no local state, scaling is trivial.
> 2. **Database Layer:** Implement PostgreSQL **Read Replicas** for read-heavy operations (`GET /projects`, `GET /dashboard`), reserving the Primary database for writes. Introduce **PgBouncer** for connection pooling.
> 3. **Caching Layer:** Upgrade single Redis to a **Redis Cluster** with read replicas. Add short 10s caching for dashboard aggregation endpoints.
> 4. **Database Partitioning:** Range-partition `activity_logs` and `notifications` by month to keep index sizes small.

#### Q20: "How would you implement Real-Time Notifications using WebSockets while keeping the API stateless?"
> **Answer:** We would deploy a dedicated **WebSocket Gateway** service. When `NotificationWorker` inserts a notification into PostgreSQL, it publishes an event to a **Redis Pub/Sub** channel (`notifications:user:{userId}`). All WebSocket server instances subscribe to Redis Pub/Sub. Whichever WebSocket node holds the active connection for that user receives the event and pushes it to the client in real-time.

---

### 🔮 Future Architecture & Feature Extension Questions

#### Q21: "How would you design the Google Calendar & Meet integration?"
> **Answer:**
> 1. **OAuth 2.0:** Store encrypted user Google refresh tokens in a `user_integrations` table.
> 2. **Hooks:** In `TaskService.createTask()` and `updateTask()`, if a task has a `dueDate` or enters `IN_REVIEW`, enqueue a job to a new `google-calendar-queue`.
> 3. **Worker:** A `GoogleIntegrationWorker` uses the Google Calendar API v3 to create an event and generate a Google Meet link, updating the task's `metadata` column in PostgreSQL.

#### Q22: "How would you implement RAG (Retrieval-Augmented Generation) search across tasks and comments?"
> **Answer:**
> 1. **Embeddings:** When tasks or comments are created/updated, enqueue a job to generate text embeddings using OpenAI `text-embedding-3-small` or Vertex AI.
> 2. **Vector Storage:** Store 1536-dimensional vectors in PostgreSQL using the `pgvector` extension, indexed with HNSW.
> 3. **Search Endpoint:** `GET /search?q=query` converts the user query to a vector, runs cosine distance search filtered by `organizationId`, and feeds top matches as context to an LLM.

#### Q23: "How would you design an AI Agent capable of creating tasks via natural language?"
> **Answer:**
> - Expose a `/ai/agent` endpoint taking natural language prompt (e.g. *"Schedule a code review next Tuesday for Bob"*).
> - Use Function Calling / Tool Calling with an LLM (Gemini / GPT-4o) where available tools are typed JSON schemas mapping directly to existing service methods (`createTask`, `findMembers`).
> - **Security Boundary:** The AI agent executes WITHIN the authenticated user's session context — it cannot perform actions forbidden by the user's RBAC role.

#### Q24: "What is your testing strategy for this application?"
> **Answer:** We have 212 automated tests across unit and integration suites. Unit tests isolate utilities (password hashing, JWT verification). Integration tests use Supertest against live PostgreSQL and Redis Docker service containers to verify routes, RBAC permission checks, database migrations, rate limiting, and BullMQ worker execution.

#### Q25: "What are the remaining security or technical debt items in this project?"
> **Answer:**
> 1. **L7 Volumetric DDoS:** In-app Redis rate limiting protects against basic flooding, but network-level DDoS requires Cloudflare/AWS WAF.
> 2. **HTML Content Sanitization:** Raw text in task comments is stored as-is; frontend UI clients must sanitize output using DOMPurify before rendering to prevent stored XSS.
> 3. **Email Verification:** `isEmailVerified` exists in the database schema but is optional during development; production should enforce an `emailVerifiedMiddleware`.

---

## 6. Failure Scenarios & Resilience Matrix

| Component Failure | Immediate Impact | System Behavior & Mitigation |
|:---|:---|:---|
| **One API Container Crashes** | 0% downtime | Nginx `least_conn` automatically shifts 100% of incoming traffic to the healthy API container. `proxy_next_upstream` retries any in-flight requests seamless to the client. |
| **Redis Crashes** | Rate limiting & Caching disabled | **Fail-Open Strategy:** Rate limiters allow requests through; CacheService logs warning and falls back directly to PostgreSQL. BullMQ queue processing pauses until Redis recovers. |
| **PostgreSQL Connection Spike** | Queries queue briefly | `pg.Pool` queues up to 20 connections per container with 5s timeout. Nginx buffers client requests. |
| **Worker Container Crashes** | HTTP API unaffected | HTTP responses remain fast (<15ms). Enqueued BullMQ jobs accumulate safely in Redis until the worker container auto-restarts. |
| **Stolen Refresh Token Replayed** | Potential hijacking attempt | **RFC 6819 Reuse Detection:** System detects attempt to use revoked session hash, immediately invalidates ALL sessions for that user ID, and forces full re-authentication. |
