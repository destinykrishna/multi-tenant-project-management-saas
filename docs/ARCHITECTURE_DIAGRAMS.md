# Architecture Diagram Pack — Multi-Tenant Project Management SaaS Backend

> All diagrams below reflect the **actual implementation** unless explicitly marked **[FUTURE / NOT IMPLEMENTED]**.
> Every component name maps to a real file, container, or service in this repository.

---

## Diagram Index

| # | Diagram | Status |
|:-:|:--------|:------:|
| [1](#1-high-level-system-architecture) | High-Level System Architecture | ✅ Implemented |
| [2](#2-request-lifecycle) | Request Lifecycle | ✅ Implemented |
| [3](#3-authentication-flow) | Authentication Flow | ✅ Implemented |
| [4](#4-multi-tenancy--rbac) | Multi-Tenancy + RBAC | ✅ Implemented |
| [5](#5-database-relationship-diagram) | Database ER Diagram | ✅ Implemented |
| [6](#6-redis-cache-flow) | Redis Cache Flow | ✅ Implemented |
| [7](#7-bullmq-architecture) | BullMQ Architecture | ✅ Implemented |
| [8](#8-email-flow) | Email Flow | ✅ Implemented |
| [9](#9-notification-flow) | Notification Flow | ✅ Implemented |
| [10](#10-nginx-load-balancing) | Nginx Load Balancing | ✅ Implemented |
| [11](#11-deployment-architecture) | Deployment Architecture | ✅ Implemented |
| [12](#12-task-creation-sequence) | Task Creation Sequence | ✅ Implemented |
| [13](#13-refresh-token-rotation-sequence) | Refresh Token Rotation Sequence | ✅ Implemented |
| [14](#14-cicd-architecture) | CI/CD Architecture | ✅ Implemented |
| [15](#15-load-testing-architecture) | Load Testing Architecture | ✅ Implemented |
| [16](#16-security-architecture) | Security Architecture | ✅ Implemented |
| [17](#17-future-google-integration) | Google Calendar / Meet Integration | 🔮 Future |
| [18](#18-future-rag--ai-architecture) | RAG / AI Architecture | 🔮 Future |
| [19](#19-future-agentic-meeting-workflow) | Agentic Meeting Workflow | 🔮 Future |

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph External
        FE["React Frontend<br/>(Future Client)"]
    end

    subgraph Public Gateway
        NG["Nginx 1.27 Alpine<br/>Reverse Proxy / Load Balancer<br/>Port 80"]
    end

    subgraph Application Tier
        API1["API Instance 1<br/>Node.js 22 · Express 5<br/>Port 5000"]
        API2["API Instance 2<br/>Node.js 22 · Express 5<br/>Port 5000"]
    end

    subgraph Background Workers
        WK["BullMQ Worker Daemon"]
        EW["Email Worker"]
        NW["Notification Worker"]
        CW["Cleanup Worker"]
    end

    subgraph Data Tier
        PG["PostgreSQL 16<br/>Primary Database"]
        RD["Redis 7<br/>Cache · Rate Limiting · Queue Broker"]
    end

    FE -->|HTTP| NG
    NG -->|least_conn| API1
    NG -->|least_conn| API2

    API1 --> PG
    API2 --> PG
    API1 --> RD
    API2 --> RD

    API1 -.->|enqueue jobs| RD
    API2 -.->|enqueue jobs| RD

    WK --- EW
    WK --- NW
    WK --- CW

    RD -.->|dequeue jobs| WK
    EW -->|SMTP| SMTP["Email Server"]
    NW --> PG
    CW --> PG

    style NG fill:#0d6efd,color:#fff
    style PG fill:#336791,color:#fff
    style RD fill:#dc382d,color:#fff
```

The system is a multi-container Docker Compose deployment. Nginx is the only public entry point. PostgreSQL and Redis have no exposed ports — they live on an internal bridge network (`expense_network`). The React frontend does not exist yet but represents the intended client.

---

## 2. Request Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant N as Nginx
    participant H as helmet()
    participant CO as cors()
    participant RI as requestIdMiddleware
    participant RL as rateLimiter<br/>(Redis)
    participant AU as authenticate<br/>(JWT)
    participant AZ as authorizeOrgRole<br/>(RBAC)
    participant VL as validateRequest<br/>(Zod)
    participant CT as Controller
    participant SV as Service
    participant RP as Repository
    participant PR as Prisma
    participant PG as PostgreSQL
    participant EH as errorHandler

    C->>N: HTTP Request
    N->>H: Proxy to Express
    H->>CO: Security headers set
    CO->>RI: CORS validated
    RI->>RL: X-Request-ID assigned
    RL->>RL: Redis INCR + TTL check
    alt Over limit
        RL-->>C: 429 Too Many Requests
    end
    RL->>AU: Pass
    AU->>AU: Verify Bearer JWT
    alt Invalid / Expired
        AU-->>C: 401 Unauthorized
    end
    AU->>AZ: req.user set
    AZ->>AZ: Query OrganizationMember
    alt Not member / Wrong role
        AZ-->>C: 403 Forbidden
    end
    AZ->>VL: req.membership set
    VL->>VL: Zod parse body/params/query
    alt Validation failed
        VL-->>C: 422 Validation Error
    end
    VL->>CT: Validated input
    CT->>SV: Business method call
    SV->>RP: Data access call
    RP->>PR: Prisma query
    PR->>PG: SQL via pg.Pool
    PG-->>PR: Result rows
    PR-->>RP: Typed result
    RP-->>SV: Data
    SV-->>CT: Business response
    CT-->>C: sendSuccess(res, data)

    Note over CT,EH: If any layer throws
    CT->>EH: Error caught
    EH-->>C: Structured JSON error
```

This is the exact middleware execution order defined in `app.ts`. Rate limiting uses Redis and runs before authentication to block brute-force attempts regardless of token validity.

---

## 3. Authentication Flow

```mermaid
graph TD
    subgraph Register
        R1["POST /api/v1/auth/register"] --> R2["Validate input (Zod)"]
        R2 --> R3["Check email uniqueness"]
        R3 --> R4["bcrypt.hash(password, 12)"]
        R4 --> R5["Generate UUID + Access Token + Refresh Token"]
        R5 --> R6["sha256(refreshToken) → tokenHash"]
        R6 --> R7["$transaction:<br/>Create User + Org + OrgMember(OWNER) + RefreshSession"]
        R7 --> R8["Set-Cookie: refreshToken (HttpOnly)"]
        R8 --> R9["201 Response: accessToken + user + org"]
    end

    subgraph Login
        L1["POST /api/v1/auth/login"] --> L2["Find user by email"]
        L2 --> L3["bcrypt.compare(password, hash)"]
        L3 --> L4["Generate new Access + Refresh tokens"]
        L4 --> L5["Create RefreshSession (tokenHash)"]
        L5 --> L6["Set-Cookie + 200 Response"]
    end

    subgraph Refresh
        F1["POST /api/v1/auth/refresh"] --> F2["Read cookie: refreshToken"]
        F2 --> F3["jwt.verify(token, JWT_REFRESH_SECRET)"]
        F3 --> F4["sha256(token) → find RefreshSession"]
        F4 --> F5{"Session revoked?"}
        F5 -->|Yes| F6["⚠ REVOKE ALL user sessions<br/>(Reuse Detection / RFC 6819)"]
        F6 --> F7["401 TOKEN_REVOKED"]
        F5 -->|No| F8{"Session expired?"}
        F8 -->|Yes| F9["401 TOKEN_EXPIRED"]
        F8 -->|No| F10["Generate new Access + Refresh tokens"]
        F10 --> F11["$transaction: revoke old + create new session"]
        F11 --> F12["New Set-Cookie + 200 Response"]
    end

    subgraph Logout
        O1["POST /api/v1/auth/logout"] --> O2["sha256(cookie) → tokenHash"]
        O2 --> O3["Set revokedAt = now()"]
        O3 --> O4["Clear-Cookie + 200 Response"]
    end

    style F6 fill:#e74c3c,color:#fff
    style F7 fill:#e74c3c,color:#fff
```

Token rotation is atomic via `prisma.$transaction`. Reuse detection (when a revoked token is replayed) revokes ALL sessions for that user, forcing re-authentication on every device.

---

## 4. Multi-Tenancy + RBAC

```mermaid
graph LR
    subgraph Authentication Layer
        JWT["JWT Bearer Token<br/>→ req.user.id"]
    end

    subgraph Authorization Layer
        AUTH["authorizeOrgRole()"]
        AUTH -->|Query| OM["OrganizationMember<br/>unique(orgId, userId)"]
        OM -->|Found| ROLE{"Role Check"}
        OM -->|Not Found| DENY1["403 NOT_AN_ORGANIZATION_MEMBER"]
        ROLE -->|Allowed| ATTACH["req.membership = { role }"]
        ROLE -->|Denied| DENY2["403 INSUFFICIENT_PERMISSIONS"]
    end

    subgraph Tenant-Scoped Data
        ORG["Organization A"]
        ORG --> P1["Project 1"]
        ORG --> P2["Project 2"]
        P1 --> T1["Task 1"]
        P1 --> T2["Task 2"]
        T1 --> C1["Comment"]
        ORG --> AL["ActivityLog"]
        ORG --> NF["Notifications"]
    end

    subgraph "Role Matrix"
        RM["OWNER → full control<br/>ADMIN → manage members + resources<br/>MEMBER → create/edit resources<br/>VIEWER → read-only"]
    end

    JWT --> AUTH
    ATTACH --> ORG

    style DENY1 fill:#e74c3c,color:#fff
    style DENY2 fill:#e74c3c,color:#fff
    style ORG fill:#1a1a2e,color:#fff
```

Every route under `/api/v1/organizations/:organizationId/...` enforces tenant isolation at the middleware level. The `organizationId` is extracted from `req.params` and checked against the `organization_members` table before any controller code executes. Every repository query also includes `WHERE organizationId = ...` as a secondary safeguard.

---

## 5. Database Relationship Diagram

```mermaid
erDiagram
    User {
        uuid id PK
        string name
        string email UK
        string passwordHash
        string avatarUrl
        boolean isEmailVerified
        datetime createdAt
        datetime updatedAt
    }

    RefreshSession {
        uuid id PK
        uuid userId FK
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt
        string userAgent
        string ipAddress
        datetime createdAt
    }

    Organization {
        uuid id PK
        string name
        string slug UK
        uuid ownerId FK
        datetime createdAt
        datetime updatedAt
    }

    OrganizationMember {
        uuid id PK
        uuid organizationId FK
        uuid userId FK
        enum role
        datetime createdAt
    }

    Project {
        uuid id PK
        uuid organizationId FK
        string name
        string key
        string description
        enum status
        uuid createdById FK
        datetime createdAt
    }

    Task {
        uuid id PK
        uuid projectId FK
        string title
        string description
        enum status
        enum priority
        uuid assigneeId FK
        uuid createdById FK
        datetime dueDate
        float position
    }

    Comment {
        uuid id PK
        uuid taskId FK
        uuid userId FK
        string content
        datetime createdAt
        datetime updatedAt
    }

    ActivityLog {
        uuid id PK
        uuid organizationId FK
        uuid userId FK
        enum entityType
        string entityId
        enum action
        json metadata
        datetime createdAt
    }

    Notification {
        uuid id PK
        uuid userId FK
        uuid organizationId FK
        enum type
        string title
        string message
        json metadata
        boolean isRead
        datetime createdAt
    }

    User ||--o{ RefreshSession : "has sessions"
    User ||--o{ OrganizationMember : "belongs to orgs"
    User ||--o{ Organization : "owns"
    User ||--o{ Project : "created"
    User ||--o{ Task : "created"
    User ||--o{ Task : "assigned to"
    User ||--o{ Comment : "wrote"
    User ||--o{ ActivityLog : "performed"
    User ||--o{ Notification : "receives"

    Organization ||--o{ OrganizationMember : "has members"
    Organization ||--o{ Project : "contains"
    Organization ||--o{ ActivityLog : "tracks"
    Organization ||--o{ Notification : "scoped to"

    OrganizationMember }o--|| User : "user"
    OrganizationMember }o--|| Organization : "organization"

    Project ||--o{ Task : "has tasks"
    Project }o--|| Organization : "in org"

    Task ||--o{ Comment : "has comments"
    Task }o--|| Project : "in project"
```

All IDs are UUIDs. Compound unique constraints: `(organizationId, userId)` on members, `(organizationId, key)` on projects. Cascade deletes flow from Organization → Members/Projects → Tasks → Comments.

---

## 6. Redis Cache Flow

```mermaid
flowchart TB
    REQ["Incoming API Request<br/>(e.g. GET /projects)"] --> CL["CacheService.getOrSet(key, fetcher, ttl)"]

    CL --> CHECK{"Redis GET key"}

    CHECK -->|HIT| HIT["Return cached JSON<br/>(skip database)"]
    HIT --> RES["API Response"]

    CHECK -->|MISS| MISS["Call fetcher()"]
    MISS --> PG["Prisma → PostgreSQL query"]
    PG --> STORE["Redis SETEX key data ttl"]
    STORE --> RES

    subgraph "Cache Keys (Actual)"
        K1["org:{orgId}:projects:{queryHash}<br/>TTL: 120s"]
        K2["org:{orgId}:project:{projectId}<br/>TTL: 300s"]
    end

    subgraph "Invalidation"
        INV["On create/update/delete:<br/>cache.del(key)<br/>cache.delByPattern(pattern)"]
    end

    subgraph "Failure Mode"
        FAIL["Redis unreachable →<br/>catch error, log warning,<br/>fall through to PostgreSQL"]
    end

    style HIT fill:#27ae60,color:#fff
    style MISS fill:#e67e22,color:#fff
    style FAIL fill:#e74c3c,color:#fff
```

The caching layer is a resilient read-through cache. Every `get`/`set`/`del` method in `CacheService` wraps operations in try-catch blocks that log warnings and continue. If Redis is down, the app still works — just slower.

---

## 7. BullMQ Architecture

```mermaid
graph LR
    subgraph "API Process (Producers)"
        TS["TaskService"]
        CS["CommentService"]
        OS["OrgService"]
        EM["EmailService"]
    end

    subgraph "Redis (Broker)"
        EQ["email-queue"]
        NQ["notification-queue"]
        CQ["cleanup-queue<br/>(repeatable cron)"]
    end

    subgraph "Worker Process (Consumers)"
        EWK["EmailWorker<br/>concurrency: 5"]
        NWK["NotificationWorker<br/>concurrency: 10"]
        CWK["CleanupWorker<br/>repeatable: every 6h"]
    end

    TS -->|addNotificationJob| NQ
    CS -->|addNotificationJob| NQ
    OS -->|addNotificationJob| NQ
    EM -->|addEmailJob| EQ

    EQ --> EWK
    NQ --> NWK
    CQ --> CWK

    EWK -->|Nodemailer SMTP| SMTP["Email Server"]
    NWK -->|INSERT| PG["PostgreSQL"]
    CWK -->|DELETE expired rows| PG

    subgraph "Retry Policy"
        RP["3 attempts<br/>exponential backoff<br/>1s → 2s → 4s"]
    end

    style EQ fill:#dc382d,color:#fff
    style NQ fill:#dc382d,color:#fff
    style CQ fill:#dc382d,color:#fff
```

All three queues share the same Redis connection and retry configuration. Jobs are retained for debugging: completed for 24h (max 500), failed for 7 days (max 1000). The worker process is a standalone Docker container running the same image with a different CMD.

---

## 8. Email Flow

```mermaid
sequenceDiagram
    participant BE as Business Event<br/>(Service Layer)
    participant ES as EmailService
    participant Q as email-queue<br/>(Redis/BullMQ)
    participant W as EmailWorker<br/>(Worker Container)
    participant NM as Nodemailer
    participant SMTP as SMTP Server

    BE->>ES: emailService.queueEmail({ to, subject, html })
    ES->>Q: emailQueue.add("send-email", data)
    Note over Q: Job stored in Redis<br/>with 3 retry attempts

    Q->>W: Worker picks up job
    W->>NM: transporter.sendMail(options)
    NM->>SMTP: SMTP protocol
    SMTP-->>NM: 250 OK
    NM-->>W: { messageId, response }
    W-->>Q: Job completed

    alt SMTP failure
        SMTP-->>NM: Connection error
        NM-->>W: Error thrown
        W-->>Q: Job failed → retry with backoff
    end
```

In test mode (`NODE_ENV=test`), Nodemailer uses `jsonTransport` which serializes emails to JSON instead of sending them, allowing tests to assert on email content without an SMTP server.

---

## 9. Notification Flow

```mermaid
sequenceDiagram
    participant SV as Service Layer<br/>(Task/Comment/Org)
    participant NS as NotificationService
    participant Q as notification-queue<br/>(Redis/BullMQ)
    participant W as NotificationWorker<br/>(Worker Container)
    participant DB as PostgreSQL
    participant API as Notification API<br/>(GET /notifications)
    participant FE as Frontend

    SV->>NS: queueNotification({ userId, type, title, message })
    NS->>Q: notificationQueue.add("send-notification", data)

    Q->>W: Worker picks up job
    W->>DB: INSERT INTO notifications
    W-->>Q: Job completed

    FE->>API: GET /api/v1/notifications
    API->>DB: SELECT * FROM notifications WHERE userId = ?
    DB-->>API: Notification rows
    API-->>FE: Paginated notification list

    FE->>API: PATCH /api/v1/notifications/:id/read
    API->>DB: UPDATE isRead = true, readAt = now()
    API-->>FE: 200 OK
```

Notifications are created asynchronously via BullMQ — the HTTP response is never blocked by notification persistence. If the user or organization no longer exists (Prisma error P2003), the worker completes the job gracefully without retrying.

---

## 10. Nginx Load Balancing

```mermaid
graph TB
    C["Client<br/>HTTP Request"] --> NG

    subgraph "Nginx (Port 80)"
        NG["Nginx 1.27 Alpine<br/>server_tokens off<br/>gzip on"]
        NG --> LB["upstream api_cluster<br/>least_conn<br/>keepalive 32"]
    end

    LB -->|Route 1| API1["api_1:5000<br/>max_fails=3<br/>fail_timeout=10s"]
    LB -->|Route 2| API2["api_2:5000<br/>max_fails=3<br/>fail_timeout=10s"]

    subgraph Failover
        FO["proxy_next_upstream:<br/>error | timeout | 502 | 503 | 504<br/>proxy_next_upstream_tries: 3"]
    end

    subgraph Headers
        HD["X-Real-IP: client IP<br/>X-Forwarded-For: proxy chain<br/>X-Forwarded-Proto: scheme"]
    end

    API1 -.->|"502/503/504"| FO
    FO -.->|Retry on other| API2

    style NG fill:#0d6efd,color:#fff
    style API1 fill:#198754,color:#fff
    style API2 fill:#198754,color:#fff
```

`least_conn` directs traffic to the instance with fewer active connections. `keepalive 32` maintains persistent upstream connections to avoid TCP handshake overhead. If an instance fails 3 times within 10 seconds, Nginx marks it unavailable and routes all traffic to the remaining instance.

---

## 11. Deployment Architecture

```mermaid
graph TB
    subgraph "Public-Facing"
        NG["nginx<br/>Port 80 → Host"]
    end

    subgraph "Internal Application Services"
        API1["api_1<br/>Port 5000 (internal)"]
        API2["api_2<br/>Port 5000 (internal)"]
        WK["workers<br/>BullMQ daemon"]
    end

    subgraph "Internal Data Services"
        PG["postgres<br/>Port 5432 (internal)<br/>Volume: postgres_data"]
        RD["redis<br/>Port 6379 (internal)<br/>Volume: redis_data<br/>AOF persistence"]
    end

    subgraph "Docker Network"
        NET["expense_network<br/>bridge driver"]
    end

    NG -->|depends_on: healthy| API1
    NG -->|depends_on: healthy| API2
    API1 -->|depends_on: healthy| PG
    API1 -->|depends_on: healthy| RD
    API2 -->|depends_on: healthy| PG
    API2 -->|depends_on: healthy| RD
    WK -->|depends_on: healthy| PG
    WK -->|depends_on: healthy| RD

    NG --- NET
    API1 --- NET
    API2 --- NET
    WK --- NET
    PG --- NET
    RD --- NET

    style NG fill:#0d6efd,color:#fff
    style PG fill:#336791,color:#fff
    style RD fill:#dc382d,color:#fff
```

All services run on the same Docker bridge network. Only Nginx exposes a port to the host. PostgreSQL and Redis use named Docker volumes (`postgres_data`, `redis_data`) for persistence across restarts. Service startup is ordered via health checks: PostgreSQL/Redis → API instances → Nginx.

---

## 12. Task Creation Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant NG as Nginx
    participant RL as Rate Limiter
    participant AU as authenticate()
    participant AZ as authorizeOrgRole()
    participant VL as validateRequest()
    participant TC as TaskController
    participant TS as TaskService
    participant TR as TaskRepository
    participant PR as Prisma
    participant PG as PostgreSQL
    participant AS as ActivityService
    participant NS as NotificationService
    participant Q as notification-queue

    U->>FE: Fill task form + submit
    FE->>NG: POST /api/v1/organizations/:orgId/projects/:projId/tasks
    NG->>RL: Proxy to api instance
    RL->>AU: Rate check passed
    AU->>AZ: JWT verified → req.user
    AZ->>VL: OrgMember found, role ≥ MEMBER
    VL->>TC: Zod validated body
    TC->>TS: createTask(orgId, projId, userId, input)
    TS->>TR: validateProjectInOrg(orgId, projId)
    TR->>PG: SELECT project WHERE orgId AND projId
    PG-->>TR: Project found
    TS->>TR: validateAssignee(orgId, assigneeId)
    TR->>PG: SELECT org_member WHERE orgId AND userId
    PG-->>TR: Member confirmed
    TS->>TR: createTask({ projectId, title, status, ... })
    TR->>PR: prisma.task.create(data)
    PR->>PG: INSERT INTO tasks
    PG-->>PR: Task row
    PR-->>TR: Task with relations
    TR-->>TS: Task response
    TS->>AS: logActivity(TASK, CREATED, metadata)
    AS->>PG: INSERT INTO activity_logs
    TS->>NS: queueNotification(assigneeId, TASK_ASSIGNED)
    NS->>Q: notificationQueue.add(job)
    TS-->>TC: TaskResponse
    TC-->>NG: 201 { success: true, data: task }
    NG-->>FE: JSON response
    FE-->>U: Task created confirmation
```

Notice the two validations before the actual insert: (1) the project must belong to this organization, and (2) the assignee must be a member of this organization. Activity logging is synchronous (same request), notification is asynchronous (via BullMQ queue).

---

## 13. Refresh Token Rotation Sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API
    participant DB as PostgreSQL

    Note over C,DB: === Normal Rotation ===
    C->>API: POST /api/v1/auth/refresh<br/>Cookie: refreshToken=RT_1
    API->>API: jwt.verify(RT_1, JWT_REFRESH_SECRET)
    API->>API: sha256(RT_1) → hash_1
    API->>DB: SELECT FROM refresh_sessions WHERE tokenHash = hash_1
    DB-->>API: Session found, revokedAt = null
    API->>API: Generate new RT_2 + new AccessToken
    API->>API: sha256(RT_2) → hash_2
    API->>DB: $transaction: UPDATE revokedAt = now() WHERE id = old<br/>INSERT new session with hash_2
    API-->>C: Set-Cookie: RT_2 + Body: { accessToken }

    Note over C,DB: === Token Reuse Attack ===
    C->>API: POST /api/v1/auth/refresh<br/>Cookie: refreshToken=RT_1 (already rotated!)
    API->>API: jwt.verify(RT_1) ✅ (JWT is still cryptographically valid)
    API->>API: sha256(RT_1) → hash_1
    API->>DB: SELECT FROM refresh_sessions WHERE tokenHash = hash_1
    DB-->>API: Session found, revokedAt ≠ null
    rect rgb(220, 53, 69)
        API->>DB: ⚠ REVOKE ALL sessions WHERE userId = victim
        Note over API,DB: Every device is logged out
    end
    API-->>C: 401 TOKEN_REVOKED

    Note over C,DB: === Token Expired ===
    C->>API: POST /api/v1/auth/refresh<br/>Cookie: refreshToken=RT_old
    API->>API: jwt.verify(RT_old) ✅
    API->>API: sha256(RT_old) → hash_old
    API->>DB: SELECT WHERE tokenHash = hash_old
    DB-->>API: Session found, expiresAt < now()
    API-->>C: 401 TOKEN_EXPIRED
```

The red block shows the reuse detection mechanism (RFC 6819). If an attacker captures a rotated token and replays it, the system detects the revoked session and immediately invalidates ALL sessions for that user. The legitimate user is forced to re-authenticate, but the attacker's stolen tokens are all worthless.

---

## 14. CI/CD Architecture

```mermaid
graph LR
    subgraph "Developer"
        DEV["Developer"]
    end

    subgraph "GitHub"
        PR["Pull Request /<br/>Push to branch"]
        MAIN["Push to main"]
    end

    subgraph "CI Pipeline (ci.yml)"
        Q["quality job<br/>Lint + Format + Typecheck"]
        T["test job<br/>Postgres 16 + Redis 7 service containers<br/>Prisma generate → db push → npm test"]
        D["docker-build job<br/>Build image (no push)"]
        Q --> T --> D
    end

    subgraph "CD Pipeline (cd.yml)"
        CI2["ci-check job<br/>Full test suite"]
        PUB["publish-image job<br/>Build + push to GHCR"]
        DPL["deploy-production job<br/>SSH → docker compose pull + up"]
        CI2 --> PUB --> DPL
    end

    subgraph "Registry"
        GHCR["GitHub Container Registry<br/>ghcr.io"]
    end

    subgraph "Production"
        SRV["Production Server<br/>(via GitHub Secrets)"]
    end

    DEV --> PR
    DEV --> MAIN
    PR --> Q
    MAIN --> CI2
    PUB --> GHCR
    DPL -.->|"SSH (optional,<br/>only if secrets set)"| SRV

    style GHCR fill:#6e5494,color:#fff
    style DPL fill:#f0ad4e,color:#000
```

CI runs on every push/PR. CD runs only on pushes to `main`. The deployment step is conditional — it only executes if `DEPLOY_HOST`, `DEPLOY_USER`, and `DEPLOY_SSH_KEY` secrets are configured. Concurrency is controlled: CI cancels in-progress runs on the same branch, CD never cancels (to prevent partial deployments).

---

## 15. Load Testing Architecture

```mermaid
graph LR
    subgraph "Load Generator"
        AC["Autocannon<br/>(scripts/load-test.ts)<br/>Concurrency: 10, 50, 100"]
    end

    subgraph "Gateway"
        NG["Nginx<br/>Port 80"]
    end

    subgraph "API Cluster"
        API1["api_1:5000"]
        API2["api_2:5000"]
    end

    subgraph "Data Layer"
        PG["PostgreSQL 16"]
        RD["Redis 7"]
    end

    AC -->|"HTTP flood"| NG
    NG -->|least_conn| API1
    NG -->|least_conn| API2
    API1 --> PG
    API2 --> PG
    API1 --> RD
    API2 --> RD

    subgraph "Measured Metrics"
        M["requests/sec<br/>avg latency<br/>p95 latency<br/>p99 latency<br/>errors/timeouts"]
    end

    style AC fill:#e67e22,color:#fff
```

> **⚠ Important:** These benchmarks run against a **local Docker environment**. The numbers represent relative performance between endpoints and concurrency levels, NOT production capacity. Real-world throughput depends on network latency, instance sizing, database IOPS, and actual query complexity.

---

## 16. Security Architecture

```mermaid
graph TB
    subgraph "Layer 1: Network"
        NG["Nginx<br/>server_tokens off<br/>X-Frame-Options: DENY<br/>X-Content-Type-Options: nosniff<br/>X-XSS-Protection: 1; mode=block<br/>client_max_body_size: 10M"]
    end

    subgraph "Layer 2: Transport"
        HM["helmet()<br/>11 security headers<br/>Content-Security-Policy<br/>Strict-Transport-Security"]
        CR["cors()<br/>CORS_ORIGIN whitelist<br/>credentials: true"]
    end

    subgraph "Layer 3: Rate Limiting"
        GRL["General: 200 req / 60s per IP"]
        ARL["Auth: 20 req / 15min per IP+email"]
    end

    subgraph "Layer 4: Authentication"
        JWT["JWT Verification<br/>Access Token (15m expiry)<br/>Separate secrets for access/refresh"]
    end

    subgraph "Layer 5: Authorization"
        RBAC["RBAC via OrganizationMember<br/>4 roles: OWNER, ADMIN, MEMBER, VIEWER"]
        TI["Tenant Isolation<br/>WHERE organizationId = ?"]
    end

    subgraph "Layer 6: Input Validation"
        ZOD["Zod schema validation<br/>body + params + query"]
    end

    subgraph "Layer 7: Data"
        BC["bcrypt (12 rounds) password hashing"]
        TH["SHA-256 token hashing"]
        PC["Prisma parameterized queries<br/>(no raw SQL)"]
        CK["HttpOnly + Secure + SameSite cookies"]
    end

    subgraph "Layer 8: Error Safety"
        EH["errorHandler<br/>Production: generic error messages<br/>No stack traces leaked"]
    end

    NG --> HM --> CR --> GRL --> ARL --> JWT --> RBAC --> TI --> ZOD --> BC
    BC --> TH --> PC --> CK --> EH

    style NG fill:#0d6efd,color:#fff
    style RBAC fill:#198754,color:#fff
    style EH fill:#e74c3c,color:#fff
```

Security is enforced at every layer. An attacker must bypass Nginx headers, CORS, rate limiting, JWT authentication, RBAC authorization, Zod validation, AND Prisma parameterization to reach the database. Even then, passwords are bcrypt-hashed and tokens are SHA-256 hashed.

---

## 17. Future Google Integration

> **🔮 [FUTURE / NOT IMPLEMENTED]** — This diagram represents planned architecture, not existing code.

```mermaid
graph TB
    subgraph "Existing System"
        TS["TaskService<br/>(existing)"]
        EQ["email-queue<br/>(existing BullMQ)"]
    end

    subgraph "Future: Google Integration Module"
        GOA["Google OAuth 2.0<br/>Per-user authorization"]
        GCal["Google Calendar API v3<br/>Create/update events"]
        GMeet["Google Meet API<br/>Generate meeting links"]
    end

    subgraph "Future: Extended Notifications"
        WA["WhatsApp Business API<br/>via Twilio"]
        WAQ["whatsapp-queue<br/>(new BullMQ queue)"]
    end

    subgraph "Workflow"
        W1["Task with dueDate created"]
        W2["Create Calendar Event"]
        W3["Generate Meet Link"]
        W4["Queue Email Notification"]
        W5["Queue WhatsApp Notification"]
    end

    TS --> W1
    W1 --> GOA
    GOA --> GCal
    GCal --> W2
    W2 --> GMeet
    GMeet --> W3
    W3 --> EQ
    EQ --> W4
    W3 --> WAQ
    WAQ --> W5
    W5 --> WA

    style GOA fill:#4285f4,color:#fff
    style GCal fill:#4285f4,color:#fff
    style GMeet fill:#4285f4,color:#fff
    style WA fill:#25d366,color:#fff
```

The integration would connect at the service layer — `TaskService.createTask()` and `TaskService.updateTask()` would conditionally trigger calendar/meet creation when tasks have a `dueDate`. WhatsApp notifications would use a new BullMQ queue to avoid blocking email delivery.

---

## 18. RAG Ingestion, Retrieval & Answer-Generation Architecture

> **✅ [IMPLEMENTED]** — Complete end-to-end RAG architecture:
> 1. **Ingestion**: Entity extraction (Project, Task, Comment, ActivityLog), sliding-window chunking, pluggable embedding providers (Gemini, OpenAI, Mock).
> 2. **Storage**: PostgreSQL dense vector storage (`rag_knowledge_documents`, `Float[] embeddings`).
> 3. **Retrieval**: Tenant-scoped vector similarity search (`POST /api/v1/organizations/:organizationId/rag/retrieve`) with cosine similarity and threshold filtering.
> 4. **Answer Generation**: Pluggable LLM provider (Groq LPU, Gemini, OpenAI, Mock), prompt injection defense, strict grounding without hallucinations, and source citations (`POST /api/v1/organizations/:organizationId/rag/query`).
>
> **🔮 [FUTURE / NOT IMPLEMENTED]** — Autonomous Agentic AI, tool calling, and workflow execution.

```mermaid
graph TB
    subgraph "Existing SaaS Application Data [IMPLEMENTED]"
        P["Project"]
        T["Task"]
        C["Comment"]
        AL["ActivityLog"]
    end

    subgraph "RAG Ingestion & Indexing Pipeline [IMPLEMENTED]"
        EF["Entity Formatters<br/>(Sanitizes & formats content;<br/>omits passwords & tokens)"]
        CHK["Sliding-Window Chunker<br/>(1000 chars, 150 overlap)"]
        EP["IEmbeddingProvider<br/>Gemini / OpenAI / Mock"]
        REPO["RagRepository<br/>(Deterministic Upsert on @@unique composite key)"]
        VS["PostgreSQL Vector Storage<br/>(rag_knowledge_documents / Float[] embeddings)"]
    end

    subgraph "RAG Semantic Retrieval Layer [IMPLEMENTED]"
        UQ["User Question<br/>(via POST /rag/query or /retrieve)"]
        QE["Query Embedding<br/>(via IEmbeddingProvider)"]
        VSR["Tenant-Scoped Vector Search<br/>(WHERE organization_id = :orgId<br/>+ optional sourceTypes / projectId)"]
        RANK["Cosine Similarity Ranking & Threshold Filter<br/>(minSimilarity cutoff + Top-K slice)"]
        CTX["Top-K Relevant Context Chunks<br/>(Clean source metadata, zero vector leakage)"]
    end

    subgraph "RAG Answer-Generation Layer [IMPLEMENTED]"
        PMT["Prompt Injection Defense & Context Assembly<br/>(Strict grounding, data boundaries)"]
        LLM["ILlmProvider<br/>Groq (Llama 3.3 70B) / Gemini / OpenAI / Mock"]
        ANS["Grounded Answer + Source References<br/>(Zero hallucination, cited sources)"]
    end

    subgraph "Future: Autonomous Agentic Workflows [FUTURE / NOT IMPLEMENTED]"
        AG["Agentic Orchestrator & Tool Calling<br/>(Autonomous task mutation, Google actions)"]
    end

    P --> EF
    T --> EF
    C --> EF
    AL --> EF
    EF --> CHK
    CHK --> EP
    EP --> REPO
    REPO --> VS

    UQ --> QE
    QE --> VSR
    VS --> VSR
    VSR --> RANK
    RANK --> CTX

    CTX --> PMT
    PMT --> LLM
    LLM --> ANS

    ANS -.->|"Future tool trigger"| AG

    style EF fill:#27ae60,color:#fff
    style CHK fill:#27ae60,color:#fff
    style EP fill:#27ae60,color:#fff
    style REPO fill:#27ae60,color:#fff
    style VS fill:#2980b9,color:#fff
    style UQ fill:#27ae60,color:#fff
    style QE fill:#27ae60,color:#fff
    style VSR fill:#27ae60,color:#fff
    style RANK fill:#27ae60,color:#fff
    style CTX fill:#27ae60,color:#fff
    style PMT fill:#27ae60,color:#fff
    style LLM fill:#27ae60,color:#fff
    style ANS fill:#27ae60,color:#fff
    style AG fill:#8e44ad,color:#fff,stroke-dasharray: 5 5
```

> **⚠ Security & Tenant Isolation Rule:** All RAG ingestion, retrieval, and answering operations are strictly scoped to `organizationId` at the database level. Passwords, password hashes, and access tokens are strictly stripped by entity formatters before chunking or embedding generation. Raw dense embedding arrays are never exposed via REST API responses. Context chunks are treated as untrusted data to neutralize prompt injection attacks.

---

## 19. Future Agentic Meeting Workflow

> **🔮 [FUTURE / NOT IMPLEMENTED]** — This diagram represents planned architecture, not existing code.

```mermaid
sequenceDiagram
    participant U as User
    participant AI as AI Agent<br/>(LLM + Tool Calling)
    participant AUTH as Auth + RBAC Layer<br/>(MUST NOT BYPASS)
    participant TS as TaskService (existing)
    participant GCal as Google Calendar API
    participant GMeet as Google Meet API
    participant EQ as email-queue (existing)
    participant WQ as whatsapp-queue (future)
    participant AL as ActivityService (existing)

    U->>AI: "Schedule a review meeting with Alice and Bob<br/>for the login task, next Tuesday at 3pm"

    AI->>AUTH: Verify user has MEMBER+ role in org
    AUTH-->>AI: Authorized ✅

    AI->>TS: Find task "login" in org
    TS-->>AI: Task found (id: abc-123)

    AI->>TS: Find members "Alice" and "Bob"
    TS-->>AI: Members found

    AI->>GCal: Create event: "Login Task Review"<br/>Attendees: alice@co.com, bob@co.com<br/>Time: Tuesday 3pm
    GCal-->>AI: Event created (eventId)

    AI->>GMeet: Generate meeting link
    GMeet-->>AI: https://meet.google.com/xyz

    AI->>TS: Update task description with Meet link

    AI->>EQ: Queue email to Alice + Bob<br/>Subject: "Review meeting scheduled"
    AI->>WQ: Queue WhatsApp to Alice + Bob

    AI->>AL: logActivity(TASK_UPDATED, metadata: { meetLink, eventId })

    AI-->>U: "Done! Meeting scheduled for Tuesday 3pm.<br/>Meet link: meet.google.com/xyz<br/>Alice and Bob have been notified via email and WhatsApp."
```

> **⚠ Critical security rule:** The AI agent must operate WITHIN the existing authentication and RBAC framework. It must:
> - Authenticate as the user who invoked it (not a system-level superuser)
> - Respect the user's role — a VIEWER cannot create tasks via the AI agent
> - Scope all data access to the user's organization
> - Never delete resources without explicit user confirmation
> - Log all actions to the activity log for auditability

---

## 20. Foundational AI Infrastructure & Read-Only Tools Layer

> **✅ [IMPLEMENTED]** — Core AI Infrastructure: Provider-independent LLM abstraction (`ILlmProvider` supporting Groq LPU, Gemini, OpenAI, Mock), AI Service (`AiService`), RAG context bridge (`RagService.retrieve`), execution limits (`AgentExecutionLimits`), prompt injection defense.
> **✅ [IMPLEMENTED]** — Safe Read-Only AI Tools Layer: `ToolRegistry`, `searchProjects`, `getProject`, `searchTasks`, `getTask`, `searchMembers`, `getMember`, `getRecentActivity`.
> **🔮 [FUTURE / NOT IMPLEMENTED]** — Write Tools (create/update/delete), Agent Orchestrator, Autonomous Tool Execution, and Multi-Step Agent Workflows.

```mermaid
graph TB
    subgraph "Authenticated Multi-Tenant Request [IMPLEMENTED]"
        U["User / Caller Request"]
        CTX["AiRequestContext<br/>(userId, organizationId, userRole)"]
    end

    subgraph "AI Core Infrastructure Layer [IMPLEMENTED]"
        AIS["AiService<br/>(Coordinates LLM calls & enforces execution limits)"]
        RAGB["RAG Context Bridge<br/>(Safely fetches tenant context via RagService)"]
        LIM["Execution Limits & Safety Envelopes<br/>(AI_MAX_STEPS, AI_MAX_TOOL_CALLS, timeoutMs)"]
        LLMP["ILlmProvider Abstraction<br/>Groq (Llama 3.3 70B) / Gemini / OpenAI / Mock"]
    end

    subgraph "Tool Registry & Safe Read-Only Tools [IMPLEMENTED]"
        TR["ToolRegistry<br/>(Validates input schema & enforces caller RBAC)"]
        T_SP["searchProjects"]
        T_GP["getProject"]
        T_ST["searchTasks"]
        T_GT["getTask"]
        T_SM["searchMembers"]
        T_GM["getMember"]
        T_RA["getRecentActivity"]
    end

    subgraph "Existing Application Services [IMPLEMENTED]"
        PS["ProjectService"]
        TS["TaskService"]
        OS["OrganizationService"]
        AS["ActivityService"]
    end

    subgraph "Future: Write Tools & Agent Orchestration [FUTURE / NOT IMPLEMENTED]"
        AO["Agent Orchestrator (Multi-step reasoning & tool dispatch)"]
        WT["Write Tools (createTask, updateTask, scheduleMeeting, sendEmail)"]
    end

    U --> CTX
    CTX --> AIS
    AIS --> RAGB
    AIS --> LIM
    AIS --> LLMP

    TR --> T_SP
    TR --> T_GP
    TR --> T_ST
    TR --> T_GT
    TR --> T_SM
    TR --> T_GM
    TR --> T_RA

    T_SP -->|"calls authorized service"| PS
    T_GP -->|"calls authorized service"| PS
    T_ST -->|"calls authorized service"| TS
    T_GT -->|"calls authorized service"| TS
    T_SM -->|"calls authorized service"| OS
    T_GM -->|"calls authorized service"| OS
    T_RA -->|"calls authorized service"| AS

    AO -.->|"Future tool dispatch"| TR
    AO -.->|"Future write dispatch"| WT

    style U fill:#27ae60,color:#fff
    style CTX fill:#27ae60,color:#fff
    style AIS fill:#27ae60,color:#fff
    style RAGB fill:#27ae60,color:#fff
    style LIM fill:#27ae60,color:#fff
    style LLMP fill:#27ae60,color:#fff
    style TR fill:#27ae60,color:#fff
    style T_SP fill:#27ae60,color:#fff
    style T_GP fill:#27ae60,color:#fff
    style T_ST fill:#27ae60,color:#fff
    style T_GT fill:#27ae60,color:#fff
    style T_SM fill:#27ae60,color:#fff
    style T_GM fill:#27ae60,color:#fff
    style T_RA fill:#27ae60,color:#fff
    style PS fill:#2980b9,color:#fff
    style TS fill:#2980b9,color:#fff
    style OS fill:#2980b9,color:#fff
    style AS fill:#2980b9,color:#fff
    style AO fill:#8e44ad,color:#fff,stroke-dasharray: 5 5
    style WT fill:#e67e22,color:#fff,stroke-dasharray: 5 5
```

> **⚠ Security & Architecture Rule:** The AI layer never accesses Prisma or the database directly. All tool calls route through authorized application services respecting tenant isolation and caller permissions. Raw API keys, JWTs, and passwords are never passed to the LLM or exposed in tool outputs.

---

## How to Export These Diagrams

### Using Mermaid Live Editor (Recommended)

1. Open [mermaid.live](https://mermaid.live) in your browser.
2. Copy the content inside any ` ```mermaid ` code block from this document.
3. Paste it into the editor on the left side.
4. The diagram renders instantly on the right.
5. Click **Actions** → **PNG** or **SVG** to download.

### Using Mermaid CLI (Batch Export)

```bash
# Install Mermaid CLI globally
npm install -g @mermaid-js/mermaid-cli

# Export a single diagram to SVG
mmdc -i input.mmd -o output.svg

# Export to PNG with custom width
mmdc -i input.mmd -o output.png -w 1920
```

### Tips for Clean Exports

- **SVG** is preferred for documentation and presentations — it scales without losing quality.
- **PNG** at `1920px` width works well for LinkedIn, README embeds, and slide decks.
- For dark backgrounds, add `%%{init: {'theme': 'dark'}}%%` at the top of the Mermaid block.
- Sequence diagrams export best in portrait orientation; graph diagrams work better in landscape.
