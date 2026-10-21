import { createHash, timingSafeEqual } from 'crypto';
import { RequestHandler } from 'express';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// /metrics exposes internals (routes, latencies, process stats). With
// METRICS_TOKEN set, scrapers must send `Authorization: Bearer <token>`.
// Without it the endpoint is open in development but hidden (404) in
// production, so a forgotten env var fails closed, not open.
export function createMetricsGuard(
  token: string | undefined,
  nodeEnv: string | undefined
): RequestHandler {
  return (request, response, next) => {
    if (!token) {
      if (nodeEnv === 'production') {
        response.status(404).json({ error: 'Not found.' });
        return;
      }
      next();
      return;
    }

    // Hashing both sides gives timingSafeEqual the equal lengths it needs
    // and keeps the token's length from leaking through timing.
    const presented = request.headers.authorization ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${token}`))) {
      response.status(401).json({ error: 'Invalid metrics token.' });
      return;
    }

    next();
  };
}
