import { NextFunction, Request, Response } from 'express';
import { GetUserInfoController } from '../../../controllers/GetUserInfoController';
import { UserService } from '../../../services/UserService';
import { ValidationError } from '../../../errors/AppError';

describe('GetUserInfoController', () => {
  let userService: jest.Mocked<Pick<UserService, 'getUserProfile'>>;
  let controller: GetUserInfoController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  const profile = {
    id: 'user-1',
    name: 'Test',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user' as const,
  };

  beforeEach(() => {
    userService = { getUserProfile: jest.fn() };
    controller = new GetUserInfoController(
      userService as unknown as UserService
    );
    request = { params: { id: 'user-1' }, userId: 'user-1' };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 with the profile on success', async () => {
    userService.getUserProfile.mockResolvedValueOnce(profile);

    await controller.handle(request as Request, response as Response, next);

    expect(userService.getUserProfile).toHaveBeenCalledWith('user-1', 'user-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(profile);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a ValidationError to next when the id param is missing', async () => {
    request.params = {};

    await controller.handle(request as Request, response as Response, next);

    expect(userService.getUserProfile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('forwards service errors to next (e.g. IDOR/not found)', async () => {
    const error = new Error('boom');
    userService.getUserProfile.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
