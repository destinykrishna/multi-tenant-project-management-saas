import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import proxyAddr from 'proxy-addr';
import { env } from '../config/env.js';

export interface EdgeMetadata {
  rayId: string;
  clientIp: string;
  country: string;
  isCloudflare: boolean;
  proxyHop: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    edge?: EdgeMetadata;
  }
}

// Published Cloudflare IP CIDR ranges (https://www.cloudflare.com/ips/)
export const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

export const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

// Compile trusted proxy boundary: loopback, linklocal, private RFC 1918 networks, and Cloudflare CIDRs
const trustedProxies: string[] = [
  'loopback',
  'linklocal',
  'uniquelocal',
  ...CLOUDFLARE_IPV4_CIDRS,
  ...CLOUDFLARE_IPV6_CIDRS,
];

export const isTrustedProxy = proxyAddr.compile(trustedProxies);

/**
 * Resolves the socket remote address, permitting controlled test override during testing only.
 */
export function getSocketPeerAddress(req: Request): string {
  if (process.env['NODE_ENV'] === 'test' && req.headers['x-test-remote-addr']) {
    const raw = req.headers['x-test-remote-addr'];
    return (Array.isArray(raw) ? raw[0] : raw) || '127.0.0.1';
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Cloudflare Edge Security & Telemetry Middleware.
 * Strictly verifies that the connection arrived through a verified Cloudflare proxy
 * or trusted local proxy boundary before trusting forwarded headers (CF-Connecting-IP, X-Forwarded-For).
 */
export function cloudflareEdgeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const socketPeer = getSocketPeerAddress(req);
  const isPeerTrusted = isTrustedProxy(socketPeer, 0);

  let clientIp: string;
  let isCloudflare: boolean;
  let rayId: string;
  let country = 'LOCAL';
  let proxyHop: string;

  if (!isPeerTrusted) {
    // UNTRUSTED DIRECT CLIENT:
    // Connection arrived directly from an untrusted peer outside the proxy boundary.
    // Client-supplied CF-Connecting-IP, True-Client-IP, and X-Forwarded-For are untrusted spoof attempts.
    // Fall back strictly to the actual connection socket peer IP.
    clientIp = socketPeer;
    isCloudflare = false;
    rayId = `direct-${randomUUID().slice(0, 16)}`;
    country = 'DIRECT';
    proxyHop = 'Direct (Untrusted Connection - Forwarded Headers Ignored)';
  } else {
    // TRUSTED PROXY BOUNDARY:
    // Connection arrived through verified loopback, private proxy, or Cloudflare Anycast edge IP.
    const cfRayHeader = req.headers['cf-ray'];
    const rawRay = Array.isArray(cfRayHeader) ? cfRayHeader[0] : cfRayHeader;
    const cfRayDetected = Boolean(rawRay && rawRay.trim().length > 0);

    const cfConnectingIp = req.headers['cf-connecting-ip'];
    const rawCfIp = Array.isArray(cfConnectingIp)
      ? cfConnectingIp[0]?.trim()
      : cfConnectingIp?.trim();

    const trueClientIp = req.headers['true-client-ip'];
    const rawTrueIp = Array.isArray(trueClientIp) ? trueClientIp[0]?.trim() : trueClientIp?.trim();

    // Verify candidate Cloudflare IP is syntactically valid IP
    const validCfIp =
      rawCfIp && net.isIP(rawCfIp) ? rawCfIp : rawTrueIp && net.isIP(rawTrueIp) ? rawTrueIp : null;

    if (validCfIp) {
      clientIp = validCfIp;
      isCloudflare = true;
      rayId = cfRayDetected && rawRay ? rawRay : `cf-${randomUUID().slice(0, 16)}`;
      proxyHop = 'Cloudflare Anycast -> Trusted Proxy -> Express';
    } else {
      // Fall back to Express's proxy-addr derived req.ip or socket peer
      clientIp = req.ip || socketPeer;
      isCloudflare = cfRayDetected;
      rayId = cfRayDetected && rawRay ? rawRay : `proxy-${randomUUID().slice(0, 16)}`;
      proxyHop = isCloudflare ? 'Cloudflare Anycast -> Nginx -> Express' : 'Local / Internal Proxy';
    }

    const cfCountry = req.headers['cf-ipcountry'];
    const rawCountry = Array.isArray(cfCountry) ? cfCountry[0] : cfCountry;
    if (rawCountry && rawCountry.trim().length > 0) {
      country = rawCountry.trim();
    }
  }

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
    proxyHop,
  };

  // Attach Ray ID & Edge header to response for client tracing
  res.setHeader('CF-Ray', rayId);
  res.setHeader('X-Edge-Country', country);

  next();
}
