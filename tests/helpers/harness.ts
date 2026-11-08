import { createDeps } from '../../src/server/app';
import { hashPassword } from '../../src/server/domain/secrets';
import { createGraphQLServer } from '../../src/server/graphql/yoga';
import { createLogger } from '../../src/server/logger';
import type { Deps, Role, Scope } from '../../src/server/services/records';
import { firstRow } from '../../src/server/services/template-service';

/** Shared setup for integration tests: a real database, a clock we control, and the API. */

export const PASSWORD = 'correct horse battery staple';

export interface GraphQLResult<Data> {
  data: Data | null;
  errors: { message: string; extensions?: { code?: string; issues?: { message: string }[] } }[];
  setCookies: string[];
}

export interface Harness {
  deps: Deps;
  /** Moves the clock the services see. */
  setNow(date: Date): void;
  advance(ms: number): void;
  logLines: string[];
  gql<Data = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    cookie?: string,
  ): Promise<GraphQLResult<Data>>;
  /** Signs in and returns the cookie header to send with later calls. */
  signIn(email: string): Promise<string>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  let now = new Date('2025-06-02T09:00:00.000Z');
  const deps = await createDeps({
    dataDir: 'memory',
    publicUrl: 'http://signoff-ledger.test',
    sessionTtlHours: 12,
    now: () => now,
  });
  const logLines: string[] = [];
  const yoga = createGraphQLServer({
    deps,
    logger: createLogger('debug', (line) => logLines.push(line)),
    secureCookies: false,
    graphiql: false,
  });

  async function gql<Data>(
    query: string,
    variables: Record<string, unknown> = {},
    cookie?: string,
  ): Promise<GraphQLResult<Data>> {
    const response = await yoga.fetch('http://signoff-ledger.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as {
      data?: Data | null;
      errors?: GraphQLResult<Data>['errors'];
    };
    return {
      data: body.data ?? null,
      errors: body.errors ?? [],
      setCookies: response.headers.getSetCookie(),
    };
  }

  return {
    deps,
    logLines,
    setNow(date) {
      now = date;
    },
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    gql,
    async signIn(email) {
      const result = await gql(
        'mutation ($email: String!, $password: String!) { login(email: $email, password: $password) { id } }',
        { email, password: PASSWORD },
      );
      const cookie = result.setCookies[0]?.split(';')[0];
      if (!cookie) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(result.errors)}`);
      return cookie;
    },
    async close() {
      await deps.db.close();
    },
  };
}

export interface World {
  alpha: { id: string; owner: Scope; editor: Scope; viewer: Scope };
  beta: { id: string; owner: Scope };
}

/**
 * Two workspaces with separate people:
 *   alpha: owner@alpha.example, editor@alpha.example, viewer@alpha.example
 *   beta:  owner@beta.example
 */
export async function seedWorld(deps: Deps): Promise<World> {
  const admin = deps.db.admin;
  const passwordHash = await hashPassword(PASSWORD, 1024);
  const user = async (email: string): Promise<string> =>
    firstRow(
      await admin.query<{ id: string }>(
        'insert into users (email, name, password_hash) values ($1, $2, $3) returning id',
        [email, email.split('@')[0] ?? email, passwordHash],
      ),
    ).id;
  const workspace = async (name: string): Promise<string> =>
    firstRow(
      await admin.query<{ id: string }>('insert into workspaces (name) values ($1) returning id', [
        name,
      ]),
    ).id;
  const member = async (workspaceId: string, userId: string, role: Role): Promise<Scope> => {
    await admin.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      userId,
      role,
    ]);
    return { workspaceId, userId, role };
  };

  const alpha = await workspace('Alpha Works');
  const beta = await workspace('Beta Bench');
  return {
    alpha: {
      id: alpha,
      owner: await member(alpha, await user('owner@alpha.example'), 'owner'),
      editor: await member(alpha, await user('editor@alpha.example'), 'editor'),
      viewer: await member(alpha, await user('viewer@alpha.example'), 'viewer'),
    },
    beta: { id: beta, owner: await member(beta, await user('owner@beta.example'), 'owner') },
  };
}
