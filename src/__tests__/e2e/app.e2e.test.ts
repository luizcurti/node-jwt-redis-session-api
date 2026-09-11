import request from 'supertest';
import app from '../../server';
import {
  closeTestConnections,
  resetCache,
  resetDatabase,
  testPool,
  testRedisClient,
} from '../testSetup/testDb';

async function createAndLoginUser(username: string) {
  await request(app)
    .post('/v1/users')
    .send({
      username,
      name: 'Test User',
      password: 'password123456',
      email: `${username}@example.com`,
    });

  const loginRes = await request(app)
    .post('/v1/login')
    .send({ username, password: 'password123456' });

  return {
    accessToken: loginRes.body.accessToken as string,
    refreshToken: loginRes.body.refreshToken as string,
    id: loginRes.body.user.id as string,
  };
}

// There is no self-service path to become an admin — this simulates the
// manual bootstrap step (see README) directly against the database, the
// same way a real operator would promote the first admin.
async function createAndLoginAdmin(username: string) {
  const user = await createAndLoginUser(username);
  await testPool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
    user.id,
  ]);
  const loginRes = await request(app)
    .post('/v1/login')
    .send({ username, password: 'password123456' });

  return {
    accessToken: loginRes.body.accessToken as string,
    id: user.id,
  };
}

