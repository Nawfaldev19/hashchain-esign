import { isInputKind, validateAnswers, validateSignature } from '../../shared/fields';
import type { Signature, TemplateField } from '../../shared/fields';
import { deriveRequestStatus } from '../../shared/status';
import type { Queryable } from '../db/database';
import { AppError, conflict, invalid, notFound } from '../domain/errors';
import { hashToken } from '../domain/secrets';
import { appendEvent, contentHash } from './event-log';
import type { Deps, RequestRow, SignerRow, TemplateVersionRow } from './records';
import { REQUEST_COLUMNS, toRequest, toSigner } from './records';
import { parseInput, submissionSchema } from './validation';

/**
 * The public side: everything a person can do with nothing but a signing link.
 * There is no user and no Scope here. The token is the only credential, and it
 * is traded for a workspace id through one narrow database function.
 */

export type SigningState = 'OPEN' | 'SIGNED' | 'COMPLETED' | 'EXPIRED' | 'REVOKED';

export interface SigningParty {
  blockId: string;
  label: string;
  name: string;
  signedAt: Date | null;
  signature: Signature | null;
  isYou: boolean;
}

export interface SigningSession {
  state: SigningState;
  workspaceName: string;
  accentColor: string;
  requestTitle: string;
  message: string;
  expiresAt: Date;
  versionNumber: number;
  documentTitle: string;
  documentDescription: string;
  /** Empty when the link is expired or revoked: a dead link shows no content. */
  fields: TemplateField[];
  parties: SigningParty[];
  /** Answers of everyone who has already signed, keyed by field id. */
  answers: Record<string, string>;
  yourBlockId: string;
}

interface TokenTarget {
  workspace_id: string;
  signer_id: string;
  request_id: string;
}

async function resolveToken(deps: Deps, token: string, clientKey: string): Promise<TokenTarget> {
  if (!deps.tokenLimiter.hit(clientKey)) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
  }
  const rows = await deps.db.directory((q) =>
    q.query<TokenTarget>('select * from resolve_signing_token($1)', [hashToken(token)]),
  );
  const target = rows[0];
  if (!target) throw notFound('Signing link');
  return target;
}

interface Loaded {
  request: ReturnType<typeof toRequest>;
  signers: ReturnType<typeof toSigner>[];
  you: ReturnType<typeof toSigner>;
  version: TemplateVersionRow;
  state: SigningState;
}

async function load(q: Queryable, target: TokenTarget, now: Date): Promise<Loaded> {
  const requests = await q.query<RequestRow>(
    `select ${REQUEST_COLUMNS} from signing_requests r where r.id = $1`,
    [target.request_id],
  );
  const signerRows = await q.query<SignerRow>(
    `select id, workspace_id, request_id, block_id, label, name, email, viewed_at, signed_at,
            signature, answers
       from signers where request_id = $1 order by label`,
    [target.request_id],
  );
  const requestRow = requests[0];
  const signers = signerRows.map(toSigner);
  const you = signers.find((signer) => signer.id === target.signer_id);
  if (!requestRow || !you) throw notFound('Signing link');
  const request = toRequest(requestRow);

  const versions = await q.query<TemplateVersionRow>(
    `select id, workspace_id, template_id, number, title, description, fields, draft_revision,
            published_at
       from template_versions where id = $1`,
    [request.templateVersionId],
  );
  const version = versions[0];
  if (!version) throw notFound('Signing link');

  const status = deriveRequestStatus(request, now);
  let state: SigningState;
  if (status === 'REVOKED') state = 'REVOKED';
  else if (status === 'COMPLETED') state = 'COMPLETED';
  else if (you.signedAt !== null) state = 'SIGNED';
  else if (status === 'EXPIRED') state = 'EXPIRED';
  else state = 'OPEN';

  return { request, signers, you, version, state };
}

export async function openSigningSession(
  deps: Deps,
  token: string,
  clientKey: string,
): Promise<SigningSession> {
  const target = await resolveToken(deps, token, clientKey);
  return deps.db.tenant(target.workspace_id, async (q) => {
    const { request, signers, you, version, state } = await load(q, target, deps.now());
    const workspaces = await q.query<{ name: string; accent_color: string }>(
      'select name, accent_color from workspaces',
    );
    const workspace = workspaces[0];
    if (!workspace) throw notFound('Signing link');

    const showContent = state !== 'EXPIRED' && state !== 'REVOKED';
    const answers: Record<string, string> = {};
    if (showContent) {
      for (const signer of signers) {
        if (signer.signedAt !== null) Object.assign(answers, signer.answers);
      }
    }

    return {
      state,
      workspaceName: workspace.name,
      accentColor: workspace.accent_color.toUpperCase(),
      requestTitle: request.title,
      message: showContent ? request.message : '',
      expiresAt: request.expiresAt,
      versionNumber: version.number,
      documentTitle: version.title,
      documentDescription: showContent ? version.description : '',
      fields: showContent ? version.fields : [],
      parties: showContent
        ? signers.map((signer) => ({
            blockId: signer.blockId,
            label: signer.label,
            name: signer.name,
            signedAt: signer.signedAt,
            signature: signer.signature,
            isYou: signer.id === you.id,
          }))
        : [],
      answers,
      yourBlockId: you.blockId,
    };
  });
}

