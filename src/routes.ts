import { Router } from 'express';
import { CreateUserController } from './controllers/CreateUserController';
import { GetUserInfoController } from './controllers/GetUserInfoController';
import { ListUsersController } from './controllers/ListUsersController';
import { LoginUserController } from './controllers/LoginUserController';
import { LogoutAllController } from './controllers/LogoutAllController';
import { LogoutController } from './controllers/LogoutController';
import { RefreshTokenController } from './controllers/RefreshTokenController';
import { createAuthMiddleware } from './middleware/auth';
import {
  createRedisRateLimiter,
  refreshTokenSessionKey,
} from './middleware/rateLimiter';
import { requireRole } from './middleware/rbac';
import { pool } from './postgres';
import { redisClient } from './redisConfig';
import { CacheRepository } from './repositories/CacheRepository';
import { SessionRepository } from './repositories/SessionRepository';
import { UserRepository } from './repositories/UserRepository';
import { AuthService } from './services/AuthService';
import { LoginThrottle, LoginThrottleOptions } from './services/LoginThrottle';
import { TokenService } from './services/TokenService';
import { UserService } from './services/UserService';

export type RateLimitPolicy = { windowMs: number; max: number };

export type RateLimitConfig = {
  // Baseline per-IP throttle on every /v1 route.
  api: RateLimitPolicy;
  // Per-IP, on POST /v1/login.
  login: RateLimitPolicy;
  // Per-session (see refreshTokenSessionKey), on POST /v1/auth/refresh.
  refresh: RateLimitPolicy;
  // Per-IP, on /ready and /metrics.
  meta: RateLimitPolicy;
  // Per-account failed-login backoff (LoginThrottle).
  loginThrottle: LoginThrottleOptions;
};

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  api: { windowMs: 60 * 1000, max: 100 },
  login: { windowMs: 15 * 60 * 1000, max: 20 },
  refresh: { windowMs: 15 * 60 * 1000, max: 10 },
  meta: { windowMs: 60 * 1000, max: 60 },
  loginThrottle: {},
};

// Composition root: every collaborator is built and wired in here.
export function createRouter(
  rateLimits: RateLimitConfig = DEFAULT_RATE_LIMITS
): Router {
  const userRepository = new UserRepository(pool);
  const cacheRepository = new CacheRepository(redisClient);
  const sessionRepository = new SessionRepository(redisClient);
  const tokenService = new TokenService();
  const loginThrottle = new LoginThrottle(
    redisClient,
    rateLimits.loginThrottle
  );

  const userService = new UserService(userRepository, cacheRepository);
  const authService = new AuthService(
    userRepository,
    cacheRepository,
    sessionRepository,
    tokenService,
    loginThrottle
  );

  const createUserController = new CreateUserController(userService);
  const loginUserController = new LoginUserController(authService);
  const refreshTokenController = new RefreshTokenController(authService);
  const logoutController = new LogoutController(authService);
  const logoutAllController = new LogoutAllController(authService);
  const getUserInfoController = new GetUserInfoController(userService);
  const listUsersController = new ListUsersController(userService);
  const authentication = createAuthMiddleware(tokenService, sessionRepository);
  const requireAdmin = requireRole('admin');

  const loginRateLimiter = createRedisRateLimiter(
    redisClient,
    {
      ...rateLimits.login,
      handler: (_request, response) => {
        response
          .status(429)
          .json({ error: 'Too many login attempts. Please try again later.' });
      },
    },
    'rl:ip:login:'
  );
  const refreshRateLimiter = createRedisRateLimiter(
    redisClient,
    {
      ...rateLimits.refresh,
      keyGenerator: refreshTokenSessionKey,
      handler: (_request, response) => {
        response.status(429).json({
          error: 'Too many refresh attempts. Please try again later.',
        });
      },
    },
    'rl:refresh:'
  );
  // Baseline per-IP throttle applied to every /v1 route, including ones
  // that only have `authentication` in their own chain — an authenticated
  // or compromised client still can't hammer PostgreSQL/Redis at an
  // unbounded rate. Login/refresh stack their own limiter on top.
  const apiRateLimiter = createRedisRateLimiter(
    redisClient,
    rateLimits.api,
    'rl:ip:api:'
  );

  const router = Router();

  router.use(apiRateLimiter);

  router.post('/users', createUserController.handle);
  router.post('/login', loginRateLimiter, loginUserController.handle);
  router.post(
    '/auth/refresh',
    refreshRateLimiter,
    refreshTokenController.handle
  );
  router.post('/auth/logout', authentication, logoutController.handle);
  router.post('/auth/logout-all', authentication, logoutAllController.handle);
  router.get('/users/me', authentication, getUserInfoController.handle);
  router.get(
    '/admin/users',
    authentication,
    requireAdmin,
    listUsersController.handle
  );

  return router;
}
