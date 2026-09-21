import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeOrgRole } from '../../middlewares/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { OrganizationRole } from '../../constants/roles.js';
import { BadRequestError } from '../../utils/errors.js';
import {
  attachmentTaskParamSchema,
  attachmentParamSchema,
  listAttachmentsQuerySchema,
} from './attachment.schema.js';
import { attachmentController } from './attachment.controller.js';
import { MAX_ATTACHMENT_SIZE_BYTES } from './attachment.storage.js';

const router = Router({ mergeParams: true });

// Configure multer with memory storage and size limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE_BYTES,
    files: 1,
  },
});

// Multer error handling wrapper
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(
            new BadRequestError(
              `File size exceeds maximum allowed limit of ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB`,
              'FILE_TOO_LARGE',
            ),
          );
          return;
        }
        next(new BadRequestError(`File upload error: ${err.message}`, 'FILE_UPLOAD_ERROR'));
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

// All attachment routes require authentication
router.use(authenticate);

// 1. Upload Task Attachment (OWNER, ADMIN, MEMBER)
router.post(
  '/',
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  handleUpload,
  validateRequest({
    params: attachmentTaskParamSchema,
  }),
  attachmentController.upload,
);

// 2. List Task Attachments (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/',
  validateRequest({
    params: attachmentTaskParamSchema,
    query: listAttachmentsQuerySchema,
  }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'organizationId' },
  ),
  attachmentController.list,
);

// 3. Download Task Attachment (OWNER, ADMIN, MEMBER, VIEWER)
router.get(
  '/:attachmentId/download',
  validateRequest({
    params: attachmentParamSchema,
  }),
  authorizeOrgRole(
    [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ],
    { orgIdParam: 'organizationId' },
  ),
  attachmentController.download,
);

// 4. Delete Task Attachment (OWNER, ADMIN, MEMBER - author or moderator checked in service)
router.delete(
  '/:attachmentId',
  validateRequest({
    params: attachmentParamSchema,
  }),
  authorizeOrgRole([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER], {
    orgIdParam: 'organizationId',
  }),
  attachmentController.delete,
);

export const attachmentRouter = router;
