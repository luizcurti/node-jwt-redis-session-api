import { Router } from 'express';
import { CreateUserController } from './controllers/CreateUserController';
import { GetUserInfoController } from './controllers/GetUserInfoController';
import { ListUsersController } from './controllers/ListUsersController';
import { LoginUserController } from './controllers/LoginUserController';
import { LogoutController } from './controllers/LogoutController';
import { RefreshTokenController } from './controllers/RefreshTokenController';
import { createAuthMiddleware } from './middleware/auth';
import {
  createRedisRateLimiter,
  createUsernameRateLimiter,
} from './middleware/rateLimiter';
import { requireRole } from './middleware/rbac';
import { pool } from './postgres';
import { redisClient } from './redisConfig';
import { CacheRepository } from './repositories/CacheRepository';
import { SessionRepository } from './repositories/SessionRepository';
import { UserRepository } from './repositories/UserRepository';
import { AuthService } from './services/AuthService';
import { TokenService } from './services/TokenService';
import { UserService } from './services/UserService';

const userRepository = new UserRepository(pool);
const cacheRepository = new CacheRepository(redisClient);
const sessionRepository = new SessionRepository(redisClient);
const tokenService = new TokenService();

const userService = new UserService(userRepository, cacheRepository);
const authService = new AuthService(
  userRepository,
  cacheRepository,
  sessionRepository,
  tokenService
);

const createUserController = new CreateUserController(userService);
const loginUserController = new LoginUserController(authService);
const refreshTokenController = new RefreshTokenController(authService);
const logoutController = new LogoutController(authService);
const getUserInfoController = new GetUserInfoController(userService);
const listUsersController = new ListUsersController(userService);
const authentication = createAuthMiddleware(tokenService, sessionRepository);
const requireAdmin = requireRole('admin');
const loginRateLimiter = createRedisRateLimiter(
  redisClient,
  {
    handler: (_request, response) => {
      response
        .status(429)
        .json({ error: 'Too many login attempts. Please try again later.' });
    },
  },
  'rl:ip:login:'
);
const usernameRateLimiter = createUsernameRateLimiter(redisClient);
const refreshRateLimiter = createRedisRateLimiter(
  redisClient,
  {
    handler: (_request, response) => {
      response
        .status(429)
        .json({ error: 'Too many refresh attempts. Please try again later.' });
    },
  },
  'rl:ip:refresh:'
);
// Baseline per-IP throttle applied to every /v1 route, including ones that
// only have `authentication` (no brute-force-specific limiter) in their own
// chain — an authenticated or compromised client still can't hammer
// PostgreSQL/Redis at an unbounded rate. Login/refresh stack their own
// tighter limiter on top of this one.
const apiRateLimiter = createRedisRateLimiter(
  redisClient,
  { windowMs: 60 * 1000, max: 100 },
  'rl:ip:api:'
);

const router = Router();

router.use(apiRateLimiter);

router.post('/users', createUserController.handle);
router.post(
  '/login',
  loginRateLimiter,
  usernameRateLimiter,
  loginUserController.handle
);
router.post('/auth/refresh', refreshRateLimiter, refreshTokenController.handle);
router.post('/auth/logout', authentication, logoutController.handle);
router.get('/users/profile/:id', authentication, getUserInfoController.handle);
router.get(
  '/admin/users',
  authentication,
  requireAdmin,
  listUsersController.handle
);

export default router;
