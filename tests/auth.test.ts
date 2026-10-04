import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { InMemoryItemRepository } from '../src/features/items/inMemoryItemRepository';
import { InMemoryUserRepository } from '../src/features/auth/inMemoryUserRepository';

/**
 * =============================================================================
 * AUTH TESTS
 * =============================================================================
 *
 * Two kinds of test live here, and the split matters:
 *
 *   1. BEHAVIOUR tests -- register, login, refresh, logout, and what the server
 *      returns. These go through HTTP, like a real client would.
 *
 *   2. ATTACK tests -- the things that must NOT work: a tampered payload, an
 *      expired token, a refresh token replayed after rotation, someone else's
 *      secret.
 *
 * Group 2 is the point of the whole exercise. A test suite that only proves the
 * happy path will happily accept an implementation with a critical hole in it,
 * because the hole is only visible when someone tries to exploit it. Each test
 * below is named after the attack it prevents, so a failure tells you what is
 * actually vulnerable.
 *
 * ===========================================================================
 */

let repository: InMemoryItemRepository;
let userRepository: InMemoryUserRepository;
let app: Express;

/** Meets the password policy: 12+ characters, three character classes. */
const GOOD_PASSWORD = 'Correct-Horse-42';

let userCounter = 0;

/** A fresh email per call, so tests never collide on the unique index. */
function uniqueEmail(): string {
  userCounter += 1;
  return `user${userCounter}@example.com`;
}

beforeEach(() => {
  repository = new InMemoryItemRepository();
  userRepository = new InMemoryUserRepository();
  app = createApp({ repository, userRepository });
});

/** Registers a user and returns the auth payload. */
async function registerUser(email = uniqueEmail(), password = GOOD_PASSWORD) {
  const response = await request(app).post('/api/auth/register').send({ email, password });

  expect(response.status).toBe(201);

  return {
    email,
    password,
    user: response.body.data.user as { id: string; email: string; role: string },
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
  };
}

// =============================================================================
// REGISTER
// =============================================================================

describe('POST /api/auth/register', () => {
  it('creates an account and returns a token pair', async () => {
    const email = uniqueEmail();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: GOOD_PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.user.role).toBe('user');
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(typeof response.body.data.accessToken).toBe('string');
    expect(typeof response.body.data.refreshToken).toBe('string');
    expect(response.body.data.expiresIn).toBeGreaterThan(0);
  });

  // The single most important assertion in this file: if the hash ever leaks,
  // the database is effectively a plaintext password list.
  it('never returns the password hash', async () => {
    const email = uniqueEmail();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: GOOD_PASSWORD });

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data.user).not.toHaveProperty('password');
  });

  it('stores a bcrypt hash, never the password', async () => {
    const email = uniqueEmail();

    await request(app).post('/api/auth/register').send({ email, password: GOOD_PASSWORD });

    const stored = await userRepository.findByEmail(email);

    expect(stored).not.toBeNull();
    // The bcrypt prefix identifies the algorithm and its cost factor.
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored!.passwordHash).not.toContain(GOOD_PASSWORD);
  });

  it('gives two users with the same password different hashes', async () => {
    const first = await registerUser();
    const second = await registerUser();

    const a = await userRepository.findByEmail(first.email);
    const b = await userRepository.findByEmail(second.email);

    // Different salts -- which is exactly why comparison must use bcrypt.compare
    // and never `===`.
    expect(a!.passwordHash).not.toBe(b!.passwordHash);
  });

  it('lower-cases the email so casing cannot create two accounts', async () => {
    const email = uniqueEmail();

    await request(app).post('/api/auth/register').send({ email, password: GOOD_PASSWORD });

    const stored = await userRepository.findByEmail(email.toUpperCase());
    expect(stored).not.toBeNull();
    expect(stored!.email).toBe(email);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: GOOD_PASSWORD });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password with a message naming the rule', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'password',
      message: 'Password must be at least 12 characters',
    });
  });

  it('rejects a long-but-low-entropy password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: 'aaaaaaaaaaaaaa' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('password');
  });

  it('rejects a password longer than bcrypt can hash', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: `${'A1a'.repeat(30)}xxxx` });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'password',
      message: 'Password must be 72 characters or fewer',
    });
  });

  it('rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: GOOD_PASSWORD });

    expect(response.status).toBe(400);
  });
});

// =============================================================================
// LOGIN
// =============================================================================

