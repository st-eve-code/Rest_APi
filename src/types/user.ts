/**
 * The single source of truth for what a "User" looks like -- same idea as
 * src/types/item.ts.
 */

/** The only values `role` is allowed to have. */
export const USER_ROLES = ['user', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** The shape a User has inside the app, including the password hash. */
export interface User {
  id: string;
  email: string;
  /** A bcrypt hash. Never leaves the server -- see `toPublicUser` below. */
  passwordHash: string;
  role: UserRole;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The shape a User is allowed to have on the wire.
 *
 * This is a separate type on purpose. If we returned `User` directly, a single
 * `res.json(user)` would silently publish the password hash, and TypeScript
 * would not complain -- the type would still be satisfied. Forcing a conversion
 * means the hash cannot leak by accident: you would have to explicitly ask for
 * it.
 */
export type PublicUser = Omit<User, 'passwordHash' | 'disabledAt'>;

/** Strips everything a client must never see. */
export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, disabledAt: _disabledAt, ...safe } = user;
  return safe;
}

/** What `POST /api/auth/register` and `POST /api/auth/login` need. */
export interface CreateUserInput {
  email: string;
  /** Plaintext. Hashed immediately by the service -- never stored. */
  password: string;
  role?: UserRole;
}

/**
 * What the repository is allowed to receive.
 *
 * Deliberately has no `password` field. `Omit<CreateUserInput, 'password'>` is
 * what makes it a compile error for any code to hand plaintext to storage: the
 * only way to construct a NewUser is to supply a `passwordHash`.
 */
export type NewUser = Omit<CreateUserInput, 'password'> & { passwordHash: string };

/** A live refresh session. `tokenHash` is a SHA-256 hash, not the token. */
export interface RefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  createdAt: string;
}