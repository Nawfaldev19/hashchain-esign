import { signatureBlocks, validateForPublishing } from '../../shared/fields';
import type { FieldIssue, Point, Signature, TemplateField } from '../../shared/fields';
import { REQUEST_STATUSES } from '../../shared/status';
import { notFound } from '../domain/errors';
import type { StoredEvent } from '../domain/history';
import type { Page } from '../domain/pagination';
import { normalizePageRequest } from '../domain/pagination';
import { listMemberships } from '../services/auth-service';
import type { MembershipView } from '../services/auth-service';
import type {
  MemberRecord,
  RequestRecord,
  Scope,
  SignerRecord,
  TemplateRecord,
  TemplateVersionRecord,
  UserRecord,
  WorkspaceRecord,
} from '../services/records';
import {
  getRequest,
  listEvents,
  listRequests,
  statusOf,
  verifyHistory,
} from '../services/request-service';
import type { CreatedRequest, HistoryCheck, SignerLink } from '../services/request-service';
import type { SigningParty, SigningSession } from '../services/signing-service';
import { getTemplate, listTemplates, listVersions } from '../services/template-service';
import { listMembers } from '../services/workspace-service';
import { builder } from './builder';

export const RoleEnum = builder.enumType('Role', {
  values: {
    OWNER: { value: 'owner' },
    EDITOR: { value: 'editor' },
    VIEWER: { value: 'viewer' },
  } as const,
});

export const FieldKindEnum = builder.enumType('FieldKind', {
  values: {
    HEADING: { value: 'heading' },
    PARAGRAPH: { value: 'paragraph' },
    TEXT: { value: 'text' },
    LONG_TEXT: { value: 'longText' },
    CHECKBOX: { value: 'checkbox' },
    DATE: { value: 'date' },
    CHOICE: { value: 'choice' },
    SIGNATURE: { value: 'signature' },
  } as const,
});

export const RequestStatusEnum = builder.enumType('RequestStatus', { values: REQUEST_STATUSES });

export const SignatureKindEnum = builder.enumType('SignatureKind', {
  values: { DRAWN: { value: 'drawn' }, TYPED: { value: 'typed' } } as const,
});

export const SigningStateEnum = builder.enumType('SigningState', {
  values: ['OPEN', 'SIGNED', 'COMPLETED', 'EXPIRED', 'REVOKED'] as const,
});

const PointRef = builder.objectRef<Point>('Point').implement({
  fields: (t) => ({ x: t.exposeFloat('x'), y: t.exposeFloat('y') }),
});

const StrokeRef = builder.objectRef<Point[]>('Stroke').implement({
  description: 'One continuous pen movement of a drawn signature.',
  fields: (t) => ({ points: t.field({ type: [PointRef], resolve: (stroke) => stroke }) }),
});

const SignatureRef = builder.objectRef<Signature>('Signature').implement({
  fields: (t) => ({
    kind: t.field({ type: SignatureKindEnum, resolve: (signature) => signature.kind }),
    text: t.string({
      nullable: true,
      resolve: (signature) => (signature.kind === 'typed' ? signature.text : null),
    }),
    strokes: t.field({
      type: [StrokeRef],
      resolve: (signature) => (signature.kind === 'drawn' ? signature.strokes : []),
    }),
  }),
});

export const FieldRef = builder.objectRef<TemplateField>('Field').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.field({ type: FieldKindEnum, resolve: (field) => field.kind }),
    label: t.exposeString('label'),
    body: t.exposeString('body', { nullable: true }),
    required: t.exposeBoolean('required'),
    options: t.exposeStringList('options'),
    assignedTo: t.exposeID('assignedTo', { nullable: true }),
  }),
});

const FieldIssueRef = builder.objectRef<FieldIssue>('FieldIssue').implement({
  fields: (t) => ({
    fieldId: t.exposeID('fieldId', { nullable: true }),
    message: t.exposeString('message'),
  }),
});

