import { Pool } from 'pg';
import { ConflictError } from '../../../errors/AppError';
import { UserRepository } from '../../../repositories/UserRepository';

describe('UserRepository', () => {
  let pool: { query: jest.Mock };
  let repository: UserRepository;

  beforeEach(() => {
    pool = { query: jest.fn() };
    repository = new UserRepository(pool as unknown as Pool);
  });

  describe('findByUsername', () => {
    it('returns the user when found', async () => {
      const user = {
        id: '1',
        name: 'Test',
        username: 'testuser',
        password: 'hash',
        email: 'test@example.com',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const result = await repository.findByUsername('testuser');

      expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['testuser']);
      expect(result).toEqual(user);
    });

    it('returns null when no user is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await repository.findByUsername('missing');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      const user = {
        id: '1',
        name: 'Test',
        username: 'testuser',
        password: 'hash',
        email: 'test@example.com',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const result = await repository.findById('1');

      expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['1']);
      expect(result).toEqual(user);
    });

    it('returns null when no user is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('existsByUsername', () => {
    it('returns true when a row is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ exists: true }] });

      await expect(repository.existsByUsername('testuser')).resolves.toBe(true);
    });

    it('returns false when no row is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(repository.existsByUsername('missing')).resolves.toBe(false);
    });
  });

  describe('existsByEmail', () => {
    it('returns true when a row is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ exists: true }] });

      await expect(repository.existsByEmail('test@example.com')).resolves.toBe(
        true
      );
    });

    it('returns false when no row is found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        repository.existsByEmail('missing@example.com')
      ).resolves.toBe(false);
    });
  });

  describe('create', () => {
    it('inserts the user with the given fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await repository.create({
        id: '1',
        name: 'Test',
        username: 'testuser',
        passwordHash: 'hash',
        email: 'test@example.com',
      });

      expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
        '1',
        'Test',
        'testuser',
        'hash',
        'test@example.com',
      ]);
    });

    it('translates a username unique-constraint violation into ConflictError', async () => {
      pool.query.mockRejectedValueOnce({
        code: '23505',
        constraint: 'users_username_key',
      });

      await expect(
        repository.create({
          id: '1',
          name: 'Test',
          username: 'testuser',
          passwordHash: 'hash',
          email: 'test@example.com',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('translates an email unique-constraint violation into ConflictError', async () => {
      pool.query.mockRejectedValueOnce({
        code: '23505',
        constraint: 'users_email_key',
      });

      await expect(
        repository.create({
          id: '1',
          name: 'Test',
          username: 'testuser',
          passwordHash: 'hash',
          email: 'test@example.com',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('rethrows unrelated database errors unchanged', async () => {
      const error = new Error('connection lost');
      pool.query.mockRejectedValueOnce(error);

      await expect(
        repository.create({
          id: '1',
          name: 'Test',
          username: 'testuser',
          passwordHash: 'hash',
          email: 'test@example.com',
        })
      ).rejects.toBe(error);
    });

    it('rethrows a unique violation on an unrecognized constraint unchanged', async () => {
      const error = { code: '23505', constraint: 'some_other_constraint' };
      pool.query.mockRejectedValueOnce(error);

      await expect(
        repository.create({
          id: '1',
          name: 'Test',
          username: 'testuser',
          passwordHash: 'hash',
          email: 'test@example.com',
        })
      ).rejects.toBe(error);
    });
  });
});
