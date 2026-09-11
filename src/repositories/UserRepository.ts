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

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRecord>(
      `SELECT ID, NAME, USERNAME, PASSWORD, EMAIL, ROLE FROM USERS WHERE USERNAME = $1 LIMIT 1`,
      [username]
    );

    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRecord>(
      `SELECT ID, NAME, USERNAME, PASSWORD, EMAIL, ROLE FROM USERS WHERE ID = $1 LIMIT 1`,
      [id]
    );

    return rows[0] ?? null;
  }

  async listPaginated(
    limit: number,
    offset: number
  ): Promise<{ items: UserRecord[]; total: number }> {
    const [{ rows: items }, { rows: countRows }] = await Promise.all([
      this.pool.query<UserRecord>(
        `SELECT ID, NAME, USERNAME, PASSWORD, EMAIL, ROLE FROM USERS ORDER BY ID LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      this.pool.query<{ count: string }>(`SELECT COUNT(*) FROM USERS`),
    ]);

    return { items, total: Number(countRows[0].count) };
  }

  async existsByUsername(username: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM USERS WHERE USERNAME = $1 LIMIT 1`,
      [username]
    );

    return rows.length > 0;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM USERS WHERE EMAIL = $1 LIMIT 1`,
      [email]
    );

    return rows.length > 0;
  }

  async create(user: NewUser): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO USERS (ID, NAME, USERNAME, PASSWORD, EMAIL) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.name, user.username, user.passwordHash, user.email]
      );
    } catch (error) {
      // The existsByUsername/existsByEmail checks in UserService give a fast,
      // friendly conflict response in the common case, but they can't close
      // the race window between that check and this insert. The UNIQUE
      // constraints in the schema are the actual source of truth; this
      // translates a constraint violation into the same domain error.
      if (isUniqueViolation(error)) {
        if (error.constraint === 'users_username_key') {
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
