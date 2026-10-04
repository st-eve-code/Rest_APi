import request from 'supertest';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryItemRepository } from '../src/features/items/inMemoryItemRepository';
import { InMemoryUserRepository } from '../src/features/auth/inMemoryUserRepository';

/**
 * =============================================================================
 * API TESTS  (integration style)
 * =============================================================================
 *
 * These tests send REAL HTTP requests through the REAL Express app -- real
 * routing, real validation, real error handling, real JSON. The only fake is
 * storage, and we swapped it in through the repository interfaces.
 *
 * What that means: if these tests pass, a real client sending the same request
 * gets the same response. That is far more valuable than asserting that a
 * function returned a value.
 *
 * `supertest` needs no port -- it hands the app to a local HTTP server for the
 * duration of the request, then tears it down.
 *
 * AUTHENTICATION
 *
 * `/api/items` sits behind `authenticate` (see src/features/items/items.routes.ts),
 * so every request in this file needs a token. `signIn()` below registers a
 * throwaway user through the REAL register endpoint and returns a client that
 * attaches the resulting bearer token to every call.
 *
 * Going through the real endpoint -- rather than forging a token in the test --
 * means these tests exercise the same signing, hashing and session code the
 * running app uses. A test that minted its own token would happily pass even if
 * login were completely broken.
 *
 * The cost is one bcrypt hash per test (~100ms), which is why the user is
 * created once per test in `beforeEach` rather than per request.
 *
 * ===========================================================================
 */

let repository: InMemoryItemRepository;
let userRepository: InMemoryUserRepository;
let app: Express;

/** A supertest request builder with the Authorization header already set. */
interface AuthedApi {
  get: (url: string) => ReturnType<ReturnType<typeof request>['get']>;
  post: (url: string) => ReturnType<ReturnType<typeof request>['post']>;
  patch: (url: string) => ReturnType<ReturnType<typeof request>['patch']>;
  put: (url: string) => ReturnType<ReturnType<typeof request>['put']>;
  delete: (url: string) => ReturnType<ReturnType<typeof request>['delete']>;
}

interface Session {
  api: AuthedApi;
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  password: string;
}

let session: Session;

/** Counts registrations so each test gets its own unique email. */
let userCounter = 0;

/**
 * beforeEach runs before EVERY test. Rebuilding the app here (instead of once)
 * guarantees each test starts with an empty database and zero shared state --
 * otherwise test order would start to matter, which is a nightmare to debug.
 */
beforeEach(async () => {
  repository = new InMemoryItemRepository();
  userRepository = new InMemoryUserRepository();
  app = createApp({ repository, userRepository });
  session = await signIn();
});

/**
 * Signs in as an admin.
 *
 * Deletes are admin-only, so the delete tests need an admin token. The promotion
 * below flips the role in the repository and then LOGS IN AGAIN, which is the
 * honest way to do it: the role travels inside the access token, so the token
 * minted before the promotion would still say `user`. This mirrors exactly what
 * you do in real life -- run `npm run db:make-admin`, then sign in again.
 *
 * It deliberately does not forge a token. Only the server may sign one.
 */
async function signInAsAdmin(): Promise<Session> {
  const plain = await signIn();

  await userRepository.updateRole(plain.email, 'admin');

  // Second login -- /api/auth/login, not /register, because the account now
  // exists. The server re-reads the role and signs it into the new payload.
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: plain.email, password: plain.password });

  expect(response.status).toBe(200);
  expect(response.body.data.user.role).toBe('admin');

  return withSession(
    plain,
    response.body.data.accessToken as string,
    response.body.data.refreshToken as string,
    response.body.data.user.id as string,
  );
}

/** Registers a fresh user and wraps supertest with their bearer token. */
async function signIn(): Promise<Session> {
  userCounter += 1;

  const email = `user${userCounter}@example.com`;
  // Satisfies the real password policy: 12+ characters, three character classes.
  const password = 'Correct-Horse-42';

  const response = await request(app).post('/api/auth/register').send({ email, password });
  expect(response.status).toBe(201);

  return withSession(
    { email, password },
    response.body.data.accessToken as string,
    response.body.data.refreshToken as string,
    response.body.data.user.id as string,
  );
}

