import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { logger } from '../logger';

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  (request.log ?? logger).error({ err: error }, 'Unhandled error');
  response.status(500).json({ error: 'Internal server error.' });
}
