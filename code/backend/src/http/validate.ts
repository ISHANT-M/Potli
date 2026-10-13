/** Request validation with zod: strict objects, field-level errors, typed results on req.valid. */
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.ts';

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

type Output<S extends z.ZodType | undefined> = S extends z.ZodType ? z.output<S> : undefined;

export interface Validated<S extends RequestSchemas> {
  body: Output<S['body']>;
  query: Output<S['query']>;
  params: Output<S['params']>;
}

/** Unknown keys are rejected, so a typo in a client never silently does nothing. */
function strictly(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

function fieldErrors(error: z.ZodError, prefix: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || prefix;
    fields[path] ??= issue.message;
  }
  return fields;
}

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const valid: Record<string, unknown> = {};
    const fields: Record<string, string> = {};

    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const source: unknown = part === 'body' ? (req.body ?? {}) : req[part];
      const result = strictly(schema).safeParse(source);
      if (result.success) valid[part] = result.data;
      else Object.assign(fields, fieldErrors(result.error, part));
    }

    if (Object.keys(fields).length > 0) {
      next(new HttpError(400, 'VALIDATION_FAILED', 'Some details need fixing.', fields));
      return;
    }
    req.valid = valid;
    next();
  };
}

/** Read what `validate(schemas)` parsed; pass the same schemas object to get typed results. */
export function validated<S extends RequestSchemas>(req: Request, _schemas: S): Validated<S> {
  return (req.valid ?? {}) as unknown as Validated<S>;
}
