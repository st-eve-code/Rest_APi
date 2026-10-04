import { query } from '../../db/pool';
import type { NewUser, RefreshSession, User } from '../../types/user';
import type { UserRepository } from './userRepository';

/** How the `users` table looks inside PostgreSQL, before we convert it to a User. */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: User['role'];
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RefreshSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
}

/**
 * TIMESTAMPTZ columns arrive as JS Date objects; our API speaks ISO-8601 strings.
 * This is the boundary where snake_case columns and Dates become camelCase
 * fields and plain strings -- the same job mapRowToItem does for items.
 */
function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    disabledAt: row.disabled_at ? new Date(row.disabled_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapSessionRow(row: RefreshSessionRow): RefreshSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** The real repository: talks SQL to PostgreSQL. */
export class PostgresUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    // `lower(email) = lower($1)` matches the case-insensitive unique index, so
    // this stays a fast index lookup instead of a sequential scan.
    const result = await query<UserRow>(
      `SELECT id, email, password_hash, role, disabled_at, created_at, updated_at
         FROM users
        WHERE lower(email) = lower($1)`,
      [email],
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const result = await query<UserRow>(
      `SELECT id, email, password_hash, role, disabled_at, created_at, updated_at
         FROM users
        WHERE id = $1`,
      [id],
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async create(input: NewUser): Promise<User> {
    const result = await query<UserRow>(
      `INSERT INTO users (email, password_hash, role)
            VALUES (lower($1), $2, COALESCE($3, 'user'::user_role))
         RETURNING id, email, password_hash, role, disabled_at, created_at, updated_at`,
      [input.email, input.passwordHash, input.role ?? null],
    );

    return mapUserRow(result.rows[0]);
  }

  async updateRole(email: string, role: User['role']): Promise<User | null> {
    const result = await query<UserRow>(
      `UPDATE users
          SET role = $2::user_role, updated_at = NOW()
        WHERE lower(email) = lower($1)
        RETURNING id, email, password_hash, role, disabled_at, created_at, updated_at`,
      [email, role],
    );

    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async createRefreshSession(
    session: Omit<RefreshSession, 'createdAt' | 'usedAt' | 'revokedAt'>,
  ): Promise<RefreshSession> {
    const result = await query<RefreshSessionRow>(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip_address, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, token_hash, user_agent, ip_address, used_at, revoked_at,
                   expires_at, created_at`,
      [
        // `id` is supplied by the caller and is also the token's `jti` claim, so
        // the row and the token always refer to each other.
        session.id,
        session.userId,
        session.tokenHash,
        session.userAgent,
        session.ipAddress,
        session.expiresAt,
      ],
    );

    return mapSessionRow(result.rows[0]);
  }

  async findRefreshSession(tokenHash: string): Promise<RefreshSession | null> {
    const result = await query<RefreshSessionRow>(
      `SELECT id, user_id, token_hash, user_agent, ip_address, used_at, revoked_at,
              expires_at, created_at
         FROM refresh_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > NOW()`,
      [tokenHash],
    );

    return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
  }

  /**
   * Compare-and-set. The `used_at IS NULL AND revoked_at IS NULL` in the WHERE
   * clause is the whole trick: PostgreSQL evaluates it per row, so exactly one
   * of two racing requests can match, and the other gets rowCount 0.
   */
  async consumeRefreshSession(id: string, at: Date): Promise<boolean> {
    const result = await query(
      `UPDATE refresh_tokens
          SET used_at = $2
        WHERE id = $1
          AND used_at IS NULL
          AND revoked_at IS NULL`,
      [id, at],
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  async revokeAllRefreshSessions(userId: string, at: Date): Promise<number> {
    const result = await query(
      `UPDATE refresh_tokens
          SET revoked_at = $2
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [userId, at],
    );

    return result.rowCount ?? 0;
  }
}