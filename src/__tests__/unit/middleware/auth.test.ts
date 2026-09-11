import { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../../../errors/AppError';
import { createAuthMiddleware } from '../../../middleware/auth';
import { SessionRepository } from '../../../repositories/SessionRepository';
import { TokenService } from '../../../services/TokenService';

describe('authentication middleware', () => {
  let tokenService: jest.Mocked<Pick<TokenService, 'verifyAccessToken'>>;
  let sessionRepository: jest.Mocked<Pick<SessionRepository, 'get'>>;
  let authentication: RequestHandler;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    tokenService = { verifyAccessToken: jest.fn() };
    sessionRepository = { get: jest.fn() };
    authentication = createAuthMiddleware(
      tokenService as unknown as TokenService,
      sessionRepository as unknown as SessionRepository
    );
    request = { headers: {} };
    response = {};
    next = jest.fn();
  });

  it('forwards UnauthorizedError to next when the header is missing', async () => {
    await authentication(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(next.mock.calls[0][0]).toHaveProperty('message', 'Token missing');
  });

  it('forwards UnauthorizedError to next when the header has no token', async () => {
    request.headers = { authorization: 'Bearer' };

    await authentication(request as Request, response as Response, next);

    expect(next.mock.calls[0][0]).toHaveProperty('message', 'Invalid token');
  });

  it('forwards UnauthorizedError when the scheme is not Bearer', async () => {
    request.headers = { authorization: 'Foo abc' };

    await authentication(request as Request, response as Response, next);

    expect(next.mock.calls[0][0]).toHaveProperty('message', 'Invalid token');
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('propagates the error thrown by TokenService.verifyAccessToken', async () => {
    request.headers = { authorization: 'Bearer bad-token' };
    tokenService.verifyAccessToken.mockImplementation(() => {
      throw new UnauthorizedError('Invalid token');
    });

    await authentication(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(sessionRepository.get).not.toHaveBeenCalled();
  });

  it('forwards UnauthorizedError when the session no longer exists', async () => {
    request.headers = { authorization: 'Bearer good-token' };
    tokenService.verifyAccessToken.mockReturnValue({
      subject: 'user-1',
      sessionId: 'session-1',
    });
    sessionRepository.get.mockResolvedValueOnce(null);

    await authentication(request as Request, response as Response, next);

    expect(next.mock.calls[0][0]).toHaveProperty(
      'message',
      'Session expired or revoked'
    );
  });

  it('sets request.userId/sessionId and calls next on a valid session', async () => {
    request.headers = { authorization: 'Bearer good-token' };
    tokenService.verifyAccessToken.mockReturnValue({
      subject: 'user-1',
      sessionId: 'session-1',
    });
    sessionRepository.get.mockResolvedValueOnce({
      userId: 'user-1',
      refreshTokenHash: 'hash',
      createdAt: 0,
      expiresAt: 0,
    });

    await authentication(request as Request, response as Response, next);

    expect(request.userId).toBe('user-1');
    expect(request.sessionId).toBe('session-1');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
