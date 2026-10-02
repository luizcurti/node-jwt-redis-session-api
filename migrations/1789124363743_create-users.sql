-- Up Migration

CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  email TEXT NOT NULL,
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_email_key UNIQUE (email)
);

-- Down Migration

DROP TABLE users;