/** Records the first time a signer opens their link. Later opens change nothing. */
export async function recordView(deps: Deps, token: string, clientKey: string): Promise<boolean> {
  const target = await resolveToken(deps, token, clientKey);
  const now = deps.now();
  return deps.db.tenant(target.workspace_id, async (q) => {
    const { state, you } = await load(q, target, now);
    if (state !== 'OPEN') return false;
    const marked = await q.query(
      'update signers set viewed_at = $1 where id = $2 and viewed_at is null returning id',
      [now, you.id],
    );
    if (marked.length === 0) return false;
    await appendEvent(q, {
      workspaceId: target.workspace_id,
      requestId: target.request_id,
      kind: 'viewed',
      actor: `signer:${you.id}`,
      detail: { signerId: you.id, label: you.label },
      occurredAt: now,
    });
    return true;
  });
}

const CLOSED_MESSAGES: Readonly<Record<Exclude<SigningState, 'OPEN'>, string>> = {
  SIGNED: 'You have already signed this document.',
  COMPLETED: 'This document is already completed.',
  EXPIRED: 'This signing link has expired.',
  REVOKED: 'This request was withdrawn.',
};

export async function submitSignature(
  deps: Deps,
  token: string,
  input: { answers: { fieldId: string; value: string }[]; signature: Signature },
  clientKey: string,
): Promise<SigningState> {
  const submission = parseInput(submissionSchema, input);
  const target = await resolveToken(deps, token, clientKey);
  const now = deps.now();

  return deps.db.tenant(target.workspace_id, async (q) => {
    // Locking the request row makes signers of the same request take turns, so
    // "is everyone done?" below is always answered on settled data.
    await q.query('select id from signing_requests where id = $1 for update', [target.request_id]);
    const { state, you, version, signers } = await load(q, target, now);
    if (state !== 'OPEN') throw conflict(CLOSED_MESSAGES[state]);

    const answers: Record<string, string> = {};
    for (const answer of submission.answers) answers[answer.fieldId] = answer.value.trim();
    const issues = validateAnswers(version.fields, you.blockId, answers);
    const signatureIssue = validateSignature(submission.signature);
    if (signatureIssue !== null) issues.push({ fieldId: you.blockId, message: signatureIssue });
    if (issues.length > 0) throw invalid('Some answers need another look.', issues);

    const kept: Record<string, string> = {};
    for (const field of version.fields) {
      if (isInputKind(field.kind) && field.assignedTo === you.blockId) {
        kept[field.id] = answers[field.id] ?? '';
      }
    }
    const signature: Signature =
      submission.signature.kind === 'typed'
        ? { kind: 'typed', text: submission.signature.text.trim() }
        : { kind: 'drawn', strokes: submission.signature.strokes.filter((s) => s.length > 1) };

    const updated = await q.query(
      `update signers set signed_at = $1, signature = $2::jsonb, answers = $3::jsonb
        where id = $4 and signed_at is null
        returning id`,
      [now, JSON.stringify(signature), JSON.stringify(kept), you.id],
    );
    if (updated.length === 0) throw conflict(CLOSED_MESSAGES.SIGNED);

    await appendEvent(q, {
      workspaceId: target.workspace_id,
      requestId: target.request_id,
      kind: 'signed',
      actor: `signer:${you.id}`,
      detail: {
        signerId: you.id,
        label: you.label,
        signatureKind: signature.kind,
        contentHash: contentHash(kept, signature),
      },
      occurredAt: now,
    });

    const everyoneElseSigned = signers.every(
      (signer) => signer.id === you.id || signer.signedAt !== null,
    );
    if (!everyoneElseSigned) return 'SIGNED';

    await q.query('update signing_requests set completed_at = $1 where id = $2', [
      now,
      target.request_id,
    ]);
    await appendEvent(q, {
      workspaceId: target.workspace_id,
      requestId: target.request_id,
      kind: 'completed',
      actor: 'system',
      detail: { signers: signers.length },
      occurredAt: now,
    });
    return 'COMPLETED';
  });
}
