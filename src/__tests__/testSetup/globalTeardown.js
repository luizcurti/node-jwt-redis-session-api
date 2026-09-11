const { Client } = require('pg');
const Redis = require('ioredis');
require('./testEnv');

module.exports = async function globalTeardown() {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  await client.connect();
  await client.query('TRUNCATE TABLE users');
  await client.end();

  const redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  });
  await redisClient.flushdb();
  redisClient.disconnect();
};
