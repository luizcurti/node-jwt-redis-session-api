import { RequestHandler } from 'express';
import { ForbiddenError } from '../errors/AppError';
import { UserRole } from '../types/user';

/**
 * Must run after `authentication` — relies on `request.userRole`, which
 * only the auth middleware sets. Role is embedded in the access token at
 * issuance (see TokenService/AuthService), so this is a pure claim check —
 * no extra Postgres/Redis round trip per request.
 */
export function requireRole(role: UserRole): RequestHandler {
  return function authorization(request, response, next): void {
    if (request.userRole !== role) {
      throw new ForbiddenError('You do not have access to this resource.');
    }

    next();
  };
}
