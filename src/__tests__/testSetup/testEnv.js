const DEFAULTS = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'user',
  POSTGRES_PASSWORD: 'password',
  POSTGRES_DB: 'mydb',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  JWT_SECRET: 'integration-test-secret-that-is-at-least-32-chars',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  process.env[key] = process.env[key] || value;
}
