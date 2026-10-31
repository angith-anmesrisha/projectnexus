import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Read a trimmed string field from a request body, enforcing length limits. */
export function str(
  body: unknown,
  key: string,
  opts: { min?: number; max: number; optional?: boolean },
): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null) {
    if (opts.optional) return undefined;
    throw badRequest(`${key} is required`);
  }
  if (typeof value !== 'string') throw badRequest(`${key} must be a string`);
  const trimmed = value.trim();
  const min = opts.min ?? 0;
  if (trimmed.length < min) throw badRequest(`${key} must be at least ${min} characters`);
  if (trimmed.length > opts.max) throw badRequest(`${key} must be at most ${opts.max} characters`);
  return trimmed;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};
