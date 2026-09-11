import { Router } from 'express';
import { CreateUserController } from './controllers/CreateUserController';
import { GetUserInfoController } from './controllers/GetUserInfoController';
import { LoginUserController } from './controllers/LoginUserController';
import { LogoutController } from './controllers/LogoutController';
import { RefreshTokenController } from './controllers/RefreshTokenController';
import { createAuthMiddleware } from './middleware/auth';
import {
  createLoginRateLimiter,
  createUsernameRateLimiter,
} from './middleware/rateLimiter';
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
const authentication = createAuthMiddleware(tokenService, sessionRepository);
const loginRateLimiter = createLoginRateLimiter();
const usernameRateLimiter = createUsernameRateLimiter(redisClient);
const refreshRateLimiter = createLoginRateLimiter({
  handler: (_request, response) => {
    response
      .status(429)
      .json({ error: 'Too many refresh attempts. Please try again later.' });
  },
});

const router = Router();

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

export default router;
