import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export interface EdgeMetadata {
  rayId: string;
  clientIp: string;
  country: string;
  isCloudflare: boolean;
  proxyHop: string;
}

declare global {
  namespace Express {
    interface Request {
      edge?: EdgeMetadata;
    }
  }
}

/**
 * Cloudflare Edge Security & Telemetry Middleware.
 * Normalizes CF-Connecting-IP, CF-Ray tracing, and CF-IPCountry.
 */
export function cloudflareEdgeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const cfRayHeader = req.headers['cf-ray'];
  const rawRay = Array.isArray(cfRayHeader) ? cfRayHeader[0] : cfRayHeader;
  const isCloudflare = Boolean(rawRay && rawRay.trim().length > 0);

  // Assign or generate unique Ray ID for edge request tracing
  const rayId = isCloudflare && rawRay ? rawRay : `dev-${randomUUID().slice(0, 16)}`;

  // Extract client IP with Cloudflare priority
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const trueClientIp = req.headers['true-client-ip'];
  const forwardedFor = req.headers['x-forwarded-for'];

  const rawIp =
    (Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp) ||
    (Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp) ||
    (Array.isArray(forwardedFor) ? forwardedFor[0]?.split(',')[0] : forwardedFor?.split(',')[0]) ||
    req.ip ||
    req.socket.remoteAddress ||
    '127.0.0.1';

  const clientIp = rawIp.trim();

  // Country detection
  const cfCountry = req.headers['cf-ipcountry'];
  const country = (Array.isArray(cfCountry) ? cfCountry[0] : cfCountry) || 'LOCAL';

  // Optional Origin Pull Secret verification (enforces only Cloudflare can reach origin in production)
  if (env.CLOUDFLARE_ORIGIN_PULL_SECRET && env.NODE_ENV === 'production') {
    const customHeader = req.headers['x-origin-verify-secret'];
    if (customHeader !== env.CLOUDFLARE_ORIGIN_PULL_SECRET) {
      res.status(403).json({
        success: false,
        error: {
          code: 'ORIGIN_PULL_REJECTED',
          message: 'Direct origin connection rejected. Requests must traverse Cloudflare Edge WAF.',
        },
      });
      return;
    }
  }

  req.edge = {
    rayId,
    clientIp,
    country,
    isCloudflare,
    proxyHop: isCloudflare ? 'Cloudflare Anycast -> Nginx -> Express' : 'Direct / Dev',
  };

  // Attach Ray ID & Edge header to response for client tracing
  res.setHeader('CF-Ray', rayId);
  res.setHeader('X-Edge-Country', country);

  next();
}
