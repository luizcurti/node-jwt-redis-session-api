import { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../../middleware/asyncHandler';

describe('asyncHandler middleware', () => {
  let request: Partial<Request>;
  let response: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    request = {};
    response = {};
    next = jest.fn();
  });

  it('calls the wrapped handler and does not call next on success', async () => {
    const handler = jest.fn().mockResolvedValueOnce(undefined);
    const wrapped = asyncHandler(handler);

    await wrapped(request as Request, response as Response, next);

    expect(handler).toHaveBeenCalledWith(request, response, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejected promise to next', async () => {
    const error = new Error('boom');
    const handler = jest.fn().mockRejectedValueOnce(error);
    const wrapped = asyncHandler(handler);

    await wrapped(request as Request, response as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