interface AnswerShape {
  fieldId: string;
  value: string;
}

const AnswerRef = builder.objectRef<AnswerShape>('Answer').implement({
  fields: (t) => ({ fieldId: t.exposeID('fieldId'), value: t.exposeString('value') }),
});

const toAnswerList = (answers: Record<string, string>): AnswerShape[] =>
  Object.entries(answers).map(([fieldId, value]) => ({ fieldId, value }));

const WorkspaceSummaryRef = builder.objectRef<WorkspaceRecord>('WorkspaceSummary').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    accentColor: t.exposeString('accentColor'),
  }),
});

const MembershipRef = builder.objectRef<MembershipView>('Membership').implement({
  fields: (t) => ({
    role: t.field({ type: RoleEnum, resolve: (membership) => membership.role }),
    workspace: t.field({
      type: WorkspaceSummaryRef,
      resolve: (membership) => membership.workspace,
    }),
  }),
});

export const ViewerRef = builder.objectRef<UserRecord>('Viewer').implement({
  description: 'The signed-in user.',
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    memberships: t.field({
      type: [MembershipRef],
      resolve: (user, _args, ctx) => listMemberships(ctx.deps, user.id),
    }),
  }),
});

const MemberRef = builder.objectRef<MemberRecord>('Member').implement({
  fields: (t) => ({
    id: t.id({ resolve: (member) => member.user.id }),
    name: t.string({ resolve: (member) => member.user.name }),
    email: t.string({ resolve: (member) => member.user.email }),
    role: t.field({ type: RoleEnum, resolve: (member) => member.role }),
  }),
});

export const TemplateVersionRef = builder
  .objectRef<TemplateVersionRecord>('TemplateVersion')
  .implement({
    description: 'A published, unchangeable snapshot of a template.',
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeInt('number'),
      title: t.exposeString('title'),
      description: t.exposeString('description'),
      publishedAt: t.expose('publishedAt', { type: 'DateTime' }),
      fields: t.field({ type: [FieldRef], resolve: (version) => version.fields }),
      signatureBlocks: t.field({
        type: [FieldRef],
        resolve: (version) => signatureBlocks(version.fields),
      }),
    }),
  });

export const TemplateRef = builder.objectRef<TemplateRecord>('Template').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    description: t.exposeString('description'),
    draftRevision: t.exposeInt('draftRevision'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    draftFields: t.field({ type: [FieldRef], resolve: (template) => template.draftFields }),
    publishIssues: t.field({
      type: [FieldIssueRef],
      description: 'What still stops the draft from being published. Empty when ready.',
      resolve: (template) => validateForPublishing(template.draftFields),
    }),
    latestVersion: t.field({
      type: TemplateVersionRef,
      nullable: true,
      resolve: async (template, _args, ctx) => {
        const scope = await ctx.scope(template.workspaceId);
        return ctx.loaders(scope).latestVersion.load(template.id);
      },
    }),
    hasUnpublishedChanges: t.boolean({
      resolve: async (template, _args, ctx) => {
        const scope = await ctx.scope(template.workspaceId);
        const latest = await ctx.loaders(scope).latestVersion.load(template.id);
        return latest?.draftRevision !== template.draftRevision;
      },
    }),
    versions: t.field({
      type: [TemplateVersionRef],
      resolve: async (template, _args, ctx) =>
        listVersions(ctx.deps, await ctx.scope(template.workspaceId), template.id),
    }),
  }),
});

const SignerRef = builder.objectRef<SignerRecord>('Signer').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    blockId: t.exposeID('blockId'),
    label: t.exposeString('label'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    viewedAt: t.expose('viewedAt', { type: 'DateTime', nullable: true }),
    signedAt: t.expose('signedAt', { type: 'DateTime', nullable: true }),
    signature: t.field({
      type: SignatureRef,
      nullable: true,
      resolve: (signer) => signer.signature,
    }),
    answers: t.field({ type: [AnswerRef], resolve: (signer) => toAnswerList(signer.answers) }),
  }),
});

