# Complete REST API Reference & Documentation

This document describes all frontend-facing endpoints, authentication rules, role-based access controls, request/response models, pagination, error responses, and rate limits.

---

## 1. Global API Standards

- **Base URL:** `http://localhost:5000/api/v1` (Health check at `http://localhost:5000/health`)
- **Content-Type:** `application/json`
- **Rate Limits:**
  - **General API:** 200 requests/minute per client IP (`X-RateLimit-*` headers included).
  - **Authentication Routes (`/auth/*`):** 20 requests/15 minutes per IP:Email identifier.
- **Standard Success Response Format:**
  ```json
  {
    "success": true,
    "data": {},
    "message": "Operation description",
    "meta": {
      "timestamp": "2026-08-21T12:00:00.000Z",
      "requestId": "c1f7bfa6-1e9a-4c28-98e9-d7b19810bfa1"
    }
  }
  ```
- **Standard Error Response Format:**
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE_STRING",
      "message": "Human readable error description",
      "details": {}
    },
    "meta": {
      "timestamp": "2026-08-21T12:00:00.000Z",
      "requestId": "c1f7bfa6-1e9a-4c28-98e9-d7b19810bfa1"
    }
  }
  ```

---

## 2. Authentication & Authorization

### Roles & Hierarchy
- `OWNER`: Full control of organization, member removal, and organization deletion.
- `ADMIN`: Project/Task management, member invitation, role modification (excluding Owner).
- `MEMBER`: Project/Task/Comment creation, task updates, self-assignment.
- `VIEWER`: Read-only access across projects, tasks, comments, and dashboard.

---

## 3. Endpoints Reference

### A. Health & System Status

#### `GET /health`
- **Auth:** None (Public)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "status": "healthy",
      "timestamp": "2026-08-21T12:00:00.000Z",
      "uptime": 124.5,
      "environment": "development",
      "services": {
        "redis": { "status": "healthy", "latencyMs": 1.2 }
      }
    }
  }
  ```

---

### B. Authentication Module (`/api/v1/auth`)

#### `POST /api/v1/auth/register`
- **Auth:** None (Public)
- **Body:**
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "Password123!",
    "organizationName": "Acme Inc"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOi...",
      "user": { "id": "...", "name": "Jane Doe", "email": "jane@example.com" },
      "organization": { "id": "...", "name": "Acme Inc", "slug": "acme-inc" }
    }
  }
  ```
- **Cookie set:** `refreshToken` (HTTP-only, Lax, Secure in prod, 7 days TTL).

#### `POST /api/v1/auth/login`
- **Auth:** None (Public)
- **Body:** `{ "email": "jane@example.com", "password": "Password123!" }`
- **Response `200 OK`**: `{ "accessToken": "...", "user": { ... } }`

#### `POST /api/v1/auth/refresh`
- **Auth:** Cookie `refreshToken`
- **Response `200 OK`**: `{ "accessToken": "...", "user": { ... } }`

#### `POST /api/v1/auth/logout`
- **Auth:** Optional / Cookie
- **Response `200 OK`**: `{ "success": true, "data": null, "message": "Logged out successfully" }`

---

### C. Organizations Module (`/api/v1/organizations`)

#### `POST /api/v1/organizations`
- **Auth:** Bearer Token
- **Body:** `{ "name": "Acme Corp", "slug": "acme-corp" }` (slug optional)
- **Response `201 Created`**

#### `GET /api/v1/organizations`
- **Auth:** Bearer Token
- **Response `200 OK`**: Array of organizations user is a member of with their respective `role`.

#### `GET /api/v1/organizations/:id`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Response `200 OK`**

#### `PATCH /api/v1/organizations/:id`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`)
- **Body:** `{ "name": "Updated Org", "slug": "updated-slug" }`
- **Response `200 OK`**

#### `DELETE /api/v1/organizations/:id`
- **Auth:** Bearer Token (Role: `OWNER` only)
- **Response `200 OK`**

---

### D. Organization Members (`/api/v1/organizations/:organizationId/members`)

#### `POST /api/v1/organizations/:organizationId/members`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`)
- **Body:** `{ "email": "member@example.com", "role": "MEMBER" }`
- **Response `201 Created`**

#### `GET /api/v1/organizations/:organizationId/members`
- **Auth:** Bearer Token (Role: Any member)
- **Response `200 OK`**: List of members with profiles and roles.

#### `PATCH /api/v1/organizations/:organizationId/members/:userId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`)
- **Body:** `{ "role": "ADMIN" }`
- **Response `200 OK`**

