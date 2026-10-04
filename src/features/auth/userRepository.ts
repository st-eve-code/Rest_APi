import type { CreateUserInput, NewUser, RefreshSession, User, UserRole } from '../../types/user';

/**
 * =============================================================================
 * THE USER REPOSITORY INTERFACE
 * =============================================================================
 *
 * Same pattern as ItemRepository (src/features/items/itemRepository.ts): declare
 * the contract once, ship a Postgres implementation for real use and an in-memory
 * one so the automated tests need no database.
 *
 * Note `NewUser` instead of a loose shape: it has no `password` field, so the
 * type system itself guarantees storage never receives a plaintext password.
 *
 * =============================================================================
 */
export interface UserRepository {
  /** Returns the user with that email (case-insensitive), or `null`. */
  findByEmail(email: string): Promise<User | null>;

  /** Returns the user with that id, or `null`. */
  findById(id: string): Promise<User | null>;

  /** Inserts a user. `passwordHash` is already bcrypt-hashed by the service. */
  create(input: NewUser): Promise<User>;

  /**
   * Changes an account's role. Returns `null` if no such email exists.
   *
   * This exists for exactly two callers: the `db:make-admin` CLI and the tests.
   * There is deliberately NO endpoint for it -- any HTTP route that can grant
   * admin is a privilege-escalation hole, so promoting somebody has to require
   * database (i.e. server) access. See src/db/makeAdmin.ts.
   *
   * Note the caller must sign in again afterwards: the role lives inside the
   * access token, so an already-issued token keeps its old role until it
   * expires.
   */
  updateRole(email: string, role: UserRole): Promise<User | null>;

  /**
   * Records a new refresh session.
   *
   * The caller supplies `id`, because that same value is embedded in the
   * refresh token as its `jti` claim. Generating it inside the repository would
   * mean the token and the row it refers to have unrelated ids, and the
   * `consumeRefreshSession` lookup would never match.
   */
  createRefreshSession(
    session: Omit<RefreshSession, 'createdAt' | 'usedAt' | 'revokedAt'>,
  ): Promise<RefreshSession>;

  /**
   * Looks up a refresh session by its token hash.
   *
   * Returns `null` for unknown, expired, already-used OR revoked tokens -- the
   * caller cannot tell those apart, and does not need to.
   */
  findRefreshSession(tokenHash: string): Promise<RefreshSession | null>;

  /**
   * Marks a session used or revoked. Returns `true` only if the row was still
   * usable, which is how token ROTATION detects a replay.
   *
   * Rotation is a compare-and-set: "UPDATE ... WHERE used_at IS NULL AND
   * revoked_at IS NULL". If two requests race with the same token, exactly one
   * gets `true` and the other is treated as a stolen-token replay.
   */
  consumeRefreshSession(id: string, at: Date): Promise<boolean>;

  /** Revokes every live session for a user ("log out everywhere"). */
  revokeAllRefreshSessions(userId: string, at: Date): Promise<number>;
}