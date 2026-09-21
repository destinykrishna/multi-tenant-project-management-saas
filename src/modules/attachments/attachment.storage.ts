import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Blacklisted dangerous executable extensions and active web content
export const DISALLOWED_EXTENSIONS = new Set([
  // Executable / Script / Binary
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.php',
  '.phtml',
  '.js',
  '.mjs',
  '.vbs',
  '.msi',
  '.dll',
  '.com',
  '.scr',
  '.jar',
  // Active Web Content / XSS vectors
  '.html',
  '.htm',
  '.svg',
  '.xml',
  '.xhtml',
  '.shtml',
  '.jsp',
  '.asp',
  '.aspx',
]);

// Disallowed MIME types that could trigger browser execution
export const DISALLOWED_MIME_TYPES = new Set([
  'text/html',
  'text/xml',
  'application/xml',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-php',
  'application/x-httpd-php',
]);

// Safe MIME types mapped to expected file extensions for downloads
const SAFE_DOWNLOAD_MIME_MAP: Record<string, string[]> = {
  'text/plain': ['.txt', '.log', '.md', '.csv', '.json'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
  'application/gzip': ['.gz'],
};

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Validates that storageKey contains no path traversal sequences and stays strictly inside UPLOAD_DIR.
 */
export function getSafeFilePath(storageKey: string): string {
  if (
    !storageKey ||
    typeof storageKey !== 'string' ||
    storageKey.includes('..') ||
    storageKey.includes('/') ||
    storageKey.includes('\\') ||
    path.isAbsolute(storageKey)
  ) {
    throw new BadRequestError(
      'Invalid storage key or path traversal detected',
      'PATH_TRAVERSAL_DETECTED',
    );
  }

  const resolvedPath = path.resolve(UPLOAD_DIR, storageKey);
  const normalizedUploadDir = path.normalize(UPLOAD_DIR);

  if (!resolvedPath.startsWith(normalizedUploadDir)) {
    throw new BadRequestError(
      'Path traversal detected outside upload directory',
      'PATH_TRAVERSAL_DETECTED',
    );
  }

  return resolvedPath;
}

/**
 * Resolves a safe Content-Type header for attachment downloads.
 * Unrecognized or untrusted MIME types default strictly to application/octet-stream.
 */
export function getSafeDownloadContentType(originalName: string, storedMimeType?: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (DISALLOWED_EXTENSIONS.has(ext)) {
    return 'application/octet-stream';
  }

  const normalizedMime = (storedMimeType || '').toLowerCase().split(';')[0]?.trim() || '';
  if (DISALLOWED_MIME_TYPES.has(normalizedMime)) {
    return 'application/octet-stream';
  }

  const allowedExtensions = SAFE_DOWNLOAD_MIME_MAP[normalizedMime];
  if (allowedExtensions && allowedExtensions.includes(ext)) {
    return normalizedMime;
  }

  return 'application/octet-stream';
}

/**
 * Validates file properties (extension, size, MIME type, content signatures).
 */
export function validateAttachmentFile(file?: Express.Multer.File | null): void {
  if (!file || file.buffer.length === 0) {
    throw new BadRequestError('File content is required', 'FILE_REQUIRED');
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new BadRequestError(
      `File size exceeds maximum allowed limit of ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB`,
      'FILE_TOO_LARGE',
    );
  }

  const ext = path.extname(file.originalname).toLowerCase().trim();
  if (DISALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestError(
      `File type "${ext}" is not permitted for upload`,
      'DISALLOWED_FILE_TYPE',
    );
  }

  if (!file.mimetype || file.mimetype.trim().length === 0) {
    throw new BadRequestError('MIME type is required', 'INVALID_MIME_TYPE');
  }

  const normalizedMime = file.mimetype.toLowerCase().split(';')[0]?.trim() || '';
  if (DISALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new BadRequestError(
      `MIME type "${file.mimetype}" is not permitted for upload`,
      'DISALLOWED_FILE_TYPE',
    );
  }

  // Content inspection: detect active web markup in non-text files to prevent MIME spoofing
  const bufferSnippet = file.buffer.subarray(0, 2048).toString('utf8').toLowerCase();
  const hasActiveWebMarkup =
    bufferSnippet.includes('<script') ||
    bufferSnippet.includes('<svg') ||
    bufferSnippet.includes('<?xml') ||
    bufferSnippet.includes('<html') ||
    bufferSnippet.includes('<!doctype html');

  if (hasActiveWebMarkup) {
    const isPlainText = ext === '.txt' || ext === '.log' || ext === '.md';
    if (!isPlainText) {
      throw new BadRequestError(
        'File content contains disallowed active web markup',
        'DISALLOWED_FILE_TYPE',
      );
    }
  }
}

/**
 * Writes an uploaded buffer to disk using a unique generated storageKey.
 */
export async function saveAttachmentToDisk(
  file: Express.Multer.File,
): Promise<{ storageKey: string; size: number }> {
  validateAttachmentFile(file);
  ensureUploadDir();

  const originalExt = path.extname(file.originalname).toLowerCase().slice(0, 16);
  // Ensure extension is sanitized
  const sanitizedExt = originalExt.replace(/[^a-z0-9.]/gi, '');
  const storageKey = `${randomUUID()}${sanitizedExt}`;

  const targetPath = getSafeFilePath(storageKey);
  await fs.promises.writeFile(targetPath, file.buffer);

  return {
    storageKey,
    size: file.size,
  };
}

/**
 * Deletes an attachment file from disk safely, ignoring missing physical files.
 */
export async function deleteAttachmentFromDisk(storageKey: string): Promise<void> {
  try {
    const targetPath = getSafeFilePath(storageKey);
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath);
    }
  } catch (error) {
    logger.warn(
      { error, storageKey },
      'Warning: Failed to remove physical file from disk during attachment deletion',
    );
  }
}