type EventShape = StoredEvent & { workspaceId: string };

const RequestEventRef = builder.objectRef<EventShape>('RequestEvent').implement({
  fields: (t) => ({
    seq: t.exposeInt('seq'),
    kind: t.exposeString('kind'),
    occurredAt: t.expose('occurredAt', { type: 'DateTime' }),
    hash: t.exposeString('hash'),
    actorName: t.string({
      resolve: async (event, _args, ctx) => {
        const scope = await ctx.scope(event.workspaceId);
        const names = await ctx.loaders(scope).actorNames.load(event.requestId);
        return names.get(event.actor) ?? 'Signoff Ledger';
      },
    }),
  }),
});

export const HistoryCheckRef = builder.objectRef<HistoryCheck>('HistoryCheck').implement({
  description: 'The result of re-computing the hash chain of a request.',
  fields: (t) => ({
    intact: t.exposeBoolean('intact'),
    checkedEvents: t.exposeInt('checkedEvents'),
    problem: t.exposeString('problem', { nullable: true }),
  }),
});

export const SigningRequestRef = builder.objectRef<RequestRecord>('SigningRequest').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    message: t.exposeString('message'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    expiresAt: t.expose('expiresAt', { type: 'DateTime' }),
    completedAt: t.expose('completedAt', { type: 'DateTime', nullable: true }),
    revokedAt: t.expose('revokedAt', { type: 'DateTime', nullable: true }),
    signerCount: t.exposeInt('signerCount'),
    signedCount: t.exposeInt('signedCount'),
    status: t.field({
      type: RequestStatusEnum,
      resolve: (request, _args, ctx) => statusOf(request, ctx.deps.now()),
    }),
    pdfUrl: t.string({
      resolve: (request) => `/files/${request.workspaceId}/requests/${request.id}.pdf`,
    }),
    version: t.field({
      type: TemplateVersionRef,
      resolve: async (request, _args, ctx) => {
        const scope = await ctx.scope(request.workspaceId);
        const version = await ctx.loaders(scope).version.load(request.templateVersionId);
        if (!version) throw notFound('Template version');
        return version;
      },
    }),
    signers: t.field({
      type: [SignerRef],
      resolve: async (request, _args, ctx) => {
        const scope = await ctx.scope(request.workspaceId);
        return ctx.loaders(scope).signers.load(request.id);
      },
    }),
    events: t.field({
      type: [RequestEventRef],
      resolve: async (request, _args, ctx) => {
        const scope = await ctx.scope(request.workspaceId);
        const events = await listEvents(ctx.deps, scope, request.id);
        return events.map((event) => ({ ...event, workspaceId: request.workspaceId }));
      },
    }),
    historyCheck: t.field({
      type: HistoryCheckRef,
      resolve: async (request, _args, ctx) =>
        verifyHistory(ctx.deps, await ctx.scope(request.workspaceId), request.id),
    }),
  }),
});

