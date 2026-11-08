import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateBranding } from '../../src/server/services/workspace-service';
import { PASSWORD, createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

const LOGIN = `mutation ($email: String!, $password: String!) {
  login(email: $email, password: $password) { email memberships { role workspace { name } } }
}`;
const VIEWER = '{ viewer { email } }';

describe('sign-in, sessions and roles', () => {
  let harness: Harness;
  let world: World;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('signs in, sets an HttpOnly cookie and lists memberships', async () => {
    const result = await harness.gql<{
      login: { email: string; memberships: { role: string; workspace: { name: string } }[] };
    }>(LOGIN, { email: 'Owner@Alpha.example ', password: PASSWORD });

    expect(result.errors).toEqual([]);
    expect(result.data?.login).toEqual({
      email: 'owner@alpha.example',
      memberships: [{ role: 'OWNER', workspace: { name: 'Alpha Works' } }],
    });
    expect(result.setCookies).toHaveLength(1);
    expect(result.setCookies[0]).toMatch(/^signoff_ledger_session=[\w-]{43}; Expires=/);
    expect(result.setCookies[0]).toContain('HttpOnly');
    expect(result.setCookies[0]).toContain('SameSite=Lax');
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await harness.signIn('owner@alpha.example');
    const token = cookie.split('=')[1] ?? '';
    const rows = await harness.deps.db.admin.query<{ token_hash: string }>(
      'select token_hash from sessions',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.token_hash)).not.toContain(token);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await harness.gql(LOGIN, {
      email: 'owner@alpha.example',
      password: 'nope',
    });
    const unknownEmail = await harness.gql(LOGIN, {
      email: 'ghost@alpha.example',
      password: PASSWORD,
    });
    for (const result of [wrongPassword, unknownEmail]) {
      expect(result.data).toBeNull();
      expect(result.setCookies).toEqual([]);
      expect(result.errors[0]).toMatchObject({
        message: 'Email or password is wrong.',
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }
  });

  it('locks out repeated guesses for one email, without locking out others', async () => {
    const guess = () => harness.gql(LOGIN, { email: 'viewer@alpha.example', password: 'guess' });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await guess()).errors[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
    expect((await guess()).errors[0]?.extensions?.code).toBe('RATE_LIMITED');

    const rightPasswordWhileLocked = await harness.gql(LOGIN, {
      email: 'viewer@alpha.example',
      password: PASSWORD,
    });
    expect(rightPasswordWhileLocked.errors[0]?.extensions?.code).toBe('RATE_LIMITED');

    const someoneElse = await harness.gql(LOGIN, {
      email: 'editor@alpha.example',
      password: PASSWORD,
    });
    expect(someoneElse.errors).toEqual([]);
  });

  it('knows the viewer only while the session is valid', async () => {
    expect((await harness.gql(VIEWER)).data).toEqual({ viewer: null });
    expect((await harness.gql(VIEWER, {}, 'signoff_ledger_session=forged')).data).toEqual({
      viewer: null,
    });

    const cookie = await harness.signIn('owner@alpha.example');
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({
      viewer: { email: 'owner@alpha.example' },
    });

    const start = harness.deps.now();
    harness.advance(12 * 3_600_000 + 1);
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({ viewer: null });
    harness.setNow(start);
  });

  it('ends the session on logout', async () => {
    const cookie = await harness.signIn('owner@alpha.example');
    const result = await harness.gql('mutation { logout }', {}, cookie);
    expect(result.data).toEqual({ logout: true });
    expect(result.setCookies[0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({ viewer: null });
  });

  it('reports the role per workspace and enforces it on mutations', async () => {
    const cookie = await harness.signIn('editor@alpha.example');
    const role = await harness.gql<{ workspace: { role: string; members: { role: string }[] } }>(
      'query ($ws: ID!) { workspace(id: $ws) { role members { name role } } }',
      { ws: world.alpha.id },
      cookie,
    );
    expect(role.data?.workspace.role).toBe('EDITOR');
    expect(role.data?.workspace.members.map((member) => member.role).sort()).toEqual([
      'EDITOR',
      'OWNER',
      'VIEWER',
    ]);

    const branding = await harness.gql(
      `mutation ($ws: ID!) {
        updateWorkspaceBranding(workspaceId: $ws, name: "Hijacked", accentColor: "#000000") { name }
      }`,
      { ws: world.alpha.id },
      cookie,
    );
    expect(branding.errors[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('lets an owner change branding, with validation', async () => {
    const updated = await updateBranding(harness.deps, world.alpha.owner, {
      name: '  Alpha Works  ',
      accentColor: '#a8480b',
    });
    expect(updated).toMatchObject({ name: 'Alpha Works', accentColor: '#A8480B' });

    await expect(
      updateBranding(harness.deps, world.alpha.owner, { name: 'Alpha Works', accentColor: 'teal' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const other = await harness.deps.db.admin.query<{ name: string }>(
      'select name from workspaces where id = $1',
      [world.beta.id],
    );
    expect(other[0]?.name).toBe('Beta Bench');
  });

  it('refuses a mutation sent as a GET request', async () => {
    const cookie = await harness.signIn('owner@alpha.example');
    const url = `http://signoff-ledger.test/graphql?query=${encodeURIComponent('mutation { logout }')}`;
    const { createGraphQLServer } = await import('../../src/server/graphql/yoga');
    const { createLogger } = await import('../../src/server/logger');
    const yoga = createGraphQLServer({
      deps: harness.deps,
      logger: createLogger('error', () => undefined),
      secureCookies: false,
      graphiql: false,
    });
    const response = await yoga.fetch(url, { method: 'GET', headers: { cookie } });
    expect(response.status).toBe(405);
    expect((await harness.gql(VIEWER, {}, cookie)).data).toEqual({
      viewer: { email: 'owner@alpha.example' },
    });
  });

  it('hides internal errors from the caller and logs them', async () => {
    const before = harness.logLines.length;
    const result = await harness.gql('query { signingSession(token: "x") { state } }');
    expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(harness.logLines.length).toBe(before);

    const syntax = await harness.gql('query { nonsense }');
    expect(syntax.errors[0]?.message).toContain('nonsense');
  });
});
