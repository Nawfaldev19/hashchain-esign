import { validateForPublishing } from '../../shared/fields';
import type { TemplateField } from '../../shared/fields';
import { conflict, invalid, notFound } from '../domain/errors';
import { decodeCursor, isUuid, toPage } from '../domain/pagination';
import type { Page, PageRequest } from '../domain/pagination';
import { assertRole } from './auth-service';
import type {
  Deps,
  Scope,
  TemplateRecord,
  TemplateRow,
  TemplateVersionRecord,
  TemplateVersionRow,
} from './records';
import { toTemplate, toTemplateVersion } from './records';
import { draftSchema, newTemplateSchema, parseInput } from './validation';

const TEMPLATE_COLUMNS =
  'id, workspace_id, title, description, draft_fields, draft_revision, created_at, updated_at';
const VERSION_COLUMNS =
  'id, workspace_id, template_id, number, title, description, fields, draft_revision, published_at';

export async function listTemplates(
  deps: Deps,
  scope: Scope,
  page: PageRequest,
): Promise<Page<TemplateRecord>> {
  const after = page.after === null ? null : decodeCursor(page.after);
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateRow>(
      `select ${TEMPLATE_COLUMNS} from templates
        where ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::uuid))
        order by created_at desc, id desc
        limit $3`,
      [after?.createdAt ?? null, after?.id ?? null, page.first + 1],
    ),
  );
  return toPage(rows.map(toTemplate), page.first);
}

export async function getTemplate(deps: Deps, scope: Scope, id: string): Promise<TemplateRecord> {
  if (!isUuid(id)) throw notFound('Template');
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateRow>(`select ${TEMPLATE_COLUMNS} from templates where id = $1`, [id]),
  );
  const row = rows[0];
  if (!row) throw notFound('Template');
  return toTemplate(row);
}

export async function createTemplate(
  deps: Deps,
  scope: Scope,
  input: { title: string; description: string },
): Promise<TemplateRecord> {
  assertRole(scope, 'editor');
  const template = parseInput(newTemplateSchema, input);
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateRow>(
      `insert into templates (workspace_id, title, description, created_by)
       values ($1, $2, $3, $4)
       returning ${TEMPLATE_COLUMNS}`,
      [scope.workspaceId, template.title, template.description, scope.userId],
    ),
  );
  return toTemplate(firstRow(rows));
}

/**
 * Saves the draft. The caller sends the revision it started from; if someone
 * else saved in the meantime the revision no longer matches and the save is
 * refused instead of silently overwriting their work (optimistic locking).
 */
export async function saveDraft(
  deps: Deps,
  scope: Scope,
  templateId: string,
  input: { title: string; description: string; fields: TemplateField[]; expectedRevision: number },
): Promise<TemplateRecord> {
  assertRole(scope, 'editor');
  if (!isUuid(templateId)) throw notFound('Template');
  const draft = parseInput(draftSchema, input);
  const ids = draft.fields.map((field) => field.id);
  if (new Set(ids).size !== ids.length) {
    throw invalid('Two fields share the same id.');
  }

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const updated = await q.query<TemplateRow>(
      `update templates
          set title = $1, description = $2, draft_fields = $3::jsonb,
              draft_revision = draft_revision + 1, updated_at = now_ms()
        where id = $4 and draft_revision = $5
        returning ${TEMPLATE_COLUMNS}`,
      [
        draft.title,
        draft.description,
        JSON.stringify(draft.fields),
        templateId,
        draft.expectedRevision,
      ],
    );
    const row = updated[0];
    if (row) return toTemplate(row);

    const exists = await q.query('select 1 from templates where id = $1', [templateId]);
    if (exists.length === 0) throw notFound('Template');
    throw conflict('Someone else changed this draft. Reload to see their version.');
  });
}

/**
 * Freezes the current draft as the next numbered version. Requests always point
 * at a version, never at the draft, so later edits cannot change what somebody
 * was asked to sign.
 */
export async function publishTemplate(
  deps: Deps,
  scope: Scope,
  templateId: string,
): Promise<TemplateVersionRecord> {
  assertRole(scope, 'editor');
  if (!isUuid(templateId)) throw notFound('Template');

  return deps.db.tenant(scope.workspaceId, async (q) => {
    const templates = await q.query<TemplateRow>(
      `select ${TEMPLATE_COLUMNS} from templates where id = $1 for update`,
      [templateId],
    );
    const template = templates[0];
    if (!template) throw notFound('Template');

    const issues = validateForPublishing(template.draft_fields);
    if (issues.length > 0) {
      throw invalid('The draft is not ready to publish.', issues);
    }

    const latest = await q.query<{ number: number; draft_revision: number }>(
      `select number, draft_revision from template_versions
        where template_id = $1 order by number desc limit 1`,
      [templateId],
    );
    if (latest[0]?.draft_revision === template.draft_revision) {
      throw conflict('Nothing has changed since the last published version.');
    }

    const inserted = await q.query<TemplateVersionRow>(
      `insert into template_versions
         (workspace_id, template_id, number, title, description, fields, draft_revision, published_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning ${VERSION_COLUMNS}`,
      [
        scope.workspaceId,
        templateId,
        (latest[0]?.number ?? 0) + 1,
        template.title,
        template.description,
        JSON.stringify(template.draft_fields),
        template.draft_revision,
        scope.userId,
      ],
    );
    return toTemplateVersion(firstRow(inserted));
  });
}

export async function listVersions(
  deps: Deps,
  scope: Scope,
  templateId: string,
): Promise<TemplateVersionRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateVersionRow>(
      `select ${VERSION_COLUMNS} from template_versions
        where template_id = $1 order by number desc`,
      [templateId],
    ),
  );
  return rows.map(toTemplateVersion);
}

/** Batched lookup for the list page: one query for any number of templates. */
export async function latestVersionsByTemplate(
  deps: Deps,
  scope: Scope,
  templateIds: readonly string[],
): Promise<Map<string, TemplateVersionRecord>> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateVersionRow>(
      `select distinct on (template_id) ${VERSION_COLUMNS}
         from template_versions
        where template_id = any($1::uuid[])
        order by template_id, number desc`,
      [templateIds],
    ),
  );
  return new Map(rows.map((row) => [row.template_id, toTemplateVersion(row)]));
}

export async function versionsById(
  deps: Deps,
  scope: Scope,
  versionIds: readonly string[],
): Promise<Map<string, TemplateVersionRecord>> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<TemplateVersionRow>(
      `select ${VERSION_COLUMNS} from template_versions where id = any($1::uuid[])`,
      [versionIds],
    ),
  );
  return new Map(rows.map((row) => [row.id, toTemplateVersion(row)]));
}

export function firstRow<Row>(rows: Row[]): Row {
  const row = rows[0];
  if (row === undefined) throw new Error('Expected the statement to return a row.');
  return row;
}
