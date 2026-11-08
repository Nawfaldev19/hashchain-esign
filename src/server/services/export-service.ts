import { notFound } from '../domain/errors';
import { renderRequestPdf } from './pdf-service';
import {
  getRequest,
  listEvents,
  signersByRequest,
  statusOf,
  verifyHistory,
} from './request-service';
import type { Deps, Scope } from './records';
import { versionsById } from './template-service';
import { getWorkspace, listMembers } from './workspace-service';

export interface ExportedFile {
  filename: string;
  bytes: Uint8Array;
}

/** Maps the "actor" strings stored in events to names a reader understands. */
export async function actorNamesFor(
  deps: Deps,
  scope: Scope,
  requestId: string,
): Promise<Map<string, string>> {
  const names = new Map<string, string>([['system', 'Signoff Ledger']]);
  for (const member of await listMembers(deps, scope)) {
    names.set(`user:${member.user.id}`, member.user.name);
  }
  const signers = (await signersByRequest(deps, scope, [requestId])).get(requestId) ?? [];
  for (const signer of signers) {
    names.set(`signer:${signer.id}`, `${signer.name}, ${signer.label}`);
  }
  return names;
}

export async function exportRequestPdf(
  deps: Deps,
  scope: Scope,
  requestId: string,
): Promise<ExportedFile> {
  const request = await getRequest(deps, scope, requestId);
  const version = (await versionsById(deps, scope, [request.templateVersionId])).get(
    request.templateVersionId,
  );
  if (!version) throw notFound('Template version');

  const bytes = await renderRequestPdf({
    workspace: await getWorkspace(deps, scope),
    request,
    status: statusOf(request, deps.now()),
    version,
    signers: (await signersByRequest(deps, scope, [requestId])).get(requestId) ?? [],
    events: await listEvents(deps, scope, requestId),
    actorNames: await actorNamesFor(deps, scope, requestId),
    history: await verifyHistory(deps, scope, requestId),
    generatedAt: deps.now(),
  });
  const slug = request.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { filename: `${slug || 'request'}.pdf`, bytes };
}
