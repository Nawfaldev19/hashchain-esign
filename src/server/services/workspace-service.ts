import { notFound } from '../domain/errors';
import { assertRole } from './auth-service';
import type { Deps, MemberRecord, Role, Scope, WorkspaceRecord } from './records';
import { brandingSchema, parseInput } from './validation';

interface WorkspaceRow {
  id: string;
  name: string;
  accent_color: string;
}

const toWorkspace = (row: WorkspaceRow): WorkspaceRecord => ({
  id: row.id,
  name: row.name,
  accentColor: row.accent_color.toUpperCase(),
});

export async function getWorkspace(deps: Deps, scope: Scope): Promise<WorkspaceRecord> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<WorkspaceRow>('select id, name, accent_color from workspaces'),
  );
  const row = rows[0];
  if (!row) throw notFound('Workspace');
  return toWorkspace(row);
}

export async function updateBranding(
  deps: Deps,
  scope: Scope,
  input: { name: string; accentColor: string },
): Promise<WorkspaceRecord> {
  assertRole(scope, 'owner');
  const branding = parseInput(brandingSchema, input);
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<WorkspaceRow>(
      'update workspaces set name = $1, accent_color = $2 returning id, name, accent_color',
      [branding.name, branding.accentColor],
    ),
  );
  const row = rows[0];
  if (!row) throw notFound('Workspace');
  return toWorkspace(row);
}

export async function listMembers(deps: Deps, scope: Scope): Promise<MemberRecord[]> {
  const rows = await deps.db.tenant(scope.workspaceId, (q) =>
    q.query<{ id: string; email: string; name: string; role: Role }>(
      `select u.id, u.email, u.name, m.role
         from memberships m join users u on u.id = m.user_id
        order by u.name`,
    ),
  );
  return rows.map((row) => ({
    user: { id: row.id, email: row.email, name: row.name },
    role: row.role,
  }));
}
