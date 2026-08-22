import { Router } from 'express';
import { OrganizationRole, ALL_ROLES } from '../../constants/roles.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { ragController } from './rag.controller.js';
import {
  ragOrgParamSchema,
  listKnowledgeQuerySchema,
  indexEntitySchema,
  retrieveKnowledgeSchema,
  queryRagSchema,
} from './rag.schema.js';

const router = Router({ mergeParams: true });

// All RAG routes require authentication
router.use(authenticate);

// 1. Ask a question & generate grounded answer (All org members)
router.post(
  '/query',
  validateRequest({
    params: ragOrgParamSchema,
    body: queryRagSchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  ragController.queryKnowledge,
);

// 2. Semantic Knowledge Retrieval (All org members)
router.post(
  '/retrieve',
  validateRequest({
    params: ragOrgParamSchema,
    body: retrieveKnowledgeSchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  ragController.retrieveKnowledge,
);

// 2. Batch Index all organization content (Owner/Admin only)
router.post(
  '/index',
  validateRequest({
    params: ragOrgParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN], {
    orgIdParam: 'organizationId',
  }),
  ragController.triggerBatchIndex,
);

// 3. Index a specific entity (Owner/Admin/Member)
router.post(
  '/index/entity',
  validateRequest({
    params: ragOrgParamSchema,
    body: indexEntitySchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  ragController.triggerEntityIndex,
);

// 4. List indexed knowledge documents (All org members)
router.get(
  '/documents',
  validateRequest({
    params: ragOrgParamSchema,
    query: listKnowledgeQuerySchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  ragController.listKnowledge,
);

// 5. Get RAG indexing statistics (All org members)
router.get(
  '/stats',
  validateRequest({
    params: ragOrgParamSchema,
  }),
  authorizeOrgRole(ALL_ROLES, {
    orgIdParam: 'organizationId',
  }),
  ragController.getStats,
);

export const ragRouter = router;
