require('dotenv/config');
const { runner } = require('node-pg-migrate');

const direction = process.argv[2] === 'down' ? 'down' : 'up';

runner({
  databaseUrl: {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  },
  dir: 'migrations',
  migrationsTable: 'pgmigrations',
  direction,
  count: direction === 'down' ? 1 : Infinity,
  log: message => console.log(message),
}).catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
