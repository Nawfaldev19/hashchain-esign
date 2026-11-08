import DataLoader from 'dataloader';
import { AppError } from '../domain/errors';
import { requireScope, resolveSession } from '../services/auth-service';
import { actorNamesFor } from '../services/export-service';
import type {
  Deps,
  Scope,
  SignerRecord,
  TemplateVersionRecord,
  UserRecord,
} from '../services/records';
import { signersByRequest } from '../services/request-service';
import { latestVersionsByTemplate, versionsById } from '../services/template-service';

export const SESSION_COOKIE = 'signoff_ledger_session';

/**
 * Loaders collect the ids asked for during one tick and fetch them with a single
 * query. A page of 20 requests therefore costs one query for all signers and one
 * for all versions, not 40. They live for one HTTP request and one workspace.
 */
export interface Loaders {
  latestVersion: DataLoader<string, TemplateVersionRecord | null>;
  version: DataLoader<string, TemplateVersionRecord | null>;
  signers: DataLoader<string, SignerRecord[]>;
  actorNames: DataLoader<string, Map<string, string>>;
}

function createLoaders(deps: Deps, scope: Scope): Loaders {
  return {
    latestVersion: new DataLoader(async (templateIds) => {
      const found = await latestVersionsByTemplate(deps, scope, templateIds);
      return templateIds.map((id) => found.get(id) ?? null);
    }),
    version: new DataLoader(async (versionIds) => {
      const found = await versionsById(deps, scope, versionIds);
      return versionIds.map((id) => found.get(id) ?? null);
    }),
    signers: new DataLoader(async (requestIds) => {
      const found = await signersByRequest(deps, scope, requestIds);
      return requestIds.map((id) => found.get(id) ?? []);
    }),
    actorNames: new DataLoader((requestIds) =>
      Promise.all(requestIds.map((id) => actorNamesFor(deps, scope, id))),
    ),
  };
}

export interface CookieWriter {
  set(name: string, value: string, expires: Date): void;
  clear(name: string): void;
}

export interface GraphQLContext {
  deps: Deps;
  user: UserRecord | null;
  sessionToken: string | null;
  /** Identifies the caller for rate limiting (the network address when known). */
  clientKey: string;
  cookies: CookieWriter;
  /** The signed-in user's membership of a workspace. Asked once per request. */
  scope(workspaceId: string): Promise<Scope>;
  loaders(scope: Scope): Loaders;
}

export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function buildContext(
  deps: Deps,
  request: { headers: { get(name: string): string | null } },
  clientKey: string,
  cookies: CookieWriter,
): Promise<GraphQLContext> {
  const sessionToken = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const user = sessionToken === null ? null : await resolveSession(deps, sessionToken);
  const scopes = new Map<string, Promise<Scope>>();
  const loaders = new Map<string, Loaders>();

  return {
    deps,
    user,
    sessionToken,
    clientKey,
    cookies,
    scope(workspaceId) {
      if (user === null) {
        return Promise.reject(new AppError('UNAUTHENTICATED', 'Sign in to continue.'));
      }
      let scope = scopes.get(workspaceId);
      if (!scope) {
        scope = requireScope(deps, user.id, workspaceId, 'viewer');
        scopes.set(workspaceId, scope);
      }
      return scope;
    },
    loaders(scope) {
      let existing = loaders.get(scope.workspaceId);
      if (!existing) {
        existing = createLoaders(deps, scope);
        loaders.set(scope.workspaceId, existing);
      }
      return existing;
    },
  };
}
