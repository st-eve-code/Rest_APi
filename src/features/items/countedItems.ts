import type { Item } from '../../types/item';

/**
 * A page of results plus the total number of matches.
 *
 * Why the total? "Give me 20 items" and "give me 10 items, page 4" both look
 * identical in the response body without it. Clients need `total` to render
 * "Page 3 of 17" or to decide whether "next page" should be enabled.
 */
export interface CountedItems {
  items: Item[];
  total: number;
}