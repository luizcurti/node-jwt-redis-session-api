export type UserRole = 'user' | 'admin';

export type UserRecord = {
  id: string;
  name: string;
  username: string;
  password: string;
  email: string;
  role: UserRole;
};

export type UserPublic = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
};

export function toPublicUser(user: UserRecord): UserPublic {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}
