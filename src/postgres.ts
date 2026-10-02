import { Pool } from 'pg';
import { logger } from './logger';

export const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// pg.Pool emits 'error' on an idle client independently of any in-flight
// query; an unhandled 'error' event crashes the process, so this listener
// is required, not optional.
pool.on('error', err => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});
