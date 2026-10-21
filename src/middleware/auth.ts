import { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/AppError';
import { SessionRepository } from '../repositories/SessionRepository';
import { TokenService } from '../services/TokenService';
import { asyncHandler } from './asyncHandler';

export function createAuthMiddleware(
  tokenService: TokenService,
  sessionRepository: SessionRepository
): RequestHandler {
  return asyncHandler(async function authentication(request, response, next) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Token missing');
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Invalid token');
    }

    const { subject, sessionId, role } = tokenService.verifyAccessToken(token);
    const session = await sessionRepository.get(sessionId);

    // A session that belongs to someone else can only mean a forged or
    // mis-issued token — treat it exactly like a revoked one.
    if (!session || session.userId !== subject) {
      throw new UnauthorizedError('Session expired or revoked');
    }

    request.userId = subject;
    request.sessionId = sessionId;
    request.userRole = role;

    next();
  });
}
