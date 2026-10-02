-- Up Migration

-- Say what the column actually holds — a bcrypt hash, never a password.
ALTER TABLE users RENAME COLUMN password TO password_hash;

-- The app still generates ids itself (randomUUID), but a manual INSERT or a
-- future service shouldn't have to.
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE users
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE FUNCTION users_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_set_updated_at();

-- Usernames are unique case-insensitively: "Luiz" and "luiz" must not be two
-- accounts (they already share one per-username login-throttle bucket, and
-- would be indistinguishable to a human). A unique *index* on lower() rather
-- than citext keeps the column a plain TEXT and needs no extension. Fails
-- loudly if existing rows already collide — resolve those by hand first.
ALTER TABLE users DROP CONSTRAINT users_username_key;
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- Down Migration

DROP INDEX users_username_lower_key;
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);

DROP TRIGGER users_set_updated_at ON users;
DROP FUNCTION users_set_updated_at();

ALTER TABLE users
  DROP COLUMN password_changed_at,
  DROP COLUMN updated_at,
  DROP COLUMN created_at;

ALTER TABLE users ALTER COLUMN id DROP DEFAULT;

ALTER TABLE users RENAME COLUMN password_hash TO password;
