import type { Signature } from '../../shared/fields';
import { login, logout } from '../services/auth-service';
import { createRequest, reissueLink, revokeRequest } from '../services/request-service';
import { openSigningSession, recordView, submitSignature } from '../services/signing-service';
import { createTemplate, publishTemplate, saveDraft } from '../services/template-service';
import { getWorkspace, updateBranding } from '../services/workspace-service';
import { builder } from './builder';
import { SESSION_COOKIE } from './context';
import {
  CreatedRequestRef,
  FieldKindEnum,
  SignatureKindEnum,
  SignerLinkRef,
  SigningRequestRef,
  SigningSessionRef,
  SigningStateEnum,
  TemplateRef,
  TemplateVersionRef,
  ViewerRef,
  WorkspaceRef,
} from './types';

builder.queryFields((t) => ({
  viewer: t.field({
    type: ViewerRef,
    nullable: true,
    description: 'The signed-in user, or null when nobody is signed in.',
    resolve: (_root, _args, ctx) => ctx.user,
  }),
  workspace: t.field({
    type: WorkspaceRef,
    args: { id: t.arg.id() },
    description: 'A workspace the signed-in user is a member of.',
    resolve: async (_root, args, ctx) => {
      const scope = await ctx.scope(args.id);
      return { scope, record: await getWorkspace(ctx.deps, scope) };
    },
  }),
  signingSession: t.field({
    type: SigningSessionRef,
    args: { token: t.arg.string() },
    description: 'Public. Opens the document behind a signing link.',
    resolve: (_root, args, ctx) => openSigningSession(ctx.deps, args.token, ctx.clientKey),
  }),
}));

const FieldInput = builder.inputType('FieldInput', {
  fields: (t) => ({
    id: t.id(),
    kind: t.field({ type: FieldKindEnum }),
    label: t.string(),
    body: t.string({ required: false }),
    required: t.boolean(),
    options: t.stringList(),
    assignedTo: t.id({ required: false }),
  }),
});

const DraftInput = builder.inputType('DraftInput', {
  fields: (t) => ({
    title: t.string(),
    description: t.string(),
    fields: t.field({ type: [FieldInput] }),
    expectedRevision: t.int({
      description: 'The draftRevision the edit started from. A mismatch is a CONFLICT.',
    }),
  }),
});

const SignerInput = builder.inputType('SignerInput', {
  fields: (t) => ({ blockId: t.id(), name: t.string(), email: t.string() }),
});

const NewRequestInput = builder.inputType('NewRequestInput', {
  fields: (t) => ({
    templateVersionId: t.id(),
    title: t.string(),
    message: t.string(),
    expiresInDays: t.int(),
    signers: t.field({ type: [SignerInput] }),
  }),
});

const PointInput = builder.inputType('PointInput', {
  fields: (t) => ({ x: t.float(), y: t.float() }),
});

const StrokeInput = builder.inputType('StrokeInput', {
  fields: (t) => ({ points: t.field({ type: [PointInput] }) }),
});

const SignatureInput = builder.inputType('SignatureInput', {
  fields: (t) => ({
    kind: t.field({ type: SignatureKindEnum }),
    text: t.string({ required: false }),
    strokes: t.field({ type: [StrokeInput], required: false }),
  }),
});

const AnswerInput = builder.inputType('AnswerInput', {
  fields: (t) => ({ fieldId: t.id(), value: t.string() }),
});

const SubmissionInput = builder.inputType('SubmissionInput', {
  fields: (t) => ({
    answers: t.field({ type: [AnswerInput] }),
    signature: t.field({ type: SignatureInput }),
  }),
});

builder.mutationFields((t) => ({
  login: t.field({
    type: ViewerRef,
    args: { email: t.arg.string(), password: t.arg.string() },
    resolve: async (_root, args, ctx) => {
      const result = await login(ctx.deps, args, ctx.clientKey);
      ctx.cookies.set(SESSION_COOKIE, result.token, result.expiresAt);
      return result.user;
    },
  }),
  logout: t.boolean({
    resolve: async (_root, _args, ctx) => {
      if (ctx.sessionToken !== null) await logout(ctx.deps, ctx.sessionToken);
      ctx.cookies.clear(SESSION_COOKIE);
      return true;
    },
  }),

  createTemplate: t.field({
    type: TemplateRef,
    args: { workspaceId: t.arg.id(), title: t.arg.string(), description: t.arg.string() },
    resolve: async (_root, args, ctx) =>
      createTemplate(ctx.deps, await ctx.scope(args.workspaceId), args),
  }),
  saveTemplateDraft: t.field({
    type: TemplateRef,
    args: {
      workspaceId: t.arg.id(),
      templateId: t.arg.id(),
      input: t.arg({ type: DraftInput }),
    },
    resolve: async (_root, args, ctx) =>
      saveDraft(ctx.deps, await ctx.scope(args.workspaceId), args.templateId, {
        ...args.input,
        fields: args.input.fields.map((field) => ({
          ...field,
          body: field.body ?? null,
          assignedTo: field.assignedTo ?? null,
        })),
      }),
  }),
  publishTemplate: t.field({
    type: TemplateVersionRef,
    args: { workspaceId: t.arg.id(), templateId: t.arg.id() },
    resolve: async (_root, args, ctx) =>
      publishTemplate(ctx.deps, await ctx.scope(args.workspaceId), args.templateId),
  }),

  createSigningRequest: t.field({
    type: CreatedRequestRef,
    args: { workspaceId: t.arg.id(), input: t.arg({ type: NewRequestInput }) },
    resolve: async (_root, args, ctx) =>
      createRequest(ctx.deps, await ctx.scope(args.workspaceId), args.input),
  }),
  revokeSigningRequest: t.field({
    type: SigningRequestRef,
    args: { workspaceId: t.arg.id(), requestId: t.arg.id() },
    resolve: async (_root, args, ctx) =>
      revokeRequest(ctx.deps, await ctx.scope(args.workspaceId), args.requestId),
  }),
  reissueSignerLink: t.field({
    type: SignerLinkRef,
    args: { workspaceId: t.arg.id(), signerId: t.arg.id() },
    resolve: async (_root, args, ctx) =>
      reissueLink(ctx.deps, await ctx.scope(args.workspaceId), args.signerId),
  }),

  updateWorkspaceBranding: t.field({
    type: WorkspaceRef,
    args: { workspaceId: t.arg.id(), name: t.arg.string(), accentColor: t.arg.string() },
    resolve: async (_root, args, ctx) => {
      const scope = await ctx.scope(args.workspaceId);
      return { scope, record: await updateBranding(ctx.deps, scope, args) };
    },
  }),

  recordSigningView: t.boolean({
    args: { token: t.arg.string() },
    description: 'Public. Notes the first time a signer opens their link.',
    resolve: (_root, args, ctx) => recordView(ctx.deps, args.token, ctx.clientKey),
  }),
  submitSignature: t.field({
    type: SigningStateEnum,
    args: { token: t.arg.string(), input: t.arg({ type: SubmissionInput }) },
    description: 'Public. Submits the answers and signature of the link holder.',
    resolve: (_root, args, ctx) => {
      const raw = args.input.signature;
      const signature: Signature =
        raw.kind === 'typed'
          ? { kind: 'typed', text: raw.text ?? '' }
          : { kind: 'drawn', strokes: (raw.strokes ?? []).map((stroke) => stroke.points) };
      return submitSignature(
        ctx.deps,
        args.token,
        { answers: args.input.answers, signature },
        ctx.clientKey,
      );
    },
  }),
}));
