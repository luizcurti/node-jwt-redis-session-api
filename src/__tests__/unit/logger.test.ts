import express from 'express';
import { Logger } from 'pino';
import request from 'supertest';
import { createHttpLogger, createLogger, logger } from '../../logger';

function createMemoryDestination(): {
  write: (msg: string) => void;
  lines: () => object[];
} {
  const chunks: string[] = [];
  return {
    write: (msg: string) => {
      chunks.push(msg);
    },
    lines: () => chunks.map(line => JSON.parse(line)),
  };
}

describe('logger', () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('defaults to the info level when LOG_LEVEL is unset', () => {
    delete process.env.LOG_LEVEL;

    expect(createLogger().level).toBe('info');
  });

  it('respects LOG_LEVEL when set', () => {
    process.env.LOG_LEVEL = 'warn';

    expect(createLogger().level).toBe('warn');
  });

  it('writes the level as a string label, not a numeric code', () => {
    const destination = createMemoryDestination();
    const testLogger = createLogger(destination);

    testLogger.info('hello');

    expect(destination.lines()[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
    });
  });

  it('exports a default logger and httpLogger ready to use', () => {
    expect(logger.level).toBe(process.env.LOG_LEVEL || 'info');
  });

  describe('httpLogger', () => {
    function buildApp(testLogger: Logger) {
      const app = express();
      app.use(createHttpLogger(testLogger));
      app.get('/ok', (_req, res) => res.status(200).json({ ok: true }));
      app.get('/missing', (_req, res) => res.status(404).json({}));
      app.get('/boom', (_req, res) => res.status(500).json({}));
      return app;
    }

    it('sets X-Request-Id on the response, reusing an incoming header if present', async () => {
      const app = buildApp(createLogger(createMemoryDestination()));

      const withoutHeader = await request(app).get('/ok');
      expect(withoutHeader.headers['x-request-id']).toEqual(expect.any(String));

      const withHeader = await request(app)
        .get('/ok')
        .set('X-Request-Id', 'client-supplied-id');
      expect(withHeader.headers['x-request-id']).toBe('client-supplied-id');
    });

    it('logs a flat method/path/status shape at info level for a 2xx response', async () => {
      const destination = createMemoryDestination();
      const app = buildApp(createLogger(destination));

      await request(app).get('/ok');

      expect(destination.lines()[0]).toMatchObject({
        level: 'info',
        requestId: expect.any(String),
        req: { method: 'GET', path: '/ok' },
        res: { status: 200 },
        responseTime: expect.any(Number),
        msg: 'GET /ok 200',
      });
    });

    it('logs at warn level for a 4xx response', async () => {
      const destination = createMemoryDestination();
      const app = buildApp(createLogger(destination));

      await request(app).get('/missing');

      expect(destination.lines()[0]).toMatchObject({
        level: 'warn',
        res: { status: 404 },
      });
    });

    it('logs at error level for a 5xx response', async () => {
      const destination = createMemoryDestination();
      const app = buildApp(createLogger(destination));

      await request(app).get('/boom');

      expect(destination.lines()[0]).toMatchObject({
        level: 'error',
        res: { status: 500 },
      });
    });
  });
});
