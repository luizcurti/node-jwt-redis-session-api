import express, { Express } from 'express';
import request from 'supertest';
import { createMetricsGuard } from '../../../middleware/metricsGuard';

function appWith(token: string | undefined, nodeEnv: string): Express {
  const app = express();
  app.get('/metrics', createMetricsGuard(token, nodeEnv), (_req, res) => {
    res.status(200).send('metrics');
  });
  return app;
}

describe('createMetricsGuard', () => {
  describe('with a token configured', () => {
    const app = appWith('scrape-secret', 'production');

    it('serves metrics for the right bearer token', async () => {
      await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer scrape-secret')
        .expect(200, 'metrics');
    });

    it('rejects a missing Authorization header with 401', async () => {
      const res = await request(app).get('/metrics');

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid metrics token.' });
    });

    it('rejects a wrong token, including one of a different length', async () => {
      await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer x')
        .expect(401);
      await request(app)
        .get('/metrics')
        .set('Authorization', 'scrape-secret')
        .expect(401);
    });
  });

  describe('without a token configured', () => {
    it('fails closed (404) in production', async () => {
      const res = await request(appWith(undefined, 'production')).get(
        '/metrics'
      );

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Not found.' });
    });

    it('stays open outside production', async () => {
      await request(appWith(undefined, 'development'))
        .get('/metrics')
        .expect(200);
    });
  });
});
