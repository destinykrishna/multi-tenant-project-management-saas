import { Router } from 'express';
import { edgeController } from './edge.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

// Public edge telemetry (Cloudflare ray, country, proxy status)
router.get('/edge-status', edgeController.getStatus);

// Turnstile verification endpoint
router.post('/turnstile/verify', edgeController.verifyTurnstile);

// Purge edge cache (Requires authenticated user / admin)
router.post('/edge-cache/purge', authenticate, edgeController.purgeCache);

export { router as edgeRouter };
