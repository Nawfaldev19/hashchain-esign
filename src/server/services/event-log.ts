import { createHash } from 'node:crypto';
import type { Signature } from '../../shared/fields';
import type { Queryable } from '../db/database';
import { GENESIS_HASH, canonicalJson, computeEventHash } from '../domain/history';
import type { EventKind, JsonValue, StoredEvent } from '../domain/history';

interface EventRow {
  request_id: string;
  seq: number;
  kind: string;
  actor: string;
  detail: { [key: string]: JsonValue };
  occurred_at: Date;
  prev_hash: string;
  hash: string;
}

const toEvent = (row: EventRow): StoredEvent => ({
  requestId: row.request_id,
  seq: row.seq,
  kind: row.kind,
  actor: row.actor,
  detail: row.detail,
  occurredAt: row.occurred_at,
  prevHash: row.prev_hash,
  hash: row.hash,
});

/**
 * Appends one event to a request's history inside the caller's transaction.
 * The request row is locked first, so two writers cannot both read the same
 * "last event" and produce two events with the same sequence number.
 */
export async function appendEvent(
  q: Queryable,
  event: {
    workspaceId: string;
    requestId: string;
    kind: EventKind;
    actor: string;
    detail: { [key: string]: JsonValue };
    occurredAt: Date;
  },
): Promise<void> {
  await q.query('select id from signing_requests where id = $1 for update', [event.requestId]);
  const last = await q.query<{ seq: number; hash: string }>(
    'select seq, hash from request_events where request_id = $1 order by seq desc limit 1',
    [event.requestId],
  );
  const seq = (last[0]?.seq ?? 0) + 1;
  const prevHash = last[0]?.hash ?? GENESIS_HASH;
  const hash = computeEventHash(prevHash, { ...event, seq });
  await q.query(
    `insert into request_events
       (workspace_id, request_id, seq, kind, actor, detail, occurred_at, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      event.workspaceId,
      event.requestId,
      seq,
      event.kind,
      event.actor,
      JSON.stringify(event.detail),
      event.occurredAt,
      prevHash,
      hash,
    ],
  );
}

export async function loadEvents(q: Queryable, requestId: string): Promise<StoredEvent[]> {
  const rows = await q.query<EventRow>(
    `select request_id, seq, kind, actor, detail, occurred_at, prev_hash, hash
       from request_events where request_id = $1 order by seq`,
    [requestId],
  );
  return rows.map(toEvent);
}

/**
 * A fingerprint of what a signer submitted. It is written into the "signed"
 * event, which ties the stored answers and signature to the hash chain: editing
 * them later makes the fingerprint disagree with the history.
 */
export function contentHash(answers: Record<string, string>, signature: Signature): string {
  return createHash('sha256')
    .update(canonicalJson({ answers, signature: signature as unknown as JsonValue }))
    .digest('hex');
}
