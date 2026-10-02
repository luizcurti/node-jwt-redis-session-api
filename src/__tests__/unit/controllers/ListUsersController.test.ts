import { NextFunction, Request, Response } from 'express';
import { ListUsersController } from '../../../controllers/ListUsersController';
import { UserService } from '../../../services/UserService';

describe('ListUsersController', () => {
  let userService: jest.Mocked<Pick<UserService, 'listUsers'>>;
  let controller: ListUsersController;
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  const listResult = {
    items: [
      {
        id: 'user-1',
        name: 'Test',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user' as const,
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  };

  beforeEach(() => {
    userService = { listUsers: jest.fn() };
    controller = new ListUsersController(userService as unknown as UserService);
    request = { query: { limit: '20', offset: '0' } };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('returns 200 with the paginated result on success', async () => {
    userService.listUsers.mockResolvedValueOnce(listResult);

    await controller.handle(request as Request, response as Response, next);

    expect(userService.listUsers).toHaveBeenCalledWith(request.query);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(listResult);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to next (e.g. invalid pagination params)', async () => {
    const error = new Error('boom');
    userService.listUsers.mockRejectedValueOnce(error);

    await controller.handle(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
