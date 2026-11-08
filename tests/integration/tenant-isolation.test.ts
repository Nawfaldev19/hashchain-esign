import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequest } from '../../src/server/services/request-service';
import { publishedVersion, twoPartyRequest } from '../helpers/builders';
import type { OpenRequest } from '../helpers/builders';
import { createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

/**
 * The central promise of a multi-tenant system: one workspace can never read or
 * change another workspace's data. These tests attack that promise from three
 * directions: raw SQL in the tenant role, the service layer, and the public API
 * with ids that belong to somebody else.
 */
describe('tenant isolation', () => {
  let harness: Harness;
  let world: World;
  let alphaRequest: OpenRequest;
  let betaRequest: OpenRequest;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    alphaRequest = await twoPartyRequest(harness.deps, world.alpha.owner, 'Alpha sign-off');
    betaRequest = await twoPartyRequest(harness.deps, world.beta.owner, 'Beta sign-off');
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('in the database (row-level security)', () => {
    const tenantTables = [
      'templates',
      'template_versions',
      'signing_requests',
      'signers',
      'request_events',
    ];

    it.each(tenantTables)('shows only the current workspace in %s', async (table) => {
      const rows = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query<{ workspace_id: string }>(`select workspace_id from ${table}`),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.workspace_id))).toEqual(new Set([world.alpha.id]));
    });

    it('has row-level security on every table that carries a workspace id', async () => {
      const tables = await harness.deps.db.admin.query<{
        name: string;
        enabled: boolean;
        forced: boolean;
      }>(
        `select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
           from pg_class c
           join pg_attribute a on a.attrelid = c.oid
          where a.attname = 'workspace_id' and not a.attisdropped
            and c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
          order by c.relname`,
      );
      // A new tenant table must be added to the list above, which makes its
      // author write the isolation checks for it.
      expect(tables.map((table) => table.name)).toEqual([...tenantTables, 'memberships'].sort());
      for (const table of tables) {
        expect(table.enabled, `${table.name} has row-level security enabled`).toBe(true);
        if (table.name !== 'memberships') {
          expect(table.forced, `${table.name} forces it for the owner too`).toBe(true);
        }
      }
    });

    it('shows nothing when the workspace does not exist (fails closed)', async () => {
      const rows = await harness.deps.db.tenant('00000000-0000-4000-8000-000000000000', (q) =>
        q.query('select id from templates'),
      );
      expect(rows).toEqual([]);
    });

    it('refuses to insert a row that names another workspace', async () => {
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) =>
          q.query('insert into templates (workspace_id, title, created_by) values ($1, $2, $3)', [
            world.beta.id,
            'Smuggled',
            world.alpha.owner.userId,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('cannot update or delete another workspace by id', async () => {
      const updated = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query('update signing_requests set title = $1 where id = $2 returning id', [
          'Defaced',
          betaRequest.request.id,
        ]),
      );
      expect(updated).toEqual([]);

      const untouched = await harness.deps.db.admin.query<{ title: string }>(
        'select title from signing_requests where id = $1',
        [betaRequest.request.id],
      );
      expect(untouched[0]?.title).toBe('Beta sign-off');
    });

    it('cannot move its own row into another workspace', async () => {
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) =>
          q.query('update signing_requests set workspace_id = $1 where id = $2', [
            world.beta.id,
            alphaRequest.request.id,
          ]),
        ),
      ).rejects.toThrow();
    });

    it('sees only fellow members, and never a password hash', async () => {
      const users = await harness.deps.db.tenant(world.alpha.id, (q) =>
        q.query<{ email: string }>('select email from users order by email'),
      );
      expect(users.map((user) => user.email)).toEqual([
        'editor@alpha.example',
        'owner@alpha.example',
        'viewer@alpha.example',
      ]);

      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) => q.query('select password_hash from users')),
      ).rejects.toThrow(/permission denied/);
    });

    it('keeps sessions away from the tenant role and tenant data away from the directory role', async () => {
      await expect(
        harness.deps.db.tenant(world.alpha.id, (q) => q.query('select * from sessions')),
      ).rejects.toThrow(/permission denied/);
      await expect(
        harness.deps.db.directory((q) => q.query('select * from templates')),
      ).rejects.toThrow(/permission denied/);
      await expect(
        harness.deps.db.directory((q) => q.query('select * from signers')),
      ).rejects.toThrow(/permission denied/);
    });

    it('rejects a child row whose parent is in another workspace, even for the owner', async () => {
      await expect(
        harness.deps.db.admin.query(
          `insert into signers (workspace_id, request_id, block_id, label, name, email, token_hash)
           values ($1, $2, 'x', 'X', 'Mallory', 'mallory@example.com', 'hash')`,
          [world.alpha.id, betaRequest.request.id],
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it('rejects a non-UUID workspace id before any SQL runs', async () => {
      await expect(
        harness.deps.db.tenant("x'; drop table users; --", (q) => q.query('select 1')),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('in the service layer', () => {
    it("cannot create a request from another workspace's template version", async () => {
      const betaVersion = await publishedVersion(harness.deps, world.beta.owner);
      await expect(
        createRequest(harness.deps, world.alpha.owner, {
          templateVersionId: betaVersion.id,
          title: 'Borrowed',
          message: '',
          expiresInDays: 7,
          signers: [
            { blockId: 'sig_member', name: 'A', email: 'a@example.com' },
            { blockId: 'sig_steward', name: 'B', email: 'b@example.com' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('through the API', () => {
    let alphaCookie: string;

    beforeAll(async () => {
      alphaCookie = await harness.signIn('owner@alpha.example');
    });

    it('answers NOT_FOUND for a workspace the user is not a member of', async () => {
      const result = await harness.gql(
        'query ($id: ID!) { workspace(id: $id) { name } }',
        { id: world.beta.id },
        alphaCookie,
      );
      expect(result.data).toBeNull();
      expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
    });

    it("answers NOT_FOUND for another workspace's request asked through the user's own workspace", async () => {
      const result = await harness.gql(
        'query ($ws: ID!, $id: ID!) { workspace(id: $ws) { request(id: $id) { title } } }',
        { ws: world.alpha.id, id: betaRequest.request.id },
        alphaCookie,
      );
      expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(result)).not.toContain('Beta sign-off');
    });

    it('lists only the workspace own requests and templates', async () => {
      const result = await harness.gql<{
        workspace: { requests: { items: { title: string }[] }; templates: { items: unknown[] } };
      }>(
        `query ($ws: ID!) {
          workspace(id: $ws) { requests { items { title } } templates { items { id } } }
        }`,
        { ws: world.alpha.id },
        alphaCookie,
      );
      expect(result.errors).toEqual([]);
      expect(result.data?.workspace.requests.items.map((item) => item.title)).toEqual([
        'Alpha sign-off',
      ]);
      expect(result.data?.workspace.templates.items).toHaveLength(1);
    });

    it.each([
      [
        'revokeSigningRequest',
        'mutation ($ws: ID!, $id: ID!) { revokeSigningRequest(workspaceId: $ws, requestId: $id) { id } }',
        () => ({ ws: world.alpha.id, id: betaRequest.request.id }),
      ],
      [
        'reissueSignerLink',
        'mutation ($ws: ID!, $id: ID!) { reissueSignerLink(workspaceId: $ws, signerId: $id) { url } }',
        () => ({ ws: world.alpha.id, id: betaRequest.links[0]?.signerId }),
      ],
      [
        'publishTemplate',
        'mutation ($ws: ID!, $id: ID!) { publishTemplate(workspaceId: $ws, templateId: $id) { id } }',
        () => ({ ws: world.alpha.id, id: betaRequest.request.templateVersionId }),
      ],
      [
        'revokeSigningRequest in the other workspace',
        'mutation ($ws: ID!, $id: ID!) { revokeSigningRequest(workspaceId: $ws, requestId: $id) { id } }',
        () => ({ ws: world.beta.id, id: betaRequest.request.id }),
      ],
    ])('refuses %s aimed at another workspace', async (_name, mutation, variables) => {
      const result = await harness.gql(mutation, variables(), alphaCookie);
      expect(result.data).toBeNull();
      expect(result.errors[0]?.extensions?.code).toBe('NOT_FOUND');
    });

    it("leaves the other workspace's request untouched after all of the above", async () => {
      const rows = await harness.deps.db.admin.query<{ revoked_at: Date | null }>(
        'select revoked_at from signing_requests where id = $1',
        [betaRequest.request.id],
      );
      expect(rows[0]?.revoked_at).toBeNull();
    });

    it('requires a sign-in for workspace data', async () => {
      const result = await harness.gql('query ($id: ID!) { workspace(id: $id) { name } }', {
        id: world.alpha.id,
      });
      expect(result.errors[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    });
  });
});
