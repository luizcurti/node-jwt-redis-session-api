import { NextFunction, Request, Response } from 'express';
import { CreateUserController } from '../../../controllers/CreateUserController';
import { UserService } from '../../../services/UserService';

describe('CreateUserController', () => {
  let userService: jest.Mocked<Pick<UserService, 'createUser'>>;
  let controller: CreateUserController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    userService = { createUser: jest.fn() };
    controller = new CreateUserController(
      userService as unknown as UserService
    );
    request = { body: { username: 'newuser' } };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 201 with the new user id on success', async () => {
    userService.createUser.mockResolvedValueOnce({ id: 'user-1' });

    await controller.handle(request as Request, response as Response, next);

    expect(userService.createUser).toHaveBeenCalledWith(request.body);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({
      message: 'User created successfully',
      userId: 'user-1',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next', async () => {
    const error = new Error('boom');
    userService.createUser.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
