import Redis from 'ioredis';

export const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  // REDIS_TLS=true for servers that require in-transit encryption, e.g.
  // ElastiCache with an AUTH token. Its certificates chain to a public CA,
  // so Node's default trust store verifies them.
  ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
});