const TemplatePageRef = builder.objectRef<Page<TemplateRecord>>('TemplatePage').implement({
  fields: (t) => ({
    items: t.field({ type: [TemplateRef], resolve: (page) => page.items }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
    hasNextPage: t.exposeBoolean('hasNextPage'),
  }),
});

const RequestPageRef = builder.objectRef<Page<RequestRecord>>('RequestPage').implement({
  fields: (t) => ({
    items: t.field({ type: [SigningRequestRef], resolve: (page) => page.items }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
    hasNextPage: t.exposeBoolean('hasNextPage'),
  }),
});

export interface WorkspaceShape {
  scope: Scope;
  record: WorkspaceRecord;
}

export const WorkspaceRef = builder.objectRef<WorkspaceShape>('Workspace').implement({
  description: 'One tenant. Everything below it belongs to this workspace only.',
  fields: (t) => ({
    id: t.id({ resolve: (workspace) => workspace.record.id }),
    name: t.string({ resolve: (workspace) => workspace.record.name }),
    accentColor: t.string({ resolve: (workspace) => workspace.record.accentColor }),
    role: t.field({
      type: RoleEnum,
      description: 'The role of the signed-in user in this workspace.',
      resolve: (workspace) => workspace.scope.role,
    }),
    members: t.field({
      type: [MemberRef],
      resolve: (workspace, _args, ctx) => listMembers(ctx.deps, workspace.scope),
    }),
    templates: t.field({
      type: TemplatePageRef,
      args: { first: t.arg.int({ required: false }), after: t.arg.string({ required: false }) },
      resolve: (workspace, args, ctx) =>
        listTemplates(ctx.deps, workspace.scope, normalizePageRequest(args.first, args.after)),
    }),
    template: t.field({
      type: TemplateRef,
      args: { id: t.arg.id() },
      resolve: (workspace, args, ctx) => getTemplate(ctx.deps, workspace.scope, args.id),
    }),
    requests: t.field({
      type: RequestPageRef,
      args: {
        first: t.arg.int({ required: false }),
        after: t.arg.string({ required: false }),
        status: t.arg({ type: RequestStatusEnum, required: false }),
      },
      resolve: (workspace, args, ctx) =>
        listRequests(
          ctx.deps,
          workspace.scope,
          normalizePageRequest(args.first, args.after),
          args.status ?? null,
        ),
    }),
    request: t.field({
      type: SigningRequestRef,
      args: { id: t.arg.id() },
      resolve: (workspace, args, ctx) => getRequest(ctx.deps, workspace.scope, args.id),
    }),
  }),
});

export const SignerLinkRef = builder.objectRef<SignerLink>('SignerLink').implement({
  description: 'A private signing link. It is shown once; only its hash is stored.',
  fields: (t) => ({
    signerId: t.exposeID('signerId'),
    label: t.exposeString('label'),
    name: t.exposeString('name'),
    url: t.exposeString('url'),
  }),
});

export const CreatedRequestRef = builder.objectRef<CreatedRequest>('CreatedRequest').implement({
  fields: (t) => ({
    request: t.field({ type: SigningRequestRef, resolve: (created) => created.request }),
    links: t.field({ type: [SignerLinkRef], resolve: (created) => created.links }),
  }),
});

const SigningPartyRef = builder.objectRef<SigningParty>('SigningParty').implement({
  fields: (t) => ({
    blockId: t.exposeID('blockId'),
    label: t.exposeString('label'),
    name: t.exposeString('name'),
    signedAt: t.expose('signedAt', { type: 'DateTime', nullable: true }),
    isYou: t.exposeBoolean('isYou'),
    signature: t.field({
      type: SignatureRef,
      nullable: true,
      resolve: (party) => party.signature,
    }),
  }),
});

export const SigningSessionRef = builder.objectRef<SigningSession>('SigningSession').implement({
  description: 'What the holder of a signing link may see. No account is involved.',
  fields: (t) => ({
    state: t.field({ type: SigningStateEnum, resolve: (session) => session.state }),
    workspaceName: t.exposeString('workspaceName'),
    accentColor: t.exposeString('accentColor'),
    requestTitle: t.exposeString('requestTitle'),
    message: t.exposeString('message'),
    expiresAt: t.expose('expiresAt', { type: 'DateTime' }),
    versionNumber: t.exposeInt('versionNumber'),
    documentTitle: t.exposeString('documentTitle'),
    documentDescription: t.exposeString('documentDescription'),
    yourBlockId: t.exposeID('yourBlockId'),
    fields: t.field({ type: [FieldRef], resolve: (session) => session.fields }),
    parties: t.field({ type: [SigningPartyRef], resolve: (session) => session.parties }),
    answers: t.field({ type: [AnswerRef], resolve: (session) => toAnswerList(session.answers) }),
  }),
});
