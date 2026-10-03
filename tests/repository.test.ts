import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryItemRepository } from '../src/features/items/inMemoryItemRepository';
import { ItemService } from '../src/features/items/items.service';

/**
 * UNIT TESTS for the service + repository pair.
 *
 * Compare with tests/api.test.ts: those go through HTTP, these skip straight to
 * the functions. Unit tests are faster and pin down exactly which layer broke;
 * API tests prove the whole thing works end to end. You normally want both.
 */

/** A logger that discards output so the test run stays readable. */
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let repository: InMemoryItemRepository;
let service: ItemService;

beforeEach(() => {
  repository = new InMemoryItemRepository();
  service = new ItemService(repository, silentLogger);
});

describe('InMemoryItemRepository', () => {
  it('starts empty', async () => {
    expect(repository.size()).toBe(0);
    expect(await repository.findAll({})).toEqual({ items: [], total: 0 });
  });

  it('gives every item a unique id and ISO timestamps', async () => {
    const a = await repository.create({ title: 'A' });
    const b = await repository.create({ title: 'B' });

    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults status to todo', async () => {
    const item = await repository.create({ title: 'No status' });

    expect(item.status).toBe('todo');
  });

  it('finds by id and returns null when missing', async () => {
    const created = await repository.create({ title: 'Findable' });

    expect((await repository.findById(created.id))?.title).toBe('Findable');
    expect(await repository.findById('missing')).toBeNull();
  });

  it('leaves omitted fields alone on update', async () => {
    const created = await repository.create({
      title: 'Original',
      description: 'Keep me',
      status: 'todo',
    });

    const updated = await repository.update(created.id, { status: 'done' });

    expect(updated).toMatchObject({ title: 'Original', description: 'Keep me', status: 'done' });
  });

  it('clears the description when explicitly set to null', async () => {
    const created = await repository.create({ title: 'T', description: 'text' });

    const updated = await repository.update(created.id, { description: null });

    expect(updated?.description).toBeNull();
  });

  it('returns null from update when the id is unknown', async () => {
    expect(await repository.update('missing', { title: 'x' })).toBeNull();
  });

  it('reports whether remove actually deleted something', async () => {
    const created = await repository.create({ title: 'Removable' });

    expect(await repository.remove(created.id)).toBe(true);
    expect(await repository.remove(created.id)).toBe(false);
  });

  it('filters by status and by title case-insensitively', async () => {
    await repository.create({ title: 'Alpha', status: 'todo' });
    await repository.create({ title: 'Beta', status: 'done' });
    await repository.create({ title: 'beta gamma', status: 'done' });

    expect((await repository.findAll({ status: 'done' })).total).toBe(2);
    expect((await repository.findAll({ title: 'BETA' })).total).toBe(2);
    expect((await repository.findAll({ status: 'done', title: 'beta' })).total).toBe(2);
    expect((await repository.findAll({ status: 'todo', title: 'beta' })).total).toBe(0);
  });

  it('paginates without losing the real total', async () => {
    for (let n = 1; n <= 7; n += 1) {
      await repository.create({ title: `Item ${n}` });
    }

    const result = await repository.findAll({ page: 2, pageSize: 3 });

    expect(result.total).toBe(7);
    expect(result.items).toHaveLength(3);
  });

  it('returns an empty page past the end instead of throwing', async () => {
    await repository.create({ title: 'Only one' });

    const result = await repository.findAll({ page: 99, pageSize: 10 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
  });
});

describe('ItemService', () => {
  it('throws a 404 ApiError for an unknown id', async () => {
    await expect(service.getById('missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws a 404 ApiError when deleting an unknown id', async () => {
    await expect(service.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws a 404 ApiError when updating an unknown id', async () => {
    await expect(service.update('missing', { title: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('includes the id in the not-found message', async () => {
    await expect(service.getById('abc123')).rejects.toThrow(/abc123/);
  });
});