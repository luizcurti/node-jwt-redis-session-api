import { NextFunction, Request, Response } from 'express';
import { GetUserInfoController } from '../../../controllers/GetUserInfoController';
import { UserService } from '../../../services/UserService';

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
    request = { userId: 'user-1' };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 with the profile on success', async () => {
    userService.getUserProfile.mockResolvedValueOnce(profile);

    await controller.handle(request as Request, response as Response, next);

    expect(userService.getUserProfile).toHaveBeenCalledWith('user-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(profile);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next (e.g. not found)', async () => {
    const error = new Error('boom');
    userService.getUserProfile.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
