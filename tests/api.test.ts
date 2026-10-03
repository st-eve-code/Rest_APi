import request from 'supertest';
import type { Express } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryItemRepository } from '../src/features/items/inMemoryItemRepository';

/**
 * =============================================================================
 * API TESTS  (integration style)
 * =============================================================================
 *
 * These tests send REAL HTTP requests through the REAL Express app -- real
 * routing, real validation, real error handling, real JSON. The only fake is
 * storage, and we swapped it in through the repository interface.
 *
 * What that means: if these tests pass, a real client sending the same request
 * gets the same response. That is far more valuable than asserting that a
 * function returned a value.
 *
 * `supertest` needs no port -- it hands the app to a local HTTP server for the
 * duration of the request, then tears it down.
 *
 * ===========================================================================
 */

let repository: InMemoryItemRepository;
let app: Express;

/**
 * beforeEach runs before EVERY test. Rebuilding the app here (instead of once)
 * guarantees each test starts with an empty database and zero shared state --
 * otherwise test order would start to matter, which is a nightmare to debug.
 */
beforeEach(() => {
  repository = new InMemoryItemRepository();
  app = createApp({ repository });
});

/** Small helper so tests read as behaviour, not as JSON plumbing. */
async function createItem(title: string, overrides: Record<string, unknown> = {}) {
  const response = await request(app).post('/api/items').send({ title, ...overrides });

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
});

describe('POST /api/items', () => {
  it('creates an item and returns 201 with a Location header', async () => {
    const response = await request(app).post('/api/items').send({
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
    const response = await request(app).post('/api/items').send({ description: 'orphan' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title is required',
    });
  });

  it('rejects an empty or whitespace-only title', async () => {
    const response = await request(app).post('/api/items').send({ title: '     ' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title is required',
    });
  });

  it('rejects a title longer than 200 characters', async () => {
    const response = await request(app)
      .post('/api/items')
      .send({ title: 'x'.repeat(201) });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'title',
      message: 'Title must be 200 characters or fewer',
    });
  });

  it('rejects an unknown status and lists the valid ones', async () => {
    const response = await request(app)
      .post('/api/items')
      .send({ title: 'Bad status', status: 'almost_done' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].message).toBe(
      'Status must be one of: todo, in_progress, done',
    );
  });

  it('reports every bad field at once instead of one per request', async () => {
    const response = await request(app).post('/api/items').send({ status: 'nope' });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveLength(2);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const response = await request(app)
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a non-object body', async () => {
    const response = await request(app)
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('"just a string"');

    expect(response.status).toBe(400);
  });
});

describe('GET /api/items', () => {
  it('starts out empty', async () => {
    const response = await request(app).get('/api/items');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('returns everything, newest first, with pagination meta', async () => {
    const first = await createItem('First');
    const second = await createItem('Second');
    const third = await createItem('Third');

    const response = await request(app).get('/api/items');

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

    const page2 = await request(app).get('/api/items').query({ page: 2, pageSize: 2 });

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
    const response = await request(app).get('/api/items').query({ pageSize: 500 });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({
      field: 'pageSize',
      message: 'Page size must be 100 or fewer',
    });
  });

  it('rejects a non-numeric page', async () => {
    const response = await request(app).get('/api/items').query({ page: 'abc' });

    expect(response.status).toBe(400);
  });

  // ---------------------------------------------------------------- filtering
  it('filters by status', async () => {
    await createItem('To do', { status: 'todo' });
    await createItem('Doing', { status: 'in_progress' });
    await createItem('Finished', { status: 'done' });

    const response = await request(app).get('/api/items').query({ status: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Finished');
    expect(response.body.meta.total).toBe(1);
  });

  it('filters by title substring, case-insensitively', async () => {
    await createItem('Fix the Database');
    await createItem('Write documentation');
    await createItem('Database migration script');

    const response = await request(app).get('/api/items').query({ title: 'database' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
  });

  it('combines filters', async () => {
    await createItem('Database plan', { status: 'todo' });
    await createItem('Database fix', { status: 'done' });

    const response = await request(app)
      .get('/api/items')
      .query({ status: 'done', title: 'database' });

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Database fix');
  });

  it('returns an empty list when nothing matches', async () => {
    await createItem('Something');

    const response = await request(app).get('/api/items').query({ status: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it('rejects an invalid status filter', async () => {
    const response = await request(app).get('/api/items').query({ status: 'archived' });

    expect(response.status).toBe(400);
  });
});

describe('GET /api/items/:id', () => {
  it('returns the item', async () => {
    const created = await createItem('Findable');

    const response = await request(app).get(`/api/items/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(created.id);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await request(app).get('/api/items/does-not-exist');

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

    const response = await request(app)
      .patch(`/api/items/${created.id}`)
      .send({ status: 'in_progress' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Original title', // untouched
      description: 'Original description', // untouched
      status: 'in_progress', // changed
    });
  });

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const created = await createItem('Timestamps');

    const response = await request(app)
      .patch(`/api/items/${created.id}`)
      .send({ title: 'Timestamps changed' });

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

    const response = await request(app)
      .patch(`/api/items/${created.id}`)
      .send({ description: null });

    expect(response.status).toBe(200);
    expect(response.body.data.description).toBeNull();
  });

  it('rejects an empty body', async () => {
    const created = await createItem('Something');

    const response = await request(app).patch(`/api/items/${created.id}`).send({});

    expect(response.status).toBe(400);
  });

  it('rejects an empty title', async () => {
    const created = await createItem('Something');

    const response = await request(app)
      .patch(`/api/items/${created.id}`)
      .send({ title: '' });

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await request(app).patch('/api/items/nope').send({ title: 'x' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/items/:id', () => {
  it('deletes the item and returns 204 with no body', async () => {
    const created = await createItem('Delete me');

    const response = await request(app).delete(`/api/items/${created.id}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const after = await request(app).get(`/api/items/${created.id}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 when deleting twice', async () => {
    const created = await createItem('Delete me twice');

    await request(app).delete(`/api/items/${created.id}`);
    const second = await request(app).delete(`/api/items/${created.id}`);

    expect(second.status).toBe(404);
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
    const response = await request(app).put('/api/items/abc');

    expect(response.status).toBe(404);
  });
});

describe('response contract', () => {
  it('always wraps success in { success: true, data }', async () => {
    const created = await createItem('Contract');

    const response = await request(app).get(`/api/items/${created.id}`);

    expect(Object.keys(response.body).sort()).toEqual(['data', 'success']);
    expect(response.body.success).toBe(true);
  });

  it('always wraps failure in { success: false, error }', async () => {
    const response = await request(app).get('/api/items/missing');

    expect(Object.keys(response.body).sort()).toEqual(['error', 'success']);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.error.code).toBe('string');
    expect(typeof response.body.error.message).toBe('string');
  });
});