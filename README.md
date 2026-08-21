# Multi-Tenant Project Management SaaS Backend

A production-ready, multi-tenant project management SaaS backend built with Node.js, Express, PostgreSQL, Prisma, Redis, and BullMQ.

---

## 🚀 Key Features

- **Multi-Tenant Architecture**: Organization-scoped projects, tasks, comments, activity logs, and dashboard metrics with strict RBAC (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
- **Authentication & Security**:
  - JWT Bearer authentication with SHA-256 hashed refresh token rotation and session revocation.
  - Helmet security headers and strict CORS configuration.
  - Redis-backed distributed rate limiting (general API tier and sensitive authentication tier).
  - Secure HTTP-only cookies for refresh tokens.
  - Error response sanitization preventing production leak of stack traces or internals.
- **Asynchronous Background Processing (BullMQ & Redis)**:
  - **Email Service**: Nodemailer transport service with BullMQ queue dispatching and background worker.
  - **In-App Notifications**: Event-driven notifications (task assignments, status transitions, member additions, comments) persisted in PostgreSQL via BullMQ worker.
  - **Scheduled Cleanup**: Batched, idempotent background cleanup for expired/revoked sessions and stale read notifications.
- **High-Performance Caching**:
  - Transparent Redis caching for read-heavy project and organization queries with TTLs and automatic scan-and-delete invalidation on write/update mutations.
- **Dashboard & Analytics**:
  - PostgreSQL aggregation queries (`groupBy`, `count`) providing real-time metrics across projects, tasks, overdue workloads, activity feeds, and notifications.
- **Strict Validation & Typing**:
  - End-to-end Zod request schema validation (Express 5 compatible).
  - Strict TypeScript configuration.

---

## 🛠️ Technology Stack

- **Runtime & Language**: Node.js 22 + TypeScript 6
- **Web Framework**: Express 5
- **Database & ORM**: PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)
- **Cache & Infrastructure**: Redis (`ioredis`)
- **Job Queues & Workers**: BullMQ 6
- **Email Delivery**: Nodemailer
- **Testing**: Jest, ts-jest (`--experimental-vm-modules`), Supertest (212 passing integration & unit tests)
- **Logging**: Pino & `pino-http` with Request ID correlation

---

## 📖 API Documentation

- **Interactive OpenAPI 3.1.0 Specification**: [`docs/openapi.json`](./docs/openapi.json)
- **Complete Markdown API Reference**: [`docs/API_DOCUMENTATION.md`](./docs/API_DOCUMENTATION.md)
- **Project Architecture & Under-the-Hood Guide**: [`UNDERSTANDING.md`](./UNDERSTANDING.md)

---

## 🚦 Getting Started

### 1. Prerequisites
- Node.js >= 22.0.0
- PostgreSQL >= 15
- Redis >= 6.0

### 2. Environment Configuration
Copy `.env.example` to `.env` and fill in the values:
```bash
cp .env.example .env
```

### 3. Database Setup & Migration
```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4. Running the Application
```bash
# Start API development server
npm run dev

# Start background workers (standalone)
tsx src/jobs/workers/index.ts

# Production build & start
npm run build
npm start
```

### 5. Running Tests & Quality Checks
```bash
# Run all unit and integration tests (212 tests)
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint

# Format check
npm run format
```