describe('App (e2e)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  describe('GET /', () => {
    it('reports the server is running', async () => {
      const res = await request(app).get('/');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'Server is running!' });
    });

    it('sets security headers via helmet, including a real CSP', async () => {
      const res = await request(app).get('/');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['content-security-policy']).toContain(
        "script-src 'self'"
      );
    });
  });

  describe('GET /health', () => {
    it('always reports ok, with no dependency checks', async () => {
      const res = await request(app).get('/health');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /ready', () => {
    it('reports both dependencies ok when Postgres and Redis are reachable', async () => {
      const res = await request(app).get('/ready');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ postgres: 'ok', redis: 'ok' });
    });
  });

  describe('GET /metrics', () => {
    it('serves Prometheus text-format metrics, including per-route HTTP counters', async () => {
      await request(app).get('/health');

      const res = await request(app).get('/metrics');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('http_request_duration_seconds');
      expect(res.text).toContain('route="/health"');
    });
  });

  describe('GET /docs', () => {
    it('serves the Swagger UI page under the same CSP as the rest of the app', async () => {
      const res = await request(app).get('/docs/');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-security-policy']).toContain(
        "script-src 'self'"
      );
    });
  });

  describe('POST /users', () => {
    it('creates a new user', async () => {
      const res = await request(app).post('/v1/users').send({
        username: 'newuser',
        name: 'New User',
        password: 'password123456',
        email: 'newuser@example.com',
      });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('message', 'User created successfully');
      expect(res.body).toHaveProperty('userId');
    });

    it('returns 400 when a required field is missing', async () => {
      const res = await request(app)
        .post('/v1/users')
        .send({ username: 'newuser' });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Name is required.' });
    });

    it('returns 400 when the username is too short', async () => {
      const res = await request(app).post('/v1/users').send({
        username: 'ab',
        name: 'New User',
        password: 'password123456',
        email: 'newuser@example.com',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Username must be at least 3 characters.',
      });
    });

    it('returns 400 when the email is not a valid address', async () => {
      const res = await request(app).post('/v1/users').send({
        username: 'newuser',
        name: 'New User',
        password: 'password123456',
        email: 'not-an-email',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Email must be a valid email address.',
      });
    });

    it('returns 400 when the password is too short', async () => {
      const res = await request(app).post('/v1/users').send({
        username: 'newuser',
        name: 'New User',
        password: 'short',
        email: 'newuser@example.com',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Password must be at least 12 characters.',
      });
    });

    it('normalizes the email to lowercase and trims whitespace before storing', async () => {
      const res = await request(app).post('/v1/users').send({
        username: 'caseuser',
        name: 'Case User',
        password: 'password123456',
        email: '  CaseUser@Example.com  ',
      });
      expect(res.statusCode).toBe(201);

      const loginRes = await request(app)
        .post('/v1/login')
        .send({ username: 'caseuser', password: 'password123456' });

      expect(loginRes.body.user.email).toBe('caseuser@example.com');
    });

    it('returns 409 when the username already exists', async () => {
      await createAndLoginUser('duplicateuser');

      const res = await request(app).post('/v1/users').send({
        username: 'duplicateuser',
        name: 'Another User',
        password: 'password123456',
        email: 'another@example.com',
      });

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'Username already taken.' });
    });

    it('returns 409 when the email already exists', async () => {
      await createAndLoginUser('emailowner');

      const res = await request(app).post('/v1/users').send({
        username: 'someotherusername',
        name: 'Another User',
        password: 'password123456',
        email: 'emailowner@example.com',
      });

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: 'Email already registered.' });
    });
  });

  describe('POST /login', () => {
    it('logs in with valid credentials', async () => {
      await createAndLoginUser('loginuser');

      const res = await request(app)
        .post('/v1/login')
        .send({ username: 'loginuser', password: 'password123456' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('message', 'Login successful');
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({
        username: 'loginuser',
        email: 'loginuser@example.com',
        role: 'user',
      });
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('returns 400 when username or password is missing', async () => {
      const res = await request(app)
        .post('/v1/login')
        .send({ username: 'loginuser' });

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Username and password are required.',
      });
    });

    it('returns 401 for an unknown username', async () => {
      const res = await request(app)
        .post('/v1/login')
        .send({ username: 'ghost', password: 'password123456' });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials.' });
    });

    it('returns 401 for a wrong password', async () => {
      await createAndLoginUser('loginuser');

      const res = await request(app)
        .post('/v1/login')
        .send({ username: 'loginuser', password: 'wrongpassword' });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials.' });
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns a new access/refresh token pair', async () => {
      const { refreshToken } = await createAndLoginUser('refreshuser');

      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty(
        'message',
        'Token refreshed successfully'
      );
      expect(res.body.refreshToken).not.toEqual(refreshToken);
    });

    it('lets the new access token authenticate the profile endpoint', async () => {
      const { refreshToken, id } = await createAndLoginUser('refreshuser');

      const refreshRes = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      const profileRes = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`);

      expect(profileRes.statusCode).toBe(200);
    });

    it('rejects the old refresh token once it has been rotated (reuse detection)', async () => {
      const { refreshToken } = await createAndLoginUser('refreshuser');

      await request(app).post('/v1/auth/refresh').send({ refreshToken });
      const replayRes = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(replayRes.statusCode).toBe(401);
      expect(replayRes.body).toEqual({ error: 'Invalid refresh token.' });
    });

    it('returns 400 when the refresh token is missing', async () => {
      const res = await request(app).post('/v1/auth/refresh').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Refresh token is required.' });
    });

    it('returns 401 for a malformed refresh token', async () => {
      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'not-well-formed' });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid refresh token.' });
    });

    it('returns 401 for an unknown session', async () => {
      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'unknown-session.some-validator' });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid refresh token.' });
    });
  });

  describe('POST /auth/logout', () => {
    it('logs out the current session', async () => {
      const { accessToken } = await createAndLoginUser('logoutuser');

      const res = await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ message: 'Logout successful' });
    });

    it('returns 401 when the Authorization header is missing', async () => {
      const res = await request(app).post('/v1/auth/logout');

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token missing' });
    });

    it('revokes the session immediately, even though the access token has not expired yet', async () => {
      const { accessToken, id } = await createAndLoginUser('logoutuser');

      await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      const res = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Session expired or revoked' });
    });

    it('makes the refresh token unusable as well', async () => {
      const { accessToken, refreshToken } =
        await createAndLoginUser('logoutuser');

      await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /users/profile/:id', () => {
    it('returns the profile for the authenticated owner', async () => {
      const { accessToken, id } = await createAndLoginUser('profileuser');

      const res = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ id, username: 'profileuser' });
    });

    it('returns 401 when the Authorization header is missing', async () => {
      const res = await request(app).get('/v1/users/profile/some-id');

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token missing' });
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/v1/users/profile/some-id')
        .set('Authorization', 'Bearer not-a-real-token');

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid token' });
    });

    it('returns 403 when a user requests another user profile (IDOR protection)', async () => {
      const userA = await createAndLoginUser('usera');
      const userB = await createAndLoginUser('userb');

      const res = await request(app)
        .get(`/v1/users/profile/${userB.id}`)
        .set('Authorization', `Bearer ${userA.accessToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'You are not allowed to access this profile.',
      });
    });

    it('falls back to PostgreSQL and repopulates the cache on a cache miss', async () => {
      const { accessToken, id } = await createAndLoginUser('profileuser');
      // Delete only the profile cache entry, not the whole Redis DB — a full
      // flush would also wipe the session and trigger a 401 from the auth
      // middleware before this request ever reaches the cache-miss path.
      await testRedisClient.del(`user-${id}`);

      const res = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ id, username: 'profileuser' });
      await expect(testRedisClient.get(`user-${id}`)).resolves.toEqual(
        JSON.stringify(res.body)
      );
    });

    it('returns 404 when the user no longer exists in PostgreSQL or the cache', async () => {
      const { accessToken, id } = await createAndLoginUser('profileuser');
      await testRedisClient.del(`user-${id}`);
      await testPool.query('DELETE FROM users WHERE id = $1', [id]);

      const res = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'User not found.' });
    });

    it('falls back to PostgreSQL when the cached entry is corrupted (not valid JSON)', async () => {
      const { accessToken, id } = await createAndLoginUser('profileuser');
      // Simulate corruption that could never happen through setUserProfile
      // (e.g. a bad manual SET, or a bug elsewhere writing the wrong value).
      await testRedisClient.set(`user-${id}`, 'not-valid-json{');

      const res = await request(app)
        .get(`/v1/users/profile/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ id, username: 'profileuser' });
      // The corrupted entry is overwritten with a well-formed one.
      await expect(testRedisClient.get(`user-${id}`)).resolves.toEqual(
        JSON.stringify(res.body)
      );
    });
  });

  describe('GET /v1/admin/users', () => {
    it('returns 401 when the Authorization header is missing', async () => {
      const res = await request(app).get('/v1/admin/users');

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Token missing' });
    });

    it('returns 403 for an authenticated regular user (RBAC enforcement)', async () => {
      const { accessToken } = await createAndLoginUser('regularuser');

      const res = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'You do not have access to this resource.',
      });
    });

    it('returns a paginated list of users for an admin', async () => {
      const admin = await createAndLoginAdmin('adminuser');
      await createAndLoginUser('listeduser1');
      await createAndLoginUser('listeduser2');

      const res = await request(app)
        .get('/v1/admin/users?limit=2&offset=0')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      expect(res.body.total).toBe(3); // admin + 2 regular users
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).not.toHaveProperty('password');
    });

    it('returns 400 for an invalid pagination parameter', async () => {
      const admin = await createAndLoginAdmin('adminuser2');

      const res = await request(app)
        .get('/v1/admin/users?limit=not-a-number')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'limit must be a number.' });
    });

    it("does not grant admin access via a token issued before the user's promotion", async () => {
      const user = await createAndLoginUser('latepromote');
      // Promote in PostgreSQL, but the already-issued access token's role
      // claim is fixed for its lifetime — this is the documented trade-off.
      await testPool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
        user.id,
      ]);

      const res = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.statusCode).toBe(403);
    });
  });
});
