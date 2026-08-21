import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../utils/errors.js';

interface RequestValidators {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validateRequest(validators: RequestValidators) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: Record<string, string[]> = {};

    if (validators.body) {
      const result = validators.body.safeParse(req.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = issue.path.join('.') || 'body';
          const current = errors[key] ?? [];
          current.push(issue.message);
          errors[key] = current;
        }
      } else {
        req.body = result.data;
      }
    }

    if (validators.query) {
      const result = validators.query.safeParse(req.query);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = issue.path.join('.') || 'query';
          const current = errors[key] ?? [];
          current.push(issue.message);
          errors[key] = current;
        }
      } else {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }

    if (validators.params) {
      const result = validators.params.safeParse(req.params);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = issue.path.join('.') || 'params';
          const current = errors[key] ?? [];
          current.push(issue.message);
          errors[key] = current;
        }
      } else {
        Object.defineProperty(req, 'params', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }

    if (Object.keys(errors).length > 0) {
      next(new ValidationError('Validation failed', errors));
      return;
    }

    next();
  };
}
