import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi';
import { httpLogger, logger } from './logger';
import { errorHandler } from './middleware/errorHandler';
import { pool } from './postgres';
import { redisClient } from './redisConfig';
import router from './routes';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const READY_CHECK_TIMEOUT_MS = 2_000;

// ioredis queues commands and waits for reconnection instead of rejecting
// promptly when the connection is down (governed by enableOfflineQueue),
// so a bare `redisClient.ping()` can hang far longer than a readiness probe
// should ever wait. Race every dependency check against an explicit timeout
// so a genuinely unreachable dependency reports "not ready" quickly instead
// of hanging the request (and, transitively, the orchestrator's probe).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const app = express();
// Helmet's default CSP (script-src 'self', style-src includes
// 'unsafe-inline', img-src includes data:) already covers what
// swagger-ui-express needs: its init script is served same-origin (not
// inlined), and its HTML template's only inline content is <style> blocks
// and CSS-embedded data: image URIs.
app.use(helmet());
app.use(httpLogger);
app.use(express.json());

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
app.get('/ready', async (req, res) => {
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

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use(router);
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
