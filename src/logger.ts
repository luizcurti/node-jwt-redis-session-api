import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import pino, { DestinationStream, Logger } from 'pino';
import pinoHttp, { HttpLogger } from 'pino-http';

// A client-supplied X-Request-Id is echoed into every log line and the
// response header, so only a short token of safe characters is reused;
// anything else (newlines, megabytes of text) gets a fresh UUID.
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// pino writes to its destination directly (via sonic-boom), bypassing
// `process.stdout.write` — an injectable destination is the only way to
// observe output without a real TTY/pipe.
export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: label => ({ level: label }),
      },
    },
    destination
  );
}

export function createHttpLogger(baseLogger: Logger): HttpLogger {
  return pinoHttp({
    logger: baseLogger,
    genReqId: (
      req: IncomingMessage,
      res: ServerResponse
    ): string | number | object => {
      const existing = req.headers['x-request-id'];
      const id =
        typeof existing === 'string' && CLIENT_REQUEST_ID.test(existing)
          ? existing
          : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customProps: req => ({ requestId: req.id }),
    serializers: {
      req: req => ({ method: req.method, path: req.url }),
      res: res => ({ status: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res, error) =>
      `${req.method} ${req.url} ${res.statusCode} — ${error.message}`,
  });
}

export const logger = createLogger();
export const httpLogger = createHttpLogger(logger);