describe('POST /api/auth/login', () => {
  it('returns a token pair for correct credentials', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.user.id);
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('accepts a differently-cased email', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password });

    expect(response.status).toBe(200);
  });

  it('rejects a wrong password with 401', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Wrong-Password-99' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  // Email enumeration defence: an unknown address and a wrong password must be
  // indistinguishable, or the endpoint becomes a way to list your users.
  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const user = await registerUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Wrong-Password-99' });

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail(), password: GOOD_PASSWORD });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('never echoes the submitted password back', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Wrong-Password-99' });

    expect(JSON.stringify(response.body)).not.toContain('Wrong-Password-99');
  });
});

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

describe('route protection', () => {
  it('rejects an unauthenticated list with 401', async () => {
    const response = await request(app).get('/api/items');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });

  it('rejects an unauthenticated create with 401', async () => {
    const response = await request(app).post('/api/items').send({ title: 'Sneaky' });

    expect(response.status).toBe(401);
  });

  it('rejects an unauthenticated delete with 401', async () => {
    const user = await registerUser();
    const created = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ title: 'Protected' });

    const response = await request(app).delete(`/api/items/${created.body.data.id}`);

    expect(response.status).toBe(401);
  });

  it('allows a valid token through', async () => {
    const user = await registerUser();

    const response = await request(app)
      .get('/api/items')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
  });

  it('rejects a token that is not a bearer token', async () => {
    const response = await request(app)
      .get('/api/items')
      .set('Authorization', user1Token());

    expect(response.status).toBe(401);
  });

  it('rejects an empty bearer value', async () => {
    const response = await request(app).get('/api/items').set('Authorization', 'Bearer ');

    expect(response.status).toBe(401);
  });

  /** A syntactically valid token signed with the wrong secret. */
  function user1Token(): string {
    return jwt.sign({ sub: 'someone', email: 'a@b.co', role: 'user' }, 'the-wrong-secret-entirely');
  }
});

// =============================================================================
// ATTACKS ON THE TOKEN ITSELF
// =============================================================================

describe('token attacks', () => {
  it('rejects a payload edited to claim the admin role', async () => {
    const user = await registerUser();

    // Decode, change the role, re-encode -- WITHOUT re-signing. This is the
    // single most common JWT attack, and it must fail: the signature covers the
    // payload, so any edit invalidates it.
    const [header, payload] = user.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.role = 'admin';

    const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.not-a-real-signature`;

    const response = await request(app).get('/api/items').set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it('rejects an unsigned token with alg: none', async () => {
    // The classic bypass: strip the signature and declare the algorithm to be
    // "none", which some libraries used to accept.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'someone', email: 'evil@example.com', role: 'admin' }),
    ).toString('base64url');

    const response = await request(app)
      .get('/api/items')
      .set('Authorization', `Bearer ${header}.${payload}.`);

    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the refresh secret', async () => {
    const user = await registerUser();

    // The two token types must not be interchangeable. Verifying with an
    // allow-list of HS256 is not enough on its own -- the SECRET is what
    // separates them.
    const confused = jwt.sign(
      { sub: user.user.id, email: user.email, role: 'user' },
      config.jwt.refreshSecret,
    );

    const response = await request(app).get('/api/items').set('Authorization', `Bearer ${confused}`);

    expect(response.status).toBe(401);
  });

  it('rejects a token from another issuer', async () => {
    // Same secret, wrong `iss`: a token minted by a different app sharing the
    // secret must not be accepted here.
    const foreign = jwt.sign(
      { sub: 'someone', email: 'a@b.co', role: 'user' },
      config.jwt.secret,
      { issuer: 'some-other-app' },
    );

    const response = await request(app).get('/api/items').set('Authorization', `Bearer ${foreign}`);

    expect(response.status).toBe(401);
  });

  it('rejects garbage that is not a JWT at all', async () => {
    const response = await request(app).get('/api/items').set('Authorization', 'Bearer not-a-jwt');

    expect(response.status).toBe(401);
  });

  it('rejects an expired access token', async () => {
    // Signed correctly with the real secret and issuer -- only the expiry is in
    // the past. Expiry enforcement is the server's job, not the client's.
    const expired = jwt.sign(
      { sub: 'someone', email: 'a@b.co', role: 'user' },
      config.jwt.secret,
      { issuer: config.jwt.issuer, expiresIn: -10 },
    );

    const response = await request(app).get('/api/items').set('Authorization', `Bearer ${expired}`);

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// REFRESH + ROTATION
// =============================================================================

describe('POST /api/auth/refresh', () => {
  it('exchanges a refresh token for a new access token', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.user.id);
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('works with no body when the token arrives as a cookie', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${user.refreshToken}`);

    expect(response.status).toBe(200);
  });

  it('rotates the refresh token, so the new one differs', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken });

    expect(response.body.data.refreshToken).not.toBe(user.refreshToken);
  });

  it('rejects a refresh token that was never issued', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: jwt.sign({ sub: 'x', jti: 'y' }, config.jwt.refreshSecret, { issuer: config.jwt.issuer }) });

    expect(response.status).toBe(401);
  });

  it('rejects an access token used as a refresh token', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.accessToken });

    expect(response.status).toBe(401);
  });

  it('rejects a missing token', async () => {
    const response = await request(app).post('/api/auth/refresh').send({});

    expect(response.status).toBe(401);
  });

  // THE REPLAY TEST. Rotation means a refresh token is single-use. If an
  // attacker steals one and the real client has already used it, the second use
  // is the signal that something is wrong -- and we revoke everything.
  it('treats a reused refresh token as theft and revokes every session', async () => {
    const user = await registerUser();

    // The legitimate client rotates first.
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(rotated.status).toBe(200);

    // The attacker's copy of the ORIGINAL token is now worthless.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken });

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSE');

    // And the session the real client just received is killed too, because we
    // cannot tell which of the two parties is the attacker.
    const afterBreach = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken });

    expect(afterBreach.status).toBe(401);
  });
});

