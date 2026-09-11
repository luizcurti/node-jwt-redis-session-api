import { NextFunction, Request, Response } from 'express';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../errors/AppError';
import { logger } from '../../../logger';
import { errorHandler } from '../../../middleware/errorHandler';

describe('errorHandler middleware', () => {
  let response: Partial<Response>;
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it.each([
    [new ValidationError('bad input'), 400, 'bad input'],
    [new UnauthorizedError('no token'), 401, 'no token'],
    [new ForbiddenError('not yours'), 403, 'not yours'],
    [new NotFoundError('missing'), 404, 'missing'],
    [new ConflictError('duplicate'), 409, 'duplicate'],
  ])('maps %p to status %i', (error, status, message) => {
    errorHandler(error, {} as Request, response as Response, next);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith({ error: message });
  });

  it('maps unknown errors to a generic 500 and logs via the fallback logger', () => {
    const loggerErrorSpy = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => logger);

    errorHandler(new Error('boom'), {} as Request, response as Response, next);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Internal server error.',
    });
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Unhandled error'
    );

    loggerErrorSpy.mockRestore();
  });

  it('logs via the request-scoped logger when pino-http has attached one', () => {
    const requestLoggerErrorSpy = jest.fn();
    const request = {
      log: { error: requestLoggerErrorSpy },
    } as unknown as Request;

    errorHandler(new Error('boom'), request, response as Response, next);

    expect(requestLoggerErrorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Unhandled error'
    );
  });
});
