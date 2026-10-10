export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown, code = 'conflict') => new AppError(409, code, message, details);
export const unprocessable = (message: string, details?: unknown, code = 'unprocessable') =>
  new AppError(422, code, message, details);

export function isDuplicateKeyError(err: unknown): err is { code: 11000; keyPattern?: Record<string, number> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
