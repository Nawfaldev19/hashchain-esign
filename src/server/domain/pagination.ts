import { invalid } from './errors';

/**
 * Keyset ("cursor") pagination over rows ordered by (created_at desc, id desc).
 * Unlike OFFSET, the cost of a page does not grow with its position, and rows
 * added while someone is paging do not shift later pages.
 */

export interface PageRequest {
  first: number;
  after: string | null;
}

export interface Page<T> {
  items: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt.toISOString()}|${position.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(timestamp ?? '');
  if (Number.isNaN(createdAt.getTime()) || id === undefined || !isUuid(id)) {
    throw invalid('The paging cursor is not valid.');
  }
  return { createdAt, id };
}

export function normalizePageRequest(
  first: number | null | undefined,
  after: string | null | undefined,
): PageRequest {
  const size = first ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw invalid(`"first" must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return { first: size, after: after ?? null };
}

/**
 * Builds a page from rows fetched with LIMIT first + 1. The extra row only tells
 * whether another page exists and is not returned.
 */
export function toPage<T extends CursorPosition>(rows: T[], first: number): Page<T> {
  const items = rows.slice(0, first);
  const last = items.at(-1);
  return {
    items,
    endCursor: last ? encodeCursor(last) : null,
    hasNextPage: rows.length > first,
  };
}
