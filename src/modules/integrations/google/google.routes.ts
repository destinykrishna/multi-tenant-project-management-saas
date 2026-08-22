import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth.middleware.js';
import { validateRequest } from '../../../middlewares/validation.middleware.js';
import { googleController } from './google.controller.js';
import {
  googleCallbackQuerySchema,
  sendGmailSchema,
  createCalendarEventSchema,
  updateCalendarEventSchema,
  listCalendarEventsQuerySchema,
} from './google.schema.js';

const router = Router();

// 1. Generate Google OAuth authorization URL (Requires App Authentication)
router.get('/connect', authenticate, googleController.connect);

// 2. Google OAuth callback endpoint (Receives code & state from Google redirect)
router.get(
  '/callback',
  validateRequest({ query: googleCallbackQuerySchema }),
  googleController.callback,
);

// 3. Get current Google integration connection status (Requires App Authentication)
router.get('/status', authenticate, googleController.getStatus);

// 4. Disconnect and revoke Google account integration (Requires App Authentication)
router.post('/disconnect', authenticate, googleController.disconnect);

// 5. Send email via user's connected Gmail account (Requires App Authentication)
router.post(
  '/gmail/send',
  authenticate,
  validateRequest({ body: sendGmailSchema }),
  googleController.sendGmail,
);

// 6. Google Calendar direct endpoints (Requires App Authentication)
router.get(
  '/calendar/events',
  authenticate,
  validateRequest({ query: listCalendarEventsQuerySchema }),
  googleController.listCalendarEvents,
);

router.get('/calendar/events/:eventId', authenticate, googleController.getCalendarEvent);

router.post(
  '/calendar/events',
  authenticate,
  validateRequest({ body: createCalendarEventSchema }),
  googleController.createCalendarEvent,
);

router.patch(
  '/calendar/events/:eventId',
  authenticate,
  validateRequest({ body: updateCalendarEventSchema }),
  googleController.updateCalendarEvent,
);

router.delete('/calendar/events/:eventId', authenticate, googleController.deleteCalendarEvent);

// 7. Google Meet direct endpoint (Requires App Authentication)
router.post(
  '/meet/generate',
  authenticate,
  validateRequest({ body: createCalendarEventSchema }),
  googleController.generateMeet,
);

export const googleRouter = router;
