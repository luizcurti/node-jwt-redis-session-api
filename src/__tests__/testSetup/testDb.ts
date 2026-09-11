import { Redis } from 'ioredis';
import { Pool } from 'pg';

export const testPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

export const testRedisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
});

export async function resetDatabase(): Promise<void> {
  await testPool.query('TRUNCATE TABLE users');
}

export async function resetCache(): Promise<void> {
  await testRedisClient.flushdb();
}

export async function closeTestConnections(): Promise<void> {
  await testPool.end();
  testRedisClient.disconnect();
}