/** Wraps supertest so every call carries one bearer token. */
function withSession(
  identity: { email: string; password: string },
  accessToken: string,
  refreshToken: string,
  userId: string,
): Session {
  /** Adds the header without breaking supertest's fluent chaining. */
  const authed = <T extends { set: (field: string, value: string) => T }>(pending: T): T =>
    pending.set('Authorization', `Bearer ${accessToken}`);

  return {
    api: {
      get: (url) => authed(request(app).get(url)),
      post: (url) => authed(request(app).post(url)),
      patch: (url) => authed(request(app).patch(url)),
      put: (url) => authed(request(app).put(url)),
      delete: (url) => authed(request(app).delete(url)),
    },
    accessToken,
    refreshToken,
    userId,
    email: identity.email,
    password: identity.password,
  };
}

/** Small helper so tests read as behaviour, not as JSON plumbing. */
async function createItem(title: string, overrides: Record<string, unknown> = {}) {
  const response = await session.api.post('/api/items').send({ title, ...overrides });

  // If creation failed, the test is broken -- fail loudly rather than with
  // "Cannot read properties of undefined".
  expect(response.status).toBe(201);

  return response.body.data as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

describe('GET /health', () => {
  it('reports that the service is alive', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
  });

  // The probe has no credentials, so it must stay reachable. See app.ts.
  it('stays reachable without a token', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
  });
});

