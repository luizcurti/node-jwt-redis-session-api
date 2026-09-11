import { NextFunction, Request, Response } from 'express';
import { LoginUserController } from '../../../controllers/LoginUserController';
import { AuthService } from '../../../services/AuthService';

describe('LoginUserController', () => {
  let authService: jest.Mocked<Pick<AuthService, 'login'>>;
  let controller: LoginUserController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  const loginResult = {
    accessToken: 'signed-access-token',
    refreshToken: 'session-1.validator',
    user: {
      id: 'user-1',
      name: 'Test',
      username: 'testuser',
      email: 'test@example.com',
    },
  };

  beforeEach(() => {
    authService = { login: jest.fn() };
    controller = new LoginUserController(authService as unknown as AuthService);
    request = { body: { username: 'testuser', password: 'password123456' } };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 with the token and user on success', async () => {
    authService.login.mockResolvedValueOnce(loginResult);

    await controller.handle(request as Request, response as Response, next);

    expect(authService.login).toHaveBeenCalledWith(request.body);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Login successful',
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
      user: loginResult.user,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next', async () => {
    const error = new Error('boom');
    authService.login.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
