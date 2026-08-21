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
