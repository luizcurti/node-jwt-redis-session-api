import { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../../../errors/AppError';
import { requireRole } from '../../../middleware/rbac';

describe('requireRole', () => {
  let response: Partial<Response>;
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    response = {};
    jest.clearAllMocks();
  });

  it('calls next when the request has the required role', () => {
    const authorization = requireRole('admin');
    const request = { userRole: 'admin' } as Request;

    authorization(request, response as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('throws ForbiddenError when the request has a different role', () => {
    const authorization = requireRole('admin');
    const request = { userRole: 'user' } as Request;

    expect(() => authorization(request, response as Response, next)).toThrow(
      ForbiddenError
    );
    expect(next).not.toHaveBeenCalled();
  });
});
