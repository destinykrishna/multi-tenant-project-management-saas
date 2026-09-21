import { Router } from 'express';
import { edgeController } from './edge.controller.js';
import { requirePlatformAdmin } from '../../middlewares/authorization.middleware.js';

const router = Router();

// Public edge telemetry (Cloudflare ray, country, proxy status)
router.get('/edge-status', edgeController.getStatus);

// Turnstile verification endpoint
router.post('/turnstile/verify', edgeController.verifyTurnstile);

// Purge edge cache (Requires platform / system administrative authorization)
router.post('/edge-cache/purge', requirePlatformAdmin, edgeController.purgeCache);

export { router as edgeRouter };