describe('POST /api/items', () => {
  it('creates an item and returns 201 with a Location header', async () => {
    const response = await session.api.post('/api/items').send({
      title: 'Learn Express',
      description: 'Read the docs',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      title: 'Learn Express',
      description: 'Read the docs',
      status: 'todo', // default
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.headers.location).toBe(`/api/items/${response.body.data.id}`);
  });

  it('defaults description to null', async () => {
    const item = await createItem('No description');

    expect(item.description).toBeNull();
  });

  it('trims whitespace from the title', async () => {
    const item = await createItem('   Padded title   ');

    expect(item.title).toBe('Padded title');
  });

  // ---------------------------------------------------------------- validation
  it('rejects a missing title with a clear message', async () => {
    const response = await session.api.post('/api/items').send({ description: 'orphan' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title is required',
    });
  });

  it('rejects an empty or whitespace-only title', async () => {
    const response = await session.api.post('/api/items').send({ title: '     ' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title is required',
    });
  });

  it('rejects a title longer than 200 characters', async () => {
    const response = await session.api.post('/api/items').send({ title: 'x'.repeat(201) });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title must be 200 characters or fewer',
    });
  });

  it('rejects an unknown status and lists the valid ones', async () => {
    const response = await session.api.post('/api/items').send({ title: 'Bad status', status: 'almost_done' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe(
      'Status must be one of: todo, in_progress, done',
    );
  });

  it('reports every bad field at once instead of one per request', async () => {
    const response = await session.api.post('/api/items').send({ status: 'nope' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveLength(2);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const response = await session.api
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a non-object body', async () => {
    const response = await session.api
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('"just a string"');

    expect(response.status).toBe(400);
  });
});

describe('GET /api/items', () => {
  it('starts out empty', async () => {
    const response = await session.api.get('/api/items');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('returns everything, newest first, with pagination meta', async () => {
    const first = await createItem('First');
    const second = await createItem('Second');
    const third = await createItem('Third');

    const response = await session.api.get('/api/items');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.map((i: { id: string }) => i.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(response.body.meta).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('paginates', async () => {
    for (let n = 1; n <= 5; n += 1) {
      await createItem(`Item ${n}`);
    }

    const page2 = await session.api.get('/api/items').query({ page: 2, pageSize: 2 });

    expect(page2.body.data).toHaveLength(2);
    expect(page2.body.meta).toMatchObject({
      total: 5,
      page: 2,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('rejects pageSize above the maximum', async () => {
    const response = await session.api.get('/api/items').query({ pageSize: 500 });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'pageSize',
      message: 'Page size must be 100 or fewer',
    });
  });

  it('rejects a non-numeric page', async () => {
    const response = await session.api.get('/api/items').query({ page: 'abc' });

    expect(response.status).toBe(400);
  });

  // ---------------------------------------------------------------- filtering
  it('filters by status', async () => {
    await createItem('To do', { status: 'todo' });
    await createItem('Doing', { status: 'in_progress' });
    await createItem('Finished', { status: 'done' });

    const response = await session.api.get('/api/items').query({ status: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Finished');
    expect(response.body.meta.total).toBe(1);
  });

  it('filters by title substring, case-insensitively', async () => {
    await createItem('Fix the Database');
    await createItem('Write documentation');
    await createItem('Database migration script');

    const response = await session.api.get('/api/items').query({ title: 'database' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
  });

  it('combines filters', async () => {
    await createItem('Database plan', { status: 'todo' });
    await createItem('Database fix', { status: 'done' });

    const response = await session.api.get('/api/items').query({ status: 'done', title: 'database' });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Database fix');
  });

  it('returns an empty list when nothing matches', async () => {
    await createItem('Something');

    const response = await session.api.get('/api/items').query({ status: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('rejects an invalid status filter', async () => {
    const response = await session.api.get('/api/items').query({ status: 'archived' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/items/:id', () => {
  it('returns the item', async () => {
    const created = await createItem('Findable');

    const response = await session.api.get(`/api/items/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(created.id);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await session.api.get('/api/items/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('does-not-exist');
  });
});

describe('PATCH /api/items/:id', () => {
  it('updates only the supplied fields', async () => {
    const created = await createItem('Original title', {
      description: 'Original description',
      status: 'todo',
    });

    const response = await session.api.patch(`/api/items/${created.id}`).send({ status: 'in_progress' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Original title', // untouched
      description: 'Original description', // untouched
      status: 'in_progress', // changed
    });
  });

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const created = await createItem('Timestamps');

    const response = await session.api.patch(`/api/items/${created.id}`).send({ title: 'Timestamps changed' });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Timestamps changed');
    // createdAt must not change on a PATCH.
    expect(response.body.data.createdAt).toBe(created.createdAt);
    // updatedAt must be the same instant or later.
    expect(new Date(response.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it('allows clearing the description with null', async () => {
    const created = await createItem('Has description', { description: 'text' });

    const response = await session.api.patch(`/api/items/${created.id}`).send({ description: null });

    expect(response.status).toBe(200);
    expect(response.body.data.description).toBeNull();
  });

  it('rejects an empty body', async () => {
    const created = await createItem('Something');

    const response = await session.api.patch(`/api/items/${created.id}`).send({});

    expect(response.status).toBe(400);
  });

  it('rejects an empty title', async () => {
    const created = await createItem('Something');

    const response = await session.api.patch(`/api/items/${created.id}`).send({ title: '' });

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await session.api.patch('/api/items/nope').send({ title: 'x' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/items/:id', () => {
  it('deletes the item and returns 204 with no body', async () => {
    const admin = await signInAsAdmin();
    const created = await createItem('Delete me');

    const response = await admin.api.delete(`/api/items/${created.id}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const after = await admin.api.get(`/api/items/${created.id}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 when deleting twice', async () => {
    const admin = await signInAsAdmin();
    const created = await createItem('Delete me twice');

    await admin.api.delete(`/api/items/${created.id}`);
    const second = await admin.api.delete(`/api/items/${created.id}`);

    expect(second.status).toBe(404);
  });

  it('refuses a signed-in non-admin with 403, and keeps the item', async () => {
    const created = await createItem('Not yours to delete');

    const response = await session.api.delete(`/api/items/${created.id}`);

    // 403, not 401: the identity was accepted, the permission was not. A 401
    // would tell the client to re-authenticate, which would not help.
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    // The important half: a refused delete must not delete.
    const still = await session.api.get(`/api/items/${created.id}`);
    expect(still.status).toBe(200);
  });

  it('refuses an anonymous caller with 401', async () => {
    const created = await createItem('Anonymous delete attempt');

    const response = await request(app).delete(`/api/items/${created.id}`);

    expect(response.status).toBe(401);

    const admin = await signInAsAdmin();
    expect((await admin.api.get(`/api/items/${created.id}`)).status).toBe(200);
  });

  it('does not leak which role is required', async () => {
    const created = await createItem('Role enumeration attempt');

    const response = await session.api.delete(`/api/items/${created.id}`);

    expect(response.body.error.message).not.toContain('admin');
    expect(response.body.error.message).not.toContain('user');
  });
});

describe('unknown routes', () => {
  it('returns a helpful 404 listing the method and path', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('Cannot GET /api/nope');
  });

  it('returns 404 for a method the resource does not support', async () => {
    const response = await session.api.put('/api/items/abc');

    expect(response.status).toBe(404);
  });
});

describe('response contract', () => {
  it('always wraps success in { success: true, data }', async () => {
    const created = await createItem('Contract');

    const response = await session.api.get(`/api/items/${created.id}`);

    expect(Object.keys(response.body).sort()).toEqual(['data', 'success']);
    expect(response.body.success).toBe(true);
  });

  it('always wraps failure in { success: false, error }', async () => {
    const response = await session.api.get('/api/items/missing');

    expect(Object.keys(response.body).sort()).toEqual(['error', 'success']);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.error.code).toBe('string');
    expect(typeof response.body.error.message).toBe('string');
  });
});