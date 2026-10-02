import { NextFunction, Request, Response } from 'express';
import { LogoutAllController } from '../../../controllers/LogoutAllController';
import { AuthService } from '../../../services/AuthService';

describe('LogoutAllController', () => {
  let authService: jest.Mocked<Pick<AuthService, 'logoutAll'>>;
  let controller: LogoutAllController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    authService = { logoutAll: jest.fn() };
    controller = new LogoutAllController(authService as unknown as AuthService);
    request = { userId: 'user-1', sessionId: 'session-1' };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('revokes every session of the caller and reports how many', async () => {
    authService.logoutAll.mockResolvedValueOnce(3);

    await controller.handle(request as Request, response as Response, next);

    expect(authService.logoutAll).toHaveBeenCalledWith('user-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Logged out of all sessions',
      revokedSessions: 3,
    });
  });

  it('forwards service errors to next', async () => {
    const error = new Error('boom');
    authService.logoutAll.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
