-- ====================================================================
-- ZERO-TRUST ARCHITECTURE: POSTGRESQL ROW-LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
-- Enforces tenant data isolation directly at the PostgreSQL database engine.
-- Even if an application query omits 'WHERE organization_id = ...',
-- PostgreSQL will refuse to return or mutate records belonging to other tenants.
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
