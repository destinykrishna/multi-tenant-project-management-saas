import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateRequest } from '../../middlewares/validation.middleware.js';
import { notificationParamSchema, listNotificationsQuerySchema } from './notification.schema.js';
import { notificationController } from './notification.controller.js';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

router.get(
  '/',
  validateRequest({ query: listNotificationsQuerySchema }),
  notificationController.list,
);
router.get('/unread', notificationController.getUnread);
router.patch('/read-all', notificationController.markAllRead);
router.patch(
  '/:id/read',
  validateRequest({ params: notificationParamSchema }),
  notificationController.markRead,
);

export { router as notificationRouter };
