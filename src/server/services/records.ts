import type { Signature, TemplateField } from '../../shared/fields';
import type { Database } from '../db/database';
import type { RateLimiter } from '../domain/rate-limit';

/** Shapes the services hand to the API layer, and the row mappers that build them. */

export const ROLES = ['viewer', 'editor', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

/** Proof that a signed-in user is a member of a workspace, and with which role. */
export interface Scope {
  workspaceId: string;
  userId: string;
  role: Role;
}

/** What every service needs. Passed in, never imported, so tests can swap parts. */
export interface Deps {
  db: Database;
  now: () => Date;
  publicUrl: string;
  sessionTtlHours: number;
  loginLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  accentColor: string;
}

export interface MemberRecord {
  user: UserRecord;
  role: Role;
}

export interface TemplateRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  draftFields: TemplateField[];
  draftRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateVersionRecord {
  id: string;
  workspaceId: string;
  templateId: string;
  number: number;
  title: string;
  description: string;
  fields: TemplateField[];
  draftRevision: number;
  publishedAt: Date;
}

export interface RequestRecord {
  id: string;
  workspaceId: string;
  templateVersionId: string;
  title: string;
  message: string;
  expiresAt: Date;
  completedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  signerCount: number;
  signedCount: number;
}

export interface SignerRecord {
  id: string;
  workspaceId: string;
  requestId: string;
  blockId: string;
  label: string;
  name: string;
  email: string;
  viewedAt: Date | null;
  signedAt: Date | null;
  signature: Signature | null;
  answers: Record<string, string>;
}

export interface TemplateRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  draft_fields: TemplateField[];
  draft_revision: number;
  created_at: Date;
  updated_at: Date;
}

export function toTemplate(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    draftFields: row.draft_fields,
    draftRevision: row.draft_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TemplateVersionRow {
  id: string;
  workspace_id: string;
  template_id: string;
  number: number;
  title: string;
  description: string;
  fields: TemplateField[];
  draft_revision: number;
  published_at: Date;
}

export function toTemplateVersion(row: TemplateVersionRow): TemplateVersionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateId: row.template_id,
    number: row.number,
    title: row.title,
    description: row.description,
    fields: row.fields,
    draftRevision: row.draft_revision,
    publishedAt: row.published_at,
  };
}

export interface RequestRow {
  id: string;
  workspace_id: string;
  template_version_id: string;
  title: string;
  message: string;
  expires_at: Date;
  completed_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  signer_count: number;
  signed_count: number;
}

export function toRequest(row: RequestRow): RequestRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateVersionId: row.template_version_id,
    title: row.title,
    message: row.message,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    signerCount: row.signer_count,
    signedCount: row.signed_count,
  };
}

export interface SignerRow {
  id: string;
  workspace_id: string;
  request_id: string;
  block_id: string;
  label: string;
  name: string;
  email: string;
  viewed_at: Date | null;
  signed_at: Date | null;
  signature: Signature | null;
  answers: Record<string, string>;
}

export function toSigner(row: SignerRow): SignerRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requestId: row.request_id,
    blockId: row.block_id,
    label: row.label,
    name: row.name,
    email: row.email,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
    signature: row.signature,
    answers: row.answers,
  };
}

/** The request columns plus the two signer counts every status needs. */
export const REQUEST_COLUMNS = /* sql */ `
  r.id, r.workspace_id, r.template_version_id, r.title, r.message, r.expires_at,
  r.completed_at, r.revoked_at, r.created_at,
  (select count(*)::int from signers s where s.request_id = r.id) as signer_count,
  (select count(*)::int from signers s
    where s.request_id = r.id and s.signed_at is not null) as signed_count
`;
