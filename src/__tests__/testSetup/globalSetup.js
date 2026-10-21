const path = require('path');
const { runner } = require('node-pg-migrate');
require('./testEnv');

module.exports = async function globalSetup() {
  await runner({
    databaseUrl: {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    },
    dir: path.join(__dirname, '..', '..', '..', 'migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    count: Infinity,
    log: () => {},
  });
};
