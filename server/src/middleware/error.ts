import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError, isDuplicateKeyError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'File upload failed';
    return res.status(400).json({ error: { code: 'upload_failed', message } });
  }
  if (isDuplicateKeyError(err)) {
    return res.status(409).json({ error: { code: 'duplicate', message: 'That record already exists' } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed identifier or value' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'validation_failed', message: 'Invalid data' } });
  }
  const status = (err as { status?: number; type?: string })?.status;
  if (status === 413) return res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large' } });
  if (status === 400 && (err as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  }
  logger.error('unhandled error', { method: req.method, path: req.path, err });
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Try again shortly.' } });
}
