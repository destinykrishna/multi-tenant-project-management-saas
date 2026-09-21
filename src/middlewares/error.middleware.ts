import type { Request, Response, NextFunction } from 'express';
import { AppError, ValidationError } from '../utils/errors.js';
import { sendError } from '../utils/response.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route ${req.method} ${req.path} not found`, 404, 'ROUTE_NOT_FOUND'));
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Default to 500 Internal Server Error
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;

    if (err instanceof ValidationError) {
      details = err.errors;
    }

    // Log operational errors at warn level, unexpected ones at error
    if (err.isOperational) {
      logger.warn(
        { err, requestId: req.id, statusCode, code },
        `Operational error: ${err.message}`,
      );
    } else {
      logger.error(
        { err, requestId: req.id, statusCode, code },
        `Unexpected error: ${err.message}`,
      );
    }
  } else if (
    err.name === 'PrismaClientKnownRequestError' ||
    ('code' in err &&
      typeof (err as unknown as { code: unknown }).code === 'string' &&
      (err as unknown as { code: string }).code.startsWith('P'))
  ) {
    const prismaCode = (err as unknown as { code: string }).code;
    if (prismaCode === 'P2025') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = 'Resource not found';
    } else if (prismaCode === 'P2002') {
      statusCode = 409;
      code = 'CONFLICT';
      message = 'A resource with this unique constraint already exists';
    } else if (prismaCode === 'P2003') {
      statusCode = 400;
      code = 'BAD_REQUEST';
      message = 'Related resource not found or reference constraint violated';
    }
    logger.warn(
      { err, requestId: req.id, statusCode, code, prismaCode },
      `Database error: ${message}`,
    );
  } else {
    // Unknown/unexpected errors
    logger.error({ err, requestId: req.id, stack: err.stack }, `Unhandled error: ${err.message}`);
  }

  // In production, don't leak error details for non-operational errors
  if (env.NODE_ENV === 'production' && !(err instanceof AppError && err.isOperational)) {
    message = 'Internal server error';
    details = undefined;
  }

  // Include stack trace in development
  if (env.NODE_ENV === 'development') {
    details = {
      ...(typeof details === 'object' && details !== null ? details : {}),
      stack: err.stack,
    };
  }

  sendError(res, statusCode, code, message, details);
}
