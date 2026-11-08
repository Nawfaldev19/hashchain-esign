import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeps } from '../../src/server/app';
import { DEMO_PASSWORD, DEMO_USERS, isEmpty, seedDemoData } from '../../src/server/db/seed';
import { normalizePageRequest } from '../../src/server/domain/pagination';
import { listMemberships, login } from '../../src/server/services/auth-service';
import type { Deps, Scope } from '../../src/server/services/records';
import { listRequests, statusOf, verifyHistory } from '../../src/server/services/request-service';
import { listTemplates } from '../../src/server/services/template-service';

describe('demo data', () => {
  let deps: Deps;
  let fernhill: Scope;

  beforeAll(async () => {
    deps = await createDeps({
      dataDir: 'memory',
      publicUrl: 'http://localhost:4000',
      sessionTtlHours: 12,
    });
    expect(await isEmpty(deps)).toBe(true);
    await seedDemoData(deps);

    const { user } = await login(
      deps,
      { email: DEMO_USERS.owner.email, password: DEMO_PASSWORD },
      'test',
    );
    const memberships = await listMemberships(deps, user.id);
    const membership = memberships.find((item) => item.workspace.name === 'Fernhill Makerspace');
    if (!membership) throw new Error('The demo owner has no Fernhill membership.');
    fernhill = { workspaceId: membership.workspace.id, userId: user.id, role: membership.role };
  });

  afterAll(async () => {
    await deps.db.close();
  });

  it('is no longer empty, so a restart does not seed twice', async () => {
    expect(await isEmpty(deps)).toBe(false);
  });

  it('gives the demo owner two workspaces with different roles', async () => {
    const memberships = await listMemberships(deps, fernhill.userId);
    expect(memberships.map((item) => [item.workspace.name, item.role])).toEqual([
      ['Fernhill Makerspace', 'owner'],
      ['Tinker Harbor Workshop', 'viewer'],
    ]);
  });

  it('shows one request in every status', async () => {
    const page = await listRequests(deps, fernhill, normalizePageRequest(50, null), null);
    const statuses = page.items.map((request) => statusOf(request, deps.now())).sort();
    expect(statuses).toEqual(['AWAITING', 'COMPLETED', 'EXPIRED', 'PARTLY_SIGNED', 'REVOKED']);
  });

  it('has an intact history for every seeded request', async () => {
    const page = await listRequests(deps, fernhill, normalizePageRequest(50, null), null);
    for (const request of page.items) {
      expect(await verifyHistory(deps, fernhill, request.id)).toMatchObject({ intact: true });
    }
  });

  it('includes published, changed and unpublished templates', async () => {
    const page = await listTemplates(deps, fernhill, normalizePageRequest(50, null));
    expect(page.items.map((template) => template.title).sort()).toEqual([
      'Studio day hire',
      'Tool loan form',
      'Wood shop safety agreement',
    ]);
  });

  it('uses only reserved example addresses', async () => {
    const users = await deps.db.admin.query<{ email: string }>('select email from users');
    const signers = await deps.db.admin.query<{ email: string }>('select email from signers');
    for (const { email } of [...users, ...signers]) {
      expect(email).toMatch(/@example\.com$/);
    }
  });
});
