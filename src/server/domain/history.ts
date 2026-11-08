import { createHash } from 'node:crypto';

/**
 * Each request keeps an append-only list of events. Every event stores the hash
 * of the one before it, so changing or removing an old event breaks every hash
 * after it. The database also refuses updates and deletes on the table; the
 * chain is the second line of defence, for someone who gets past that.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const GENESIS_HASH = '0'.repeat(64);

export const EVENT_KINDS = [
  'created',
  'viewed',
  'signed',
  'completed',
  'revoked',
  'link_reissued',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventContent {
  requestId: string;
  seq: number;
  kind: string;
  actor: string;
  detail: { [key: string]: JsonValue };
  occurredAt: Date;
}

export interface StoredEvent extends EventContent {
  prevHash: string;
  hash: string;
}

/** JSON with object keys in sorted order, so equal values always hash the same. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`);
  return `{${entries.join(',')}}`;
}

export function computeEventHash(prevHash: string, event: EventContent): string {
  const payload = canonicalJson({
    prevHash,
    requestId: event.requestId,
    seq: event.seq,
    kind: event.kind,
    actor: event.actor,
    detail: event.detail,
    occurredAt: event.occurredAt.toISOString(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export interface ChainCheck {
  intact: boolean;
  checkedEvents: number;
  /** Sequence number of the first event that does not fit, when not intact. */
  brokenAtSeq: number | null;
}

/** Verifies numbering, links and hashes. Events must be given in sequence order. */
export function verifyChain(events: readonly StoredEvent[]): ChainCheck {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const event of events) {
    const fits =
      event.seq === expectedSeq &&
      event.prevHash === prevHash &&
      event.hash === computeEventHash(prevHash, event);
    if (!fits) {
      return { intact: false, checkedEvents: events.length, brokenAtSeq: event.seq };
    }
    prevHash = event.hash;
    expectedSeq += 1;
  }
  return { intact: true, checkedEvents: events.length, brokenAtSeq: null };
}
