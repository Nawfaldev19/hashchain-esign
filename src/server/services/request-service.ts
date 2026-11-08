import { signatureBlocks } from '../../shared/fields';
import { deriveRequestStatus, isOpen } from '../../shared/status';
import type { RequestStatus } from '../../shared/status';
import { conflict, invalid, notFound } from '../domain/errors';
import { verifyChain } from '../domain/history';
import type { StoredEvent } from '../domain/history';
import { decodeCursor, isUuid, toPage } from '../domain/pagination';
import type { Page, PageRequest } from '../domain/pagination';
import { generateToken, hashToken } from '../domain/secrets';
import type { Queryable } from '../db/database';
import { assertRole } from './auth-service';
import { appendEvent, contentHash, loadEvents } from './event-log';
import type {
  Deps,
  RequestRecord,
  RequestRow,
  Scope,
  SignerRecord,
  SignerRow,
  TemplateVersionRow,
} from './records';
import { REQUEST_COLUMNS, toRequest, toSigner } from './records';
import { firstRow } from './template-service';
import { newRequestSchema, parseInput } from './validation';

const SIGNER_COLUMNS =
  'id, workspace_id, request_id, block_id, label, name, email, viewed_at, signed_at, signature, answers';

/**
 * The status is derived, so filtering by it happens in SQL with the same rules
 * as deriveRequestStatus. The fragments are fixed text; $4 is "now". Every
 * fragment mentions $4, because Postgres rejects a bound parameter the statement
 * never uses.
 */
const STATUS_FILTERS: Readonly<Record<RequestStatus, string>> = {
  REVOKED: 'r.revoked_at is not null and $4::timestamptz is not null',
  COMPLETED: 'r.completed_at is not null and $4::timestamptz is not null',
  EXPIRED: 'r.revoked_at is null and r.completed_at is null and r.expires_at <= $4',
  PARTLY_SIGNED: `r.revoked_at is null and r.completed_at is null and r.expires_at > $4
    and exists (select 1 from signers s where s.request_id = r.id and s.signed_at is not null)`,
  AWAITING: `r.revoked_at is null and r.completed_at is null and r.expires_at > $4
    and not exists (select 1 from signers s where s.request_id = r.id and s.signed_at is not null)`,
};

export function statusOf(request: RequestRecord, now: Date): RequestStatus {
  return deriveRequestStatus(request, now);
}

export async function listRequests(
  deps: Deps,
  scope: Scope,
  page: PageRequest,
  status: RequestStatus | null,
): Promise<Page<RequestRecord>> {
  const after = page.after === null ? null : decodeCursor(page.after);
  const statusFilter = status === null ? '$4::timestamptz is not null' : STATUS_FILTERS[status];
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<RequestRow>(
      `select ${REQUEST_COLUMNS} from signing_requests r
        where ($1::timestamptz is null or (r.created_at, r.id) < ($1::timestamptz, $2::uuid))
          and ${statusFilter}
        order by r.created_at desc, r.id desc
        limit $3`,
      [after?.createdAt ?? null, after?.id ?? null, page.first + 1, deps.now()],
    ),
  );
  return toPage(rows.map(toRequest), page.first);
}