#### `DELETE /api/v1/organizations/:organizationId/members/:userId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, or self-leave)
- **Response `200 OK`**

---

### E. Projects Module (`/api/v1/organizations/:organizationId/projects`)

#### `POST /api/v1/organizations/:organizationId/projects`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Body:** `{ "name": "Mobile App", "key": "MOB", "description": "iOS and Android" }`
- **Response `201 Created`**

#### `GET /api/v1/organizations/:organizationId/projects`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `page` (int), `limit` (int), `status` (ACTIVE/ARCHIVED/COMPLETED), `search` (string)
- **Response `200 OK`**: Paginated project list with metadata.

#### `GET /api/v1/organizations/:organizationId/projects/:projectId`
- **Auth:** Bearer Token (Role: Any member)
- **Response `200 OK`**

#### `PATCH /api/v1/organizations/:organizationId/projects/:projectId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Body:** `{ "name": "New Name", "description": "...", "status": "COMPLETED" }`
- **Response `200 OK`**

#### `DELETE /api/v1/organizations/:organizationId/projects/:projectId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`)
- **Response `200 OK`**

---

### F. Tasks Module (`/api/v1/organizations/:organizationId/projects/:projectId/tasks`)

#### `POST /api/v1/organizations/:organizationId/projects/:projectId/tasks`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Body:**
  ```json
  {
    "title": "Design Login Screen",
    "description": "Figma mockups",
    "status": "TODO",
    "priority": "HIGH",
    "assigneeId": "uuid",
    "dueDate": "2026-09-01T00:00:00Z"
  }
  ```
- **Response `201 Created`**

#### `GET /api/v1/organizations/:organizationId/projects/:projectId/tasks`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `page`, `limit`, `status`, `priority`, `assigneeId`, `sortBy`, `sortOrder`
- **Response `200 OK`**: Paginated task list.

#### `PATCH /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`, or assigned `VIEWER`)
- **Body:** `{ "status": "IN_PROGRESS", "priority": "URGENT", "assigneeId": "uuid" }`
- **Response `200 OK`**

#### `DELETE /api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`)
- **Response `200 OK`**

---

### G. Comments Module (`/api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId/comments`)

#### `POST .../comments`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Body:** `{ "content": "Updated the mockups" }`
- **Response `201 Created`**

#### `GET .../comments`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `page`, `limit`, `sortBy`, `sortOrder`
- **Response `200 OK`**

#### `PATCH .../comments/:commentId`
- **Auth:** Bearer Token (Author only)
- **Body:** `{ "content": "Updated comment text" }`
- **Response `200 OK`**

#### `DELETE .../comments/:commentId`
- **Auth:** Bearer Token (Author or `OWNER`/`ADMIN`)
- **Response `200 OK`**

---

### H. Activity Logs (`/api/v1/organizations/:organizationId/activity`)

#### `GET /api/v1/organizations/:organizationId/activity`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `page`, `limit`, `entityType`, `action`
- **Response `200 OK`**: Paginated audit activity list in reverse chronological order.

#### `GET /api/v1/organizations/:organizationId/activity/:entityType/:entityId`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `page`, `limit`
- **Response `200 OK`**

---

### I. In-App Notifications (`/api/v1/notifications`)

#### `GET /api/v1/notifications`
- **Auth:** Bearer Token
- **Query Params:** `page`, `limit`, `isRead` (boolean), `type` (string)
- **Response `200 OK`**

#### `GET /api/v1/notifications/unread`
- **Auth:** Bearer Token
- **Response `200 OK`**: `{ "unreadCount": 3 }`

#### `PATCH /api/v1/notifications/:id/read`
- **Auth:** Bearer Token (Ownership enforced)
- **Response `200 OK`**

#### `PATCH /api/v1/notifications/read-all`
- **Auth:** Bearer Token
- **Response `200 OK`**

---

### J. Dashboard Module (`/api/v1/organizations/:organizationId/dashboard`)

