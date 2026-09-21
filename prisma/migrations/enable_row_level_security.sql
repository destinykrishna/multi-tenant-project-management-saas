-- ====================================================================
-- POSTGRESQL ROW-LEVEL SECURITY (RLS) POLICIES (DEFENSE-IN-DEPTH)
-- ====================================================================
-- IMPORTANT ARCHITECTURAL & SECURITY NOTES:
-- 1. Permissive Unset Clause: The policies below include:
--    `NULLIF(current_setting('app.current_org_id', true), '') IS NULL OR ...`
--    When `app.current_org_id` is unset or empty (the default for un-scoped queries),
--    the policy permits access. This prevents breaking migrations, seeds, background
--    workers, and un-scoped administrative queries.
-- 2. Superuser Role Exemption: The default database connection role (`postgres`)
--    possesses `SUPERUSER` and `BYPASSRLS` privileges in PostgreSQL. In PostgreSQL,
--    superusers bypass RLS unconditionally even when `FORCE ROW LEVEL SECURITY` is set.
-- 3. Tenant Isolation Boundary: Active tenant isolation is guaranteed at the
--    application layer through Express RBAC middleware (`authorizeOrgRole`) and
--    explicit `organizationId` scoping on all Prisma queries.
-- 4. To establish RLS as an engine-level security boundary in the future:
--    - A non-superuser application database role (without `BYPASSRLS`) must be provisioned.
--    - Per-query or per-transaction tenant context (`SET LOCAL app.current_org_id`) must
--      be injected systematically.
--    - RLS policies must deny access when `app.current_org_id` is unset (`IS NULL`),
--      with a distinct privileged bypass role strictly for migrations and background jobs.
-- ====================================================================

-- 1. Enable RLS on Tenant-Partitioned Tables
ALTER TABLE IF EXISTS "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "rag_knowledge_documents" ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_projects ON "projects";
DROP POLICY IF EXISTS tenant_isolation_tasks ON "tasks";
DROP POLICY IF EXISTS tenant_isolation_comments ON "comments";
DROP POLICY IF EXISTS tenant_isolation_meetings ON "meetings";
DROP POLICY IF EXISTS tenant_isolation_activity ON "activity_logs";
DROP POLICY IF EXISTS tenant_isolation_rag ON "rag_knowledge_documents";

-- 3. Projects Table Policy
CREATE POLICY tenant_isolation_projects ON "projects"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );

-- 4. Tasks Table Policy (Inherits through project relation or direct org link)
CREATE POLICY tenant_isolation_tasks ON "tasks"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "projectId" IN (
      SELECT "id" FROM "projects" WHERE "organizationId" = current_setting('app.current_org_id', true)
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "projectId" IN (
      SELECT "id" FROM "projects" WHERE "organizationId" = current_setting('app.current_org_id', true)
    )
  );

-- 5. Comments Table Policy
CREATE POLICY tenant_isolation_comments ON "comments"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "taskId" IN (
      SELECT t."id" FROM "tasks" t
      JOIN "projects" p ON t."projectId" = p."id"
      WHERE p."organizationId" = current_setting('app.current_org_id', true)
    )
  );

-- 6. Meetings Table Policy
CREATE POLICY tenant_isolation_meetings ON "meetings"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );

-- 7. Activity Logs Policy
CREATE POLICY tenant_isolation_activity ON "activity_logs"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );

-- 8. RAG Knowledge Documents Policy
CREATE POLICY tenant_isolation_rag ON "rag_knowledge_documents"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_org_id', true), '') IS NULL
    OR "organizationId" = current_setting('app.current_org_id', true)
  );
