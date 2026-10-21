import { NextFunction, Request, Response } from 'express';
import { RefreshTokenController } from '../../../controllers/RefreshTokenController';
import { AuthService } from '../../../services/AuthService';

describe('RefreshTokenController', () => {
  let authService: jest.Mocked<Pick<AuthService, 'refresh'>>;
  let controller: RefreshTokenController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  const refreshResult = {
    accessToken: 'new-access-token',
    refreshToken: 'session-1.new-validator',
  };

  beforeEach(() => {
    authService = { refresh: jest.fn() };
    controller = new RefreshTokenController(
      authService as unknown as AuthService
    );
    request = { body: { refreshToken: 'session-1.current-validator' } };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 with new tokens on success', async () => {
    authService.refresh.mockResolvedValueOnce(refreshResult);

    await controller.handle(request as Request, response as Response, next);

    expect(authService.refresh).toHaveBeenCalledWith(
      'session-1.current-validator'
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Token refreshed successfully',
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next', async () => {
    const error = new Error('boom');
    authService.refresh.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
