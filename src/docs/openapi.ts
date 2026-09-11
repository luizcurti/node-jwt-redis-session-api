const userPublicSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['user', 'admin'] },
  },
};

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
};

const apiRateLimited429 = {
  description:
    'Too many requests from this IP across /v1 endpoints (100 req/min)',
  content: { 'application/json': { schema: errorSchema } },
};

const metaRateLimited429 = {
  description: 'Too many requests to this endpoint from this IP (60 req/min)',
  content: { 'application/json': { schema: errorSchema } },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Node.js + Redis + PostgreSQL REST API',
    version: '2.3.0',
    description:
      'User registration, JWT access/refresh authentication with Redis-backed ' +
      'session revocation, role-based access control, and a separate Redis ' +
      'read-through profile cache. Business endpoints are versioned under ' +
      '/v1; /health, /ready, /metrics, and /docs are not.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      UserPublic: userPublicSchema,
      Error: errorSchema,
    },
  },
  paths: {
    '/': {
      get: {
        summary: 'Root — server is running',
        responses: {
          '200': {
            description: 'Server is running',
          },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Liveness probe — no dependency checks',
        responses: {
          '200': { description: 'Always ok if the process can respond' },
        },
      },
    },
    '/ready': {
      get: {
        summary: 'Readiness probe — checks PostgreSQL and Redis',
        responses: {
          '200': { description: 'Both dependencies reachable' },
          '429': metaRateLimited429,
          '503': { description: 'At least one dependency is unreachable' },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
        description:
          'Default Node.js process metrics plus an HTTP request duration ' +
          'histogram labeled by method, route, and status code.',
        responses: {
          '200': {
            description: 'Metrics in Prometheus text exposition format',
          },
          '429': metaRateLimited429,
        },
      },
    },
    '/v1/users': {
      post: {
        summary: 'Create a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'username', 'email', 'password'],
                properties: {
                  name: {
                    type: 'string',
                    minLength: 2,
                    maxLength: 100,
                  },
                  username: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 30,
                  },
                  email: { type: 'string', format: 'email' },
                  password: {
                    type: 'string',
                    minLength: 12,
                    maxLength: 72,
                    description:
                      'Capped at 72 characters — bcrypt silently truncates ' +
                      'anything longer.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created successfully' },
          '400': {
            description:
              'A required field is missing or fails validation ' +
              '(username/name/password length, email format)',
            content: { 'application/json': { schema: errorSchema } },
          },
          '409': {
            description: 'Username already taken, or email already registered',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': apiRateLimited429,
        },
      },
    },
    '/v1/login': {
      post: {
        summary: 'Authenticate a user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Login successful, returns a short-lived access token, a ' +
              'long-lived refresh token, and the user profile',
          },
          '400': {
            description: 'Missing username or password',
            content: { 'application/json': { schema: errorSchema } },
          },
          '401': {
            description: 'Invalid credentials',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': {
            description:
              'Too many login attempts, rate limited per IP or per ' +
              'username (whichever limit is hit first)',
            content: { 'application/json': { schema: errorSchema } },
          },
        },
      },
    },
    '/v1/auth/refresh': {
      post: {
        summary: 'Rotate an access/refresh token pair',
        description:
          'Exchanges a valid refresh token for a new access/refresh pair. ' +
          'The old refresh token is invalidated immediately (rotation); ' +
          'reusing it again deletes the whole session (reuse detection).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'A new access token and a new refresh token',
          },
          '400': {
            description: 'Missing refresh token',
            content: { 'application/json': { schema: errorSchema } },
          },
          '401': {
            description:
              'Malformed, unknown, expired, or already-used refresh token',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': {
            description: 'Too many refresh attempts (rate limited)',
            content: { 'application/json': { schema: errorSchema } },
          },
        },
      },
    },
    '/v1/auth/logout': {
      post: {
        summary: "Revoke the caller's current session",
        description:
          'Deletes the session from Redis, taking effect immediately — the ' +
          'access token used to authenticate this call is rejected on its ' +
          'very next use, even though it has not expired yet.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Logout successful' },
          '401': {
            description: 'Missing, invalid, or already-revoked token',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': apiRateLimited429,
        },
      },
    },
    '/v1/users/profile/{id}': {
      get: {
        summary: 'Get the authenticated user own profile from cache',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Must match the id of the authenticated user',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description:
              'The user profile. Served from the Redis cache on a hit; ' +
              'on a miss, read from PostgreSQL and the cache is ' +
              'repopulated (true read-through cache).',
            content: {
              'application/json': { schema: userPublicSchema },
            },
          },
          '401': {
            description: 'Missing, invalid, or revoked token',
            content: { 'application/json': { schema: errorSchema } },
          },
          '403': {
            description: 'The authenticated user does not own this profile',
            content: { 'application/json': { schema: errorSchema } },
          },
          '404': {
            description: 'The user does not exist in PostgreSQL',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': apiRateLimited429,
        },
      },
    },
    '/v1/admin/users': {
      get: {
        summary: 'List all users (admin only)',
        description:
          "Role-based access control: the caller's access token must carry " +
          '`role: "admin"`, embedded at login time from PostgreSQL. There is ' +
          'no self-service way to become an admin — see the README.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Page size (default 20, max 100)',
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            description: 'Number of rows to skip (default 0)',
            schema: { type: 'integer', minimum: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'A page of users, ordered by id',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: userPublicSchema },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid limit/offset',
            content: { 'application/json': { schema: errorSchema } },
          },
          '401': {
            description: 'Missing, invalid, or revoked token',
            content: { 'application/json': { schema: errorSchema } },
          },
          '403': {
            description: 'Authenticated, but not an admin',
            content: { 'application/json': { schema: errorSchema } },
          },
          '429': apiRateLimited429,
        },
      },
    },
  },
};
