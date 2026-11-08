import { AppError, forbidden, notFound } from '../domain/errors';
import { isUuid } from '../domain/pagination';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../domain/secrets';
import type { Deps, Role, Scope, UserRecord, WorkspaceRecord } from './records';
import { roleAtLeast } from './records';
import { loginSchema, parseInput } from './validation';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

let decoyHash: Promise<string> | null = null;

/**
 * A hash to verify against when the email is unknown, so that "no such user"
 * takes as long as "wrong password" and the two cannot be told apart by timing.
 */
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword(generateToken());
  return decoyHash;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: UserRecord;
}

export async function login(
  deps: Deps,
  input: { email: string; password: string },
  clientKey: string,
): Promise<LoginResult> {
  const { email, password } = parseInput(loginSchema, input);
  const limiterKey = `${clientKey}|${email}`;
  if (!deps.loginLimiter.hit(limiterKey)) {
    throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.');
  }

  const rows = await deps.db.directory((q) =>
    q.query<UserRow>('select id, email, name, password_hash from users where email = $1', [email]),
  );
  const user = rows[0];
  const passwordMatches = await verifyPassword(
    password,
    user?.password_hash ?? (await getDecoyHash()),
  );
  if (!user || !passwordMatches) {
    throw new AppError('UNAUTHENTICATED', 'Email or password is wrong.');
  }

  const token = generateToken();
  const expiresAt = new Date(deps.now().getTime() + deps.sessionTtlHours * 3_600_000);
  await deps.db.directory((q) =>
    q.query('insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)', [
      user.id,
      hashToken(token),
      expiresAt,
    ]),
  );
  deps.loginLimiter.reset(limiterKey);
  return { token, expiresAt, user: { id: user.id, email: user.email, name: user.name } };
}

export async function resolveSession(deps: Deps, token: string): Promise<UserRecord | null> {
  const rows = await deps.db.directory((q) =>
    q.query<UserRecord>(
      `select u.id, u.email, u.name
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > $2`,
      [hashToken(token), deps.now()],
    ),
  );
  return rows[0] ?? null;
}

export async function logout(deps: Deps, token: string): Promise<void> {
  await deps.db.directory((q) =>
    q.query('delete from sessions where token_hash = $1', [hashToken(token)]),
  );
}

export interface MembershipView {
  role: Role;
  workspace: WorkspaceRecord;
}

export async function listMemberships(deps: Deps, userId: string): Promise<MembershipView[]> {
  const rows = await deps.db.directory((q) =>
    q.query<{ role: Role; id: string; name: string; accent_color: string }>(
      `select m.role, w.id, w.name, w.accent_color
         from memberships m join workspaces w on w.id = m.workspace_id
        where m.user_id = $1
        order by w.name`,
      [userId],
    ),
  );
  return rows.map((row) => ({
    role: row.role,
    workspace: { id: row.id, name: row.name, accentColor: row.accent_color },
  }));
}

/**
 * Turns "this user wants to act in this workspace" into a Scope, or refuses.
 * A non-member gets NOT_FOUND, the same answer as for a workspace that does not
 * exist, so workspace ids cannot be probed.
 */
export async function requireScope(
  deps: Deps,
  userId: string,
  workspaceId: string,
  minimum: Role,
): Promise<Scope> {
  if (!isUuid(workspaceId)) throw notFound('Workspace');
  const rows = await deps.db.directory((q) =>
    q.query<{ role: Role }>(
      'select role from memberships where workspace_id = $1 and user_id = $2',
      [workspaceId, userId],
    ),
  );
  const membership = rows[0];
  if (!membership) throw notFound('Workspace');
  if (!roleAtLeast(membership.role, minimum)) throw forbidden();
  return { workspaceId, userId, role: membership.role };
}

/** Checks a role on a Scope that was already established for this request. */
export function assertRole(scope: Scope, minimum: Role): void {
  if (!roleAtLeast(scope.role, minimum)) throw forbidden();
}
