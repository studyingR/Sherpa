export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'CONSENT_REQUIRED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  CONSENT_REQUIRED: 422,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Error format: { error: { code, message, details? } } (docs/04). Messages never blame the user. */
export class AppError extends Error {
  readonly status: number;
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'That item') => new AppError('NOT_FOUND', `${what} wasn't found.`);
export const forbidden = (msg = "That account isn't in your book.") => new AppError('FORBIDDEN', msg);
export const conflict = (msg: string, details?: unknown) => new AppError('CONFLICT', msg, details);
