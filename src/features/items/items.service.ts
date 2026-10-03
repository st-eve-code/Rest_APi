import { ApiError } from '../../lib/ApiError';
import type {
  CreateItemInput,
  Item,
  ListItemsQuery,
  UpdateItemInput,
} from '../../types/item';
import type { CountedItems } from './countedItems';
import type { ItemRepository } from './itemRepository';

/**
 * =============================================================================
 * THE SERVICE LAYER
 * =============================================================================
 *
 * This is where BUSINESS RULES live -- the things that are true about your app
 * regardless of HTTP or SQL.
 *
 * The layer split, and why it matters:
 *
 *   route       URL -> which function handles it.        No logic.
 *   controller  HTTP  -> objects, and back.              No logic.
 *   service     objects -> rules, storage.               No HTTP knowledge.
 *   repository  objects -> SQL / storage.                No rules.
 *
 * The payoff: because the service never imports Express, you can call it from a
 * CLI script, a background job, a WebSocket handler or a unit test without
 * faking a request/response pair.
 *
 * Constructor injection: the repository is handed in, not imported. That is what
 * lets the tests pass an InMemoryItemRepository.
 *
 * ===========================================================================
 */
export class ItemService {
  constructor(
    private readonly repository: ItemRepository,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  async list(query: ListItemsQuery): Promise<CountedItems> {
    return this.repository.findAll(query);
  }

  async getById(id: string): Promise<Item> {
    const item = await this.repository.findById(id);

    // The service decides "not found" is an error, so every caller gets the same
    // behaviour whether it asked for one item or tried to update a deleted one.
    if (!item) {
      throw ApiError.notFound(`Item with id "${id}" was not found`);
    }

    return item;
  }

  async create(input: CreateItemInput): Promise<Item> {
    const item = await this.repository.create(input);
    this.logger.info(`[items] created ${item.id} (${item.title})`);
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item> {
    const updated = await this.repository.update(id, input);

    if (!updated) {
      throw ApiError.notFound(`Item with id "${id}" was not found`);
    }

    this.logger.info(`[items] updated ${id}`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.remove(id);

    if (!deleted) {
      throw ApiError.notFound(`Item with id "${id}" was not found`);
    }

    this.logger.info(`[items] deleted ${id}`);
  }
}