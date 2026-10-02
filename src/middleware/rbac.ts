import { RequestHandler } from 'express';
import { ForbiddenError } from '../errors/AppError';
import { UserRole } from '../types/user';

// Must run after `authentication`, which sets `request.userRole` from the
// access token — a pure claim check, no extra Postgres/Redis round trip.
export function requireRole(role: UserRole): RequestHandler {
  return function authorization(request, response, next): void {
    if (request.userRole !== role) {
      throw new ForbiddenError('You do not have access to this resource.');
    }

    next();
  };
}
