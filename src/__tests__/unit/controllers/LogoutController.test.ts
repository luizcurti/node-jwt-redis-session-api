import { NextFunction, Request, Response } from 'express';
import { LogoutController } from '../../../controllers/LogoutController';
import { AuthService } from '../../../services/AuthService';

describe('LogoutController', () => {
  let authService: jest.Mocked<Pick<AuthService, 'logout'>>;
  let controller: LogoutController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    authService = { logout: jest.fn() };
    controller = new LogoutController(authService as unknown as AuthService);
    request = { sessionId: 'session-1' };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 and logs out the current session', async () => {
    authService.logout.mockResolvedValueOnce(undefined);

    await controller.handle(request as Request, response as Response, next);

    expect(authService.logout).toHaveBeenCalledWith('session-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Logout successful',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next', async () => {
    const error = new Error('boom');
    authService.logout.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
