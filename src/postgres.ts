import { Pool } from 'pg';
import { logger } from './logger';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// pg.Pool emits 'error' on an idle client (e.g. the connection to Postgres
// drops) independently of any in-flight query. Node's EventEmitter throws
// and crashes the process on an unhandled 'error' event, so this listener
// isn't optional — without it, a Postgres blip takes the whole app down
// instead of surfacing as a degraded /ready response.
pool.on('error', err => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});