#### `GET /api/v1/organizations/:organizationId/dashboard`
- **Auth:** Bearer Token (Role: Any member)
- **Query Params:** `recentActivityLimit` (default 5, max 50), `recentNotificationsLimit` (default 5, max 50)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "organizationId": "uuid",
      "projects": { "total": 4, "active": 3 },
      "tasks": {
        "total": 15,
        "byStatus": { "TODO": 5, "IN_PROGRESS": 6, "DONE": 4, "IN_REVIEW": 0, "CANCELLED": 0 },
        "byPriority": { "LOW": 2, "MEDIUM": 8, "HIGH": 3, "URGENT": 2 },
        "overdue": 2,
        "assignedToMe": 3
      },
      "recentActivity": [ ... ],
      "recentNotifications": [ ... ]
    }
  }
  ```

---

### K. Google & Gmail Integration (`/api/v1/integrations/google`)

#### `GET /api/v1/integrations/google/connect`
- **Auth:** Bearer Token
- **Description:** Generates Google OAuth 2.0 authorization URL with cryptographically signed anti-CSRF state token.
- **Scopes Requested:** `openid`, `userinfo.email`, `userinfo.profile`, `gmail.send`.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&state=..."
    }
  }
  ```

#### `GET /api/v1/integrations/google/callback`
- **Auth:** Public (validated via signed anti-CSRF state parameter)
- **Query Params:** `code`, `state`, `error?`, `error_description?`
- **Description:** Exchanges authorization code for tokens, retrieves Google profile, encrypts tokens at rest with AES-256-GCM, and links account to user.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "connected": true,
      "email": "user@gmail.com",
      "scopes": ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/gmail.send"],
      "connectedAt": "2026-08-22T00:00:00.000Z"
    }
  }
  ```

#### `GET /api/v1/integrations/google/status`
- **Auth:** Bearer Token
- **Description:** Returns connection status for the authenticated user without exposing sensitive tokens.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "connected": true,
      "email": "user@gmail.com",
      "scopes": [ ... ],
      "tokenExpiresAt": "2026-08-22T01:00:00.000Z"
    }
  }
  ```

#### `POST /api/v1/integrations/google/disconnect`
- **Auth:** Bearer Token
- **Description:** Revokes tokens with Google revoke API and deletes the `GoogleAccount` database record.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "data": {
      "disconnected": true
    }
  }
  ```

#### `POST /api/v1/integrations/google/gmail/send`
- **Auth:** Bearer Token
- **Description:** Enqueues an email to be sent asynchronously through the user's connected Gmail account via BullMQ.
- **Request Body:**
  ```json
  {
    "to": "recipient@example.com",
    "subject": "Hello from Gmail API",
    "text": "Plain text content",
    "html": "<p>HTML content</p>"
  }
  ```
- **Response `202 Accepted`**:
  ```json
  {
    "success": true,
    "data": {
      "queued": true,
      "jobId": "bullmq-job-id-123",
      "recipient": "recipient@example.com",
      "subject": "Hello from Gmail API",
      "provider": "gmail"
    }
  }
  ```

#### `GET /api/v1/integrations/google/calendar/events`
- **Auth:** Bearer Token
- **Description:** Lists calendar events for the connected Google user within optional time bounds.
- **Query Params:** `from` (ISO datetime), `to` (ISO datetime)
- **Response `200 OK`**: List of Google Calendar events.

#### `GET /api/v1/integrations/google/calendar/events/:eventId`
- **Auth:** Bearer Token
- **Description:** Retrieves details for a specific Google Calendar event.
- **Response `200 OK`**: Single Google Calendar event object.

#### `POST /api/v1/integrations/google/calendar/events`
- **Auth:** Bearer Token
- **Description:** Creates a standalone event directly in the user's primary Google Calendar.
- **Request Body:**
  ```json
  {
    "title": "Roadmap Discussion",
    "description": "Q3 Planning meeting",
    "startTime": "2026-09-01T14:00:00.000Z",
    "endTime": "2026-09-01T15:00:00.000Z",
    "location": "Virtual Room 1"
  }
  ```
- **Response `201 Created`**: Created Google Calendar event.

#### `PATCH /api/v1/integrations/google/calendar/events/:eventId`
- **Auth:** Bearer Token
- **Description:** Updates an existing Google Calendar event.
- **Response `200 OK`**: Updated Google Calendar event.

#### `DELETE /api/v1/integrations/google/calendar/events/:eventId`
- **Auth:** Bearer Token
- **Description:** Deletes an event from Google Calendar.
- **Response `200 OK`**: `{ "success": true, "data": { "deleted": true } }`

---

### L. Meetings Module (`/api/v1/organizations/:organizationId/meetings`)

#### `POST /api/v1/organizations/:organizationId/meetings`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Description:** Creates an application-level meeting in PostgreSQL and optionally syncs it with Google Calendar and provisions a Google Meet conference. Records audit activity log entries (`CREATED`, and `MEET_LINK_CREATED` if Meet enabled).
- **Request Body:**
  ```json
  {
    "title": "Sprint Retrospective",
    "description": "Review sprint outcomes",
    "startTime": "2026-09-02T10:00:00.000Z",
    "endTime": "2026-09-02T11:00:00.000Z",
    "location": "Conference Room A",
    "projectId": "uuid-optional",
    "taskId": "uuid-optional",
    "syncWithGoogle": true,
    "createGoogleMeet": true
  }
  ```
- **Response `201 Created`**: Meeting object including `googleMeetLink`, `googleMeetId`, and `isMeetEnabled`.

#### `POST /api/v1/organizations/:organizationId/meetings/:meetingId/meet`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Description:** Generates and attaches a Google Meet video conference link to an existing application meeting, synchronizing it with Google Calendar. Records an audit activity log entry (`MEET_LINK_CREATED`).
- **Response `200 OK`**: Updated meeting object with `googleMeetLink`, `googleMeetId`, and `isMeetEnabled: true`.

#### `GET /api/v1/organizations/:organizationId/meetings`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Query Params:** `page`, `limit`, `projectId`, `from`, `to`
- **Response `200 OK`**: Paginated list of organization meetings.

#### `GET /api/v1/organizations/:organizationId/meetings/:meetingId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- **Response `200 OK`**: Meeting object details.

