import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Request-validation middleware (PRD §2 API hardening). Parses each provided
 * section with zod; 400s with per-issue paths on failure, and replaces the
 * request section with the parsed value (typed, unknown keys stripped) on
 * success.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, res, next) => {
    const issues: Array<{ path: string; message: string }> = [];
    for (const section of ['params', 'query', 'body'] as const) {
      const schema = schemas[section];
      if (!schema) continue;
      const result = schema.safeParse(req[section]);
      if (result.success) {
        // Express 5 exposes query/params via getters; define the parsed value.
        Object.defineProperty(req, section, { value: result.data, writable: true });
      } else {
        for (const issue of result.error.issues) {
          issues.push({ path: [section, ...issue.path].join('.'), message: issue.message });
        }
      }
    }
    if (issues.length > 0) {
      res.status(400).json({ error: 'Invalid request.', issues });
      return;
    }
    next();
  };
}
