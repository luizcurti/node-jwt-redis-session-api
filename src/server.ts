import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi';
import { httpLogger, logger } from './logger';
import { errorHandler } from './middleware/errorHandler';
import { createRedisRateLimiter } from './middleware/rateLimiter';
import { httpRequestDuration, registry } from './metrics';
import { pool } from './postgres';
import { redisClient } from './redisConfig';
import router from './routes';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const READY_CHECK_TIMEOUT_MS = 2_000;

// ioredis queues commands and waits for reconnection instead of rejecting
// promptly (enableOfflineQueue), so a bare `redisClient.ping()` can hang far
// longer than a readiness probe should wait. Race each check against a
// timeout so an unreachable dependency reports "not ready" quickly.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const app = express();
// Helmet's default CSP already covers swagger-ui-express: its init script
// is served same-origin (not inlined), and its only inline content is
// <style> blocks and data: image URIs, both already allowed by default.
app.use(helmet());
app.use(httpLogger);
app.use(express.json());

// Route label uses the matched Express pattern (e.g. /users/profile/:id),
// not the raw path, so params like ids never fragment the metric into one
// series per request.
app.use((req, res, next) => {
  const stopTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    stopTimer({
      method: req.method,
      route: req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
      status: res.statusCode,
    });
  });
  next();
});

// /ready and /metrics each do real work (Postgres/Redis round trips,
// serializing the metrics registry) and have no auth, so an unbounded
// caller could otherwise hit both repeatedly for free.
const metaRateLimiter = createRedisRateLimiter(
  redisClient,
  { windowMs: 60 * 1000, max: 60 },
  'rl:ip:meta:'
);

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Server is running!' });
});

// Liveness: is the process itself up? Always 200 if this handler runs at
// all — no dependency checks, so a slow/unhealthy Postgres or Redis never
// makes an orchestrator kill and restart an otherwise-fine process.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: can this instance actually serve traffic right now? Checks the
// two hard dependencies directly rather than trusting cached state.
app.get('/ready', metaRateLimiter, async (req, res) => {
  const [postgres, redis] = await Promise.allSettled([
    withTimeout(pool.query('SELECT 1'), READY_CHECK_TIMEOUT_MS),
    withTimeout(redisClient.ping(), READY_CHECK_TIMEOUT_MS),
  ]);

  const postgresOk = postgres.status === 'fulfilled';
  const redisOk = redis.status === 'fulfilled';

  res.status(postgresOk && redisOk ? 200 : 503).json({
    postgres: postgresOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'error',
  });
});

app.get('/metrics', metaRateLimiter, async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Versioned API surface. /, /health, /ready, /metrics, and /docs stay
// unversioned — they're infra/meta endpoints, not part of the business API
// contract.
app.use('/v1', router);
app.use(errorHandler);

const PORT = process.env.NODE_ENV === 'test' ? 0 : process.env.PORT || 3000;

export async function startServer(): Promise<ReturnType<typeof app.listen>> {
  const server = app.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'test') {
      const address = server.address();
      const port = typeof address === 'string' ? address : address?.port;
      logger.info(`Server is running on PORT ${port}`);
    }
  });

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down gracefully`);

    const forceExit = setTimeout(() => {
      logger.error(
        `Graceful shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async closeError => {
      if (closeError) {
        logger.error({ err: closeError }, 'Error closing HTTP server');
      }

      const results = await Promise.allSettled([
        pool.end(),
        redisClient.quit(),
      ]);

      let hadError = Boolean(closeError);

      for (const result of results) {
        if (result.status === 'rejected') {
          hadError = true;
          logger.error({ err: result.reason }, 'Error during shutdown');
        }
      }

      if (!hadError) {
        logger.info('Shutdown complete');
      }

      clearTimeout(forceExit);
      process.exit(hadError ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