#### `PATCH /api/v1/organizations/:organizationId/meetings/:meetingId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Description:** Updates meeting details in PostgreSQL and syncs updates to Google Calendar/Meet if linked. Records an audit activity log entry (`UPDATED`).
- **Response `200 OK`**: Updated meeting object.

#### `DELETE /api/v1/organizations/:organizationId/meetings/:meetingId`
- **Auth:** Bearer Token (Role: `OWNER`, `ADMIN`, `MEMBER`)
- **Description:** Deletes meeting from PostgreSQL and cancels/removes it from Google Calendar if linked. Records an audit activity log entry (`DELETED`).
- **Response `200 OK`**: `{ "success": true, "data": { "deleted": true } }`

---

### M. Google Meet Integration Direct Endpoints (`/api/v1/integrations/google/meet`)

#### `POST /api/v1/integrations/google/meet/generate`
- **Auth:** Bearer Token (Application User)
- **Description:** Generates a standalone Google Meet conference without requiring a pre-existing organization meeting record.
- **Request Body:**
  ```json
  {
    "title": "Ad-Hoc Video Call",
    "description": "Quick sync",
    "startTime": "2026-09-05T14:00:00.000Z",
    "endTime": "2026-09-05T15:00:00.000Z"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "success": true,
    "message": "Google Meet link generated successfully",
    "data": {
      "meetLink": "https://meet.google.com/abc-defg-hij",
      "conferenceId": "abc-defg-hij",
      "calendarEventId": "event-uuid",
      "htmlLink": "https://www.google.com/calendar/event?eid=...",
      "entryPoints": [
        {
          "entryPointType": "video",
          "uri": "https://meet.google.com/abc-defg-hij",
          "label": "meet.google.com/abc-defg-hij"
        }
      ],
      "conferenceSolution": {
        "name": "Google Meet"
      }
    }
  }
  ```

---

## N. RAG Knowledge Ingestion, Retrieval & Q&A (`/api/v1/organizations/:organizationId/rag`)

All RAG knowledge endpoints require authentication and active organization membership.

### 1. Grounded Question Answering (RAG Query)
- **Method:** `POST /api/v1/organizations/:organizationId/rag/query`
- **Roles:** `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (All Org Roles)
- **Request Body:**
  ```json
  {
    "query": "What tasks are overdue?",
    "topK": 5,
    "minSimilarity": 0.5,
    "sourceTypes": ["TASK", "PROJECT"],
    "projectId": "optional-project-uuid"
  }
  ```
- **Response (200):**
  ```json
  {
    "success": true,
    "message": "Answer generated successfully",
    "data": {
      "query": "What tasks are overdue?",
      "answer": "Based on your organization data, there is 1 overdue high-priority task: \"Fix overdue database connection pool saturation\" in the Neural Engine Core project.",
      "sources": [
        {
          "id": "doc-uuid-1",
          "sourceType": "TASK",
          "sourceId": "task-uuid-1",
          "title": "Task: Fix overdue database connection pool saturation",
          "chunkIndex": 0,
          "similarityScore": 0.8421,
          "metadata": {
            "taskId": "task-uuid-1",
            "projectId": "proj-uuid-1",
            "status": "IN_PROGRESS",
            "priority": "HIGH"
          }
        }
      ]
    }
  }
  ```

### 2. Semantic Knowledge Retrieval (Vector Search Chunks)
- **Method:** `POST /api/v1/organizations/:organizationId/rag/retrieve`
- **Roles:** `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (All Org Roles)
- **Request Body:**
  ```json
  {
    "query": "What tasks are overdue?",
    "topK": 5,
    "minSimilarity": 0.5,
    "sourceTypes": ["TASK", "PROJECT"],
    "projectId": "optional-project-uuid"
  }
  ```
