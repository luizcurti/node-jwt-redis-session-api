import { Pool } from 'pg';
import { ConflictError } from '../errors/AppError';
import { UserRecord } from '../types/user';

export type NewUser = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  email: string;
};

const POSTGRES_UNIQUE_VIOLATION = '23505';

type PostgresError = { code: string; constraint?: string };

function isUniqueViolation(error: unknown): error is PostgresError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

// Aliased to camelCase so rows map straight onto UserRecord.
const USER_COLUMNS = `id, name, username, password_hash AS "passwordHash", email, role`;

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  // Case-insensitive, matching the users_username_lower_key unique index —
  // `lower(username)` is exactly that index's expression, so this is an
  // index lookup, not a scan.
  async findByUsername(username: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRecord>(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );

    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRecord>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );

    return rows[0] ?? null;
  }

  async listPaginated(
    limit: number,
    offset: number
  ): Promise<{ items: UserRecord[]; total: number }> {
    const [{ rows: items }, { rows: countRows }] = await Promise.all([
      // Total order (id is unique) so LIMIT/OFFSET pages never repeat or
      // skip a row; created_at first so pages read oldest-to-newest.
      this.pool.query<UserRecord>(
        `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at, id LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      this.pool.query<{ count: string }>(`SELECT COUNT(*) FROM users`),
    ]);

    return { items, total: Number(countRows[0].count) };
  }

  async existsByUsername(username: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );

    return rows.length > 0;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    return rows.length > 0;
  }

  async create(user: NewUser): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO users (id, name, username, password_hash, email) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.name, user.username, user.passwordHash, user.email]
      );
    } catch (error) {
      // UserService's existsByUsername/existsByEmail checks can't close the
      // race window between that check and this insert; the unique index on
      // lower(username) and the unique constraint on email are the actual
      // source of truth, translated here into the same domain error.
      if (isUniqueViolation(error)) {
        if (error.constraint === 'users_username_lower_key') {
          throw new ConflictError('Username already taken.');
        }
        if (error.constraint === 'users_email_key') {
          throw new ConflictError('Email already registered.');
        }
      }
      throw error;
    }
  }
}