async function findRequest(q: Queryable, id: string): Promise<RequestRecord> {
  const rows = await q.query<RequestRow>(
    `select ${REQUEST_COLUMNS} from signing_requests r where r.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound('Request');
  return toRequest(row);
}

export async function getRequest(deps: Deps, scope: Scope, id: string): Promise<RequestRecord> {
  if (!isUuid(id)) throw notFound('Request');
  return deps.db.tenant(scope.workspaceId, (q) => findRequest(q, id));
}

export interface SignerLink {
  signerId: string;
  label: string;
  name: string;
  url: string;
}

export interface CreatedRequest {
  request: RequestRecord;
  /** Shown once. Only the hash of each token is stored. */
  links: SignerLink[];
}

export function signingUrl(deps: Deps, token: string): string {
  return `${deps.publicUrl.replace(/\/$/, '')}/sign/${token}`;
}

export async function createRequest(
  deps: Deps,
  scope: Scope,
  input: {
    templateVersionId: string;
    title: string;
    message: string;
    expiresInDays: number;
    signers: { blockId: string; name: string; email: string }[];
  },
): Promise<CreatedRequest> {
  assertRole(scope, 'editor');
  if (!isUuid(input.templateVersionId)) throw notFound('Template version');
  const request = parseInput(newRequestSchema, input);
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const versions = await q.query<TemplateVersionRow>(
      'select id, number, fields from template_versions where id = $1',
      [input.templateVersionId],
    );
    const version = versions[0];
    if (!version) throw notFound('Template version');

    const blocks = signatureBlocks(version.fields);
    const signerByBlock = new Map(request.signers.map((signer) => [signer.blockId, signer]));
    const everyBlockNamedOnce =
      signerByBlock.size === request.signers.length &&
      blocks.length === request.signers.length &&
      blocks.every((block) => signerByBlock.has(block.id));
    if (!everyBlockNamedOnce) {
      throw invalid('Name exactly one signer for each signature block.');
    }

    const inserted = await q.query<{ id: string }>(
      `insert into signing_requests
         (workspace_id, template_version_id, title, message, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        scope.workspaceId,
        version.id,
        request.title,
        request.message,
        new Date(now.getTime() + request.expiresInDays * 86_400_000),
        scope.userId,
      ],
    );
    const requestId = firstRow(inserted).id;

    const links: SignerLink[] = [];
    for (const block of blocks) {
      const signer = signerByBlock.get(block.id);
      if (!signer) continue;
      const token = generateToken();
      const rows = await q.query<{ id: string }>(
        `insert into signers (workspace_id, request_id, block_id, label, name, email, token_hash)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          scope.workspaceId,
          requestId,
          block.id,
          block.label,
          signer.name,
          signer.email.toLowerCase(),
          hashToken(token),
        ],
      );
      links.push({
        signerId: firstRow(rows).id,
        label: block.label,
        name: signer.name,
        url: signingUrl(deps, token),
      });
    }

    await appendEvent(q, {
      workspaceId: scope.workspaceId,
      requestId,
      kind: 'created',
      actor: `user:${scope.userId}`,
      detail: { templateVersion: version.number, signers: links.length },
      occurredAt: now,
    });
    return { request: await findRequest(q, requestId), links };
  });
}

export async function revokeRequest(deps: Deps, scope: Scope, id: string): Promise<RequestRecord> {
  assertRole(scope, 'editor');
  if (!isUuid(id)) throw notFound('Request');
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    await q.query('select id from signing_requests where id = $1 for update', [id]);
    const request = await findRequest(q, id);
    const status = statusOf(request, now);
    if (status === 'REVOKED') throw conflict('This request is already revoked.');
    if (status === 'COMPLETED') throw conflict('A completed request cannot be revoked.');

    await q.query('update signing_requests set revoked_at = $1 where id = $2', [now, id]);
    await appendEvent(q, {
      workspaceId: scope.workspaceId,
      requestId: id,
      kind: 'revoked',
      actor: `user:${scope.userId}`,
      detail: {},
      occurredAt: now,
    });
    return findRequest(q, id);
  });
}

/** Replaces a signer's link. The old link stops working at once. */
export async function reissueLink(deps: Deps, scope: Scope, signerId: string): Promise<SignerLink> {
  assertRole(scope, 'editor');
  if (!isUuid(signerId)) throw notFound('Signer');
  const now = deps.now();

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const signers = await q.query<SignerRow>(
      `select ${SIGNER_COLUMNS} from signers where id = $1 for update`,
      [signerId],
    );
    const signer = signers[0];
    if (!signer) throw notFound('Signer');
    const request = await findRequest(q, signer.request_id);
    if (!isOpen(statusOf(request, now)) || signer.signed_at !== null) {
      throw conflict('A new link can only be made while this signer still has to sign.');
    }

    const token = generateToken();
    await q.query('update signers set token_hash = $1 where id = $2', [hashToken(token), signerId]);
    await appendEvent(q, {
      workspaceId: scope.workspaceId,
      requestId: signer.request_id,
      kind: 'link_reissued',
      actor: `user:${scope.userId}`,
      detail: { signerId, label: signer.label },
      occurredAt: now,
    });
    return { signerId, label: signer.label, name: signer.name, url: signingUrl(deps, token) };
  });
}

/** Batched lookup: the signers of many requests in one query. */
export async function signersByRequest(
  deps: Deps,
  scope: Scope,
  requestIds: readonly string[],
): Promise<Map<string, SignerRecord[]>> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<SignerRow>(
      `select ${SIGNER_COLUMNS} from signers
        where request_id = any($1::uuid[])
        order by request_id, label`,
      [requestIds],
    ),
  );
  const grouped = new Map<string, SignerRecord[]>();
  for (const row of rows) {
    const list = grouped.get(row.request_id) ?? [];
    list.push(toSigner(row));
    grouped.set(row.request_id, list);
  }
  return grouped;
}

export async function listEvents(
  deps: Deps,
  scope: Scope,
  requestId: string,
): Promise<StoredEvent[]> {
  return deps.db.tenant(scope.workspaceId, (q) => loadEvents(q, requestId));
}

export interface HistoryCheck {
  intact: boolean;
  checkedEvents: number;
  /** A sentence for people, or null when everything fits. */
  problem: string | null;
}

/**
 * Re-computes the whole hash chain and compares every signer's stored answers
 * and signature with the fingerprint recorded when they signed.
 */
export async function verifyHistory(
  deps: Deps,
  scope: Scope,
  requestId: string,
): Promise<HistoryCheck> {
  if (!isUuid(requestId)) throw notFound('Request');
  return deps.db.tenant(scope.workspaceId, async (q) => {
    await findRequest(q, requestId);
    const events = await loadEvents(q, requestId);
    const chain = verifyChain(events);
    if (!chain.intact) {
      return {
        intact: false,
        checkedEvents: chain.checkedEvents,
        problem: `Event ${chain.brokenAtSeq ?? '?'} does not fit the chain. The history was changed after it was written.`,
      };
    }

    const signers = await q.query<SignerRow>(
      `select ${SIGNER_COLUMNS} from signers where request_id = $1`,
      [requestId],
    );
    for (const signer of signers) {
      if (signer.signature === null) continue;
      const recorded = events.find(
        (event) => event.kind === 'signed' && event.detail.signerId === signer.id,
      );
      if (recorded?.detail.contentHash !== contentHash(signer.answers, signer.signature)) {
        return {
          intact: false,
          checkedEvents: chain.checkedEvents,
          problem: `What ${signer.label} submitted no longer matches the fingerprint recorded when they signed.`,
        };
      }
    }
    return { intact: true, checkedEvents: chain.checkedEvents, problem: null };
  });
}