- **Response (200):**
  ```json
  {
    "success": true,
    "message": "Relevant knowledge retrieved successfully",
    "data": {
      "query": "What tasks are overdue?",
      "totalMatches": 2,
      "results": [
        {
          "id": "doc-uuid-1",
          "organizationId": "org-uuid",
          "sourceType": "TASK",
          "sourceId": "task-uuid-1",
          "chunkIndex": 0,
          "totalChunks": 1,
          "title": "Task: Fix overdue database connection pool saturation",
          "content": "Task: Fix overdue database connection pool saturation\nProject: Neural Engine Core (NEC)\nStatus: IN_PROGRESS\nPriority: HIGH\nDue Date: 2026-08-21T00:00:00.000Z\nDetails:\nUrgent: The primary PostgreSQL cluster connection pool is exhausted and queries are overdue.",
          "metadata": {
            "taskId": "task-uuid-1",
            "projectId": "proj-uuid-1",
            "status": "IN_PROGRESS",
            "priority": "HIGH"
          },
          "similarityScore": 0.8421
        }
      ]
    }
  }
  ```

### 2. Trigger Organization Batch Ingestion
- **Method:** `POST /api/v1/organizations/:organizationId/rag/index`
- **Query Params (optional):** `?sync=true` (runs synchronously instead of BullMQ background job)
- **Roles:** `OWNER`, `ADMIN`
- **Response (200 / 202):**
  ```json
  {
    "success": true,
    "message": "Batch RAG indexing completed successfully",
    "data": {
      "organizationId": "org-uuid",
      "projectsIndexed": 5,
      "tasksIndexed": 24,
      "commentsIndexed": 68,
      "activitiesIndexed": 120,
      "totalChunks": 217
    }
  }
  ```

### 2. Index Single Entity
- **Method:** `POST /api/v1/organizations/:organizationId/rag/index/entity`
- **Query Params (optional):** `?sync=true`
- **Roles:** `OWNER`, `ADMIN`, `MEMBER`
- **Request Body:**
  ```json
  {
    "sourceType": "TASK",
    "sourceId": "task-uuid"
  }
  ```
- **Response (200 / 202):**
  ```json
  {
    "success": true,
    "message": "Entity RAG indexing completed successfully",
    "data": {
      "sourceType": "TASK",
      "sourceId": "task-uuid",
      "chunksCreated": 1,
      "success": true
    }
  }
  ```

### 3. List Indexed Knowledge Documents
- **Method:** `GET /api/v1/organizations/:organizationId/rag/documents`
- **Query Params:** `page=1&limit=20&sourceType=TASK`
- **Roles:** `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
- **Response (200):**
  ```json
  {
    "success": true,
    "message": "Organization RAG knowledge retrieved successfully",
    "data": {
      "items": [
        {
          "id": "doc-uuid",
          "organizationId": "org-uuid",
          "sourceType": "TASK",
          "sourceId": "task-uuid",
          "chunkIndex": 0,
          "totalChunks": 1,
          "title": "Task: Optimize Vector Indexing",
          "content": "Task: Optimize Vector Indexing\nProject: Neural Engine Core (NEC)\nStatus: IN_PROGRESS\nPriority: HIGH\nDetails:\nImprove dense embeddings storage...",
          "metadata": {
            "taskId": "task-uuid",
            "status": "IN_PROGRESS",
            "priority": "HIGH"
          },
          "createdAt": "2026-08-22T14:30:00.000Z",
          "updatedAt": "2026-08-22T14:30:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 1,
        "totalPages": 1,
        "hasNext": false,
        "hasPrev": false
      }
    }
  }
  ```

### 4. Get RAG Knowledge Statistics
- **Method:** `GET /api/v1/organizations/:organizationId/rag/stats`
- **Roles:** `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
- **Response (200):**
  ```json
  {
    "success": true,
    "message": "RAG knowledge stats retrieved successfully",
    "data": {
      "totalDocuments": 217,
      "bySourceType": {
        "PROJECT": 5,
        "TASK": 24,
        "COMMENT": 68,
        "ACTIVITY_LOG": 120
      }
    }
  }
  ```