// =============================================================================
// LOGOUT + SESSION MANAGEMENT
// =============================================================================

describe('logout', () => {
  it('revokes the refresh session', async () => {
    const user = await registerUser();

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${user.refreshToken}`);

    expect(logout.status).toBe(200);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken });

    expect(refresh.status).toBe(401);
  });

  it('is idempotent -- logging out twice still succeeds', async () => {
    const user = await registerUser();

    await request(app).post('/api/auth/logout').set('Cookie', `refresh_token=${user.refreshToken}`);
    const second = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${user.refreshToken}`);

    expect(second.status).toBe(200);
  });

  it('revokes every session on logout-all', async () => {
    const user = await registerUser();

    // Log in again to create a SECOND session for the same account -- that is
    // the "signed in on my phone too" case that logout-all exists for.
    const secondSession = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(secondSession.status).toBe(200);

    const logoutAll = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(logoutAll.status).toBe(200);
    expect(logoutAll.body.data.revokedSessions).toBe(2);

    // Neither device can refresh any more.
    for (const token of [user.refreshToken, secondSession.body.data.refreshToken]) {
      const response = await request(app).post('/api/auth/refresh').send({ refreshToken: token });
      expect(response.status).toBe(401);
    }
  });

  it('requires a token for logout-all', async () => {
    const response = await request(app).post('/api/auth/logout-all');

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// /me
// =============================================================================

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const user = await registerUser();

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(user.email);
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('requires a token', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });
});

// =============================================================================
// COOKIE FLAGS
// =============================================================================

describe('refresh cookie', () => {
  it('is httpOnly, SameSite=Strict and path-scoped to the auth routes', async () => {
    const email = uniqueEmail();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: GOOD_PASSWORD });

    const cookie = response.headers['set-cookie']?.[0] ?? '';

    // httpOnly: JavaScript cannot read it, so XSS cannot steal it.
    expect(cookie).toContain('HttpOnly');
    // SameSite=Strict: the browser will not attach it to cross-site requests,
    // which blocks CSRF against /api/auth/refresh.
    expect(cookie).toContain('SameSite=Strict');
    // Scoped so it is not attached to ordinary API calls.
    expect(cookie).toContain('Path=/api/auth');
  });

  it('is not marked Secure in development, so plain HTTP works locally', async () => {
    // Worth stating explicitly: this flag IS set in production, where the app is
    // expected to sit behind TLS. Locally it must be off or the browser would
    // never send the cookie back over http://localhost.
    expect(config.isProduction).toBe(false);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: GOOD_PASSWORD });

    const cookie = response.headers['set-cookie']?.[0] ?? '';

    expect(cookie).not.toContain('Secure');
  });

  it('is cleared on logout using the same attributes', async () => {
    const user = await registerUser();

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${user.refreshToken}`);

    const cookie = response.headers['set-cookie']?.[0] ?? '';

    // A browser only removes a cookie when the clearing attributes MATCH the
    // ones it was set with -- otherwise the original cookie survives.
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });
});