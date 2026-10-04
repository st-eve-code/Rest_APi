import { randomUUID } from 'node:crypto';
import type { NewUser, RefreshSession, User, UserRole } from '../../types/user';
import type { UserRepository } from './userRepository';

/**
 * A UserRepository backed by plain JavaScript Maps.
 *
 * Used by the automated tests (fast, no PostgreSQL required) and by anyone who
 * runs with DB_DRIVER=memory. It implements the exact same interface as
 * PostgresUserRepository, so the auth code cannot tell the difference.
 *
 * Note what this does NOT do: it stores passwords. The service hands it an
 * already-hashed password, and there is no code path that could ever put a
 * plaintext password in here -- the type requires `passwordHash`, and the
 * hashing happens in auth.service.ts before the repository is called.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  /** Keyed by email in lower case, mirroring the case-insensitive DB index. */
  private readonly emailIndex = new Map<string, string>();
  private readonly sessions = new Map<string, RefreshSession>();

  constructor(seed: User[] = []) {
    for (const user of seed) {
      this.users.set(user.id, user);
      this.emailIndex.set(user.email.toLowerCase(), user.id);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(input: NewUser): Promise<User> {
    const now = new Date().toISOString();

    const user: User = {
      id: randomUUID(),
      // Lower-cased on the way in, exactly like the Postgres INSERT does, so the
      // two implementations agree on what "the same email" means.
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role ?? 'user',
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.emailIndex.set(user.email, user.id);

    return user;
  }

  async updateRole(email: string, role: UserRole): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    if (!id) return null;

    const existing = this.users.get(id);
    if (!existing) return null;

    const updated: User = { ...existing, role, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }

  async createRefreshSession(
    session: Omit<RefreshSession, 'createdAt' | 'usedAt' | 'revokedAt'>,
  ): Promise<RefreshSession> {
    const created: RefreshSession = {
      ...session,
      usedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(created.tokenHash, created);
    return created;
  }

  async findRefreshSession(tokenHash: string): Promise<RefreshSession | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;

    if (session.usedAt || session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

    return session;
  }

  async consumeRefreshSession(id: string, at: Date): Promise<boolean> {
    const entry = [...this.sessions.entries()].find(([, session]) => session.id === id);
    if (!entry) return false;

    const [key, session] = entry;
    if (session.usedAt || session.revokedAt) return false;

    session.usedAt = at.toISOString();
    this.sessions.set(key, session);
    return true;
  }

  async revokeAllRefreshSessions(userId: string, at: Date): Promise<number> {
    let revoked = 0;

    for (const [key, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = at.toISOString();
        this.sessions.set(key, session);
        revoked += 1;
      }
    }

    return revoked;
  }

  /** Test helper: how many refresh sessions are stored. */
  sessionCount(): number {
    return this.sessions.size;
  }
}