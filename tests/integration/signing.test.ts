import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizePageRequest } from '../../src/server/domain/pagination';
import { createRateLimiter } from '../../src/server/domain/rate-limit';
import {
  createRequest,
  getRequest,
  listEvents,
  listRequests,
  reissueLink,
  revokeRequest,
  signersByRequest,
  statusOf,
  verifyHistory,
} from '../../src/server/services/request-service';
import {
  openSigningSession,
  recordView,
  submitSignature,
} from '../../src/server/services/signing-service';
import {
  memberAnswers,
  publishedVersion,
  stewardAnswers,
  twoPartyRequest,
} from '../helpers/builders';
import { drawn, tokenOf } from '../helpers/fixtures';
import { createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

const DAY = 86_400_000;

describe('signing requests', () => {
  let harness: Harness;
  let world: World;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
  });

  afterAll(async () => {
    await harness.close();
  });

  const open = (title?: string) => twoPartyRequest(harness.deps, world.alpha.editor, title);
  const signAsMember = (token: string) =>
    submitSignature(harness.deps, token, { answers: memberAnswers, signature: drawn }, 'test');
  const signAsSteward = (token: string) =>
    submitSignature(
      harness.deps,
      token,
      { answers: stewardAnswers, signature: { kind: 'typed', text: '  Sol Steward ' } },
      'test',
    );
  const currentStatus = async (requestId: string) =>
    statusOf(await getRequest(harness.deps, world.alpha.viewer, requestId), harness.deps.now());

  describe('creating', () => {
    it('makes one link per signature block and stores only token hashes', async () => {
      const created = await open();
      expect(created.links).toHaveLength(2);
      expect(created.links.map((link) => link.label).sort()).toEqual(['Member', 'Steward']);
      for (const link of created.links) {
        expect(link.url).toMatch(/^http:\/\/signoff-ledger\.test\/sign\/[\w-]{43}$/);
      }

      const stored = await harness.deps.db.admin.query<{ token_hash: string }>(
        'select token_hash from signers where request_id = $1',
        [created.request.id],
      );
      const hashes = stored.map((row) => row.token_hash);
      expect(hashes).not.toContain(created.memberToken);
      expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    });

    it('requires exactly one signer per signature block', async () => {
      const version = await publishedVersion(harness.deps, world.alpha.editor);
      const attempt = (signers: { blockId: string; name: string; email: string }[]) =>
        createRequest(harness.deps, world.alpha.editor, {
          templateVersionId: version.id,
          title: 'Sign-off',
          message: '',
          expiresInDays: 7,
          signers,
        });
      const member = { blockId: 'sig_member', name: 'Ada', email: 'ada@example.com' };
      const steward = { blockId: 'sig_steward', name: 'Sol', email: 'sol@example.com' };

      await expect(attempt([member])).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(attempt([member, member])).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        attempt([member, steward, { ...steward, blockId: 'ghost' }]),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(attempt([member, { ...steward, email: 'not-an-email' }])).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });

    it('is not allowed for viewers', async () => {
      const version = await publishedVersion(harness.deps, world.alpha.editor);
      await expect(
        createRequest(harness.deps, world.alpha.viewer, {
          templateVersionId: version.id,
          title: 'Sign-off',
          message: '',
          expiresInDays: 7,
          signers: [],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('the public signing page', () => {
    it('shows the document, the parties and nothing about tokens', async () => {
      const created = await open('Visible request');
      const session = await openSigningSession(harness.deps, created.memberToken, 'test');
      expect(session).toMatchObject({
        state: 'OPEN',
        workspaceName: 'Alpha Works',
        requestTitle: 'Visible request',
        versionNumber: 1,
        yourBlockId: 'sig_member',
        answers: {},
      });
      expect(session.fields).toHaveLength(8);
      expect(session.parties.map((party) => [party.label, party.isYou])).toEqual([
        ['Member', true],
        ['Steward', false],
      ]);
    });

    it('answers NOT_FOUND for an unknown token', async () => {
      await expect(
        openSigningSession(harness.deps, 'not-a-real-token', 'test'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('records the first view once', async () => {
      const created = await open();
      expect(await recordView(harness.deps, created.memberToken, 'test')).toBe(true);
      expect(await recordView(harness.deps, created.memberToken, 'test')).toBe(false);
      const events = await listEvents(harness.deps, world.alpha.viewer, created.request.id);
      expect(events.map((event) => event.kind)).toEqual(['created', 'viewed']);
    });

    it('limits how fast tokens can be tried', async () => {
      const strict = {
        ...harness.deps,
        tokenLimiter: createRateLimiter({ limit: 3, windowMs: 60_000 }),
      };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          openSigningSession(strict, `guess-${attempt}`, 'attacker'),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      await expect(openSigningSession(strict, 'guess-4', 'attacker')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });
  });

  describe('signing', () => {
    it('moves from awaiting to partly signed to completed', async () => {
      const created = await open();
      expect(await currentStatus(created.request.id)).toBe('AWAITING');

      expect(await signAsMember(created.memberToken)).toBe('SIGNED');
      expect(await currentStatus(created.request.id)).toBe('PARTLY_SIGNED');

      expect(await signAsSteward(created.stewardToken)).toBe('COMPLETED');
      expect(await currentStatus(created.request.id)).toBe('COMPLETED');

      const request = await getRequest(harness.deps, world.alpha.viewer, created.request.id);
      expect(request).toMatchObject({ signerCount: 2, signedCount: 2 });
      expect(request.completedAt).toEqual(harness.deps.now());
    });

    it('stores trimmed answers and the signature for the right signer only', async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      await signAsSteward(created.stewardToken);

      const signers =
        (await signersByRequest(harness.deps, world.alpha.viewer, [created.request.id])).get(
          created.request.id,
        ) ?? [];
      const member = signers.find((signer) => signer.label === 'Member');
      const steward = signers.find((signer) => signer.label === 'Steward');
      expect(member?.answers).toEqual({ agree: 'true', phone: '555 0100', level: 'Skilled' });
      expect(member?.signature).toEqual(drawn);
      expect(steward?.answers).toEqual({ day: '2025-06-01' });
      expect(steward?.signature).toEqual({ kind: 'typed', text: 'Sol Steward' });
    });

    it("shows earlier signers' answers to later signers", async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      const session = await openSigningSession(harness.deps, created.stewardToken, 'test');
      expect(session.answers).toEqual({ agree: 'true', phone: '555 0100', level: 'Skilled' });
      expect(session.parties.find((party) => party.label === 'Member')?.signedAt).not.toBeNull();
    });

    it('explains every problem with the answers at once', async () => {
      const created = await open();
      await expect(
        submitSignature(
          harness.deps,
          created.memberToken,
          {
            answers: [
              { fieldId: 'agree', value: 'false' },
              { fieldId: 'level', value: 'Wizard' },
            ],
            signature: { kind: 'drawn', strokes: [] },
          },
          'test',
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        issues: [
          { fieldId: 'agree', message: 'You need to tick this box to continue.' },
          { fieldId: 'phone', message: 'This field is required.' },
          { fieldId: 'level', message: 'Pick one of the listed options.' },
          { fieldId: 'sig_member', message: 'Draw your signature to sign.' },
        ],
      });
      expect(await currentStatus(created.request.id)).toBe('AWAITING');
    });

    it("refuses answers to another signer's fields", async () => {
      const created = await open();
      await expect(
        submitSignature(
          harness.deps,
          created.memberToken,
          {
            answers: [...memberAnswers, { fieldId: 'day', value: '2025-06-01' }],
            signature: drawn,
          },
          'test',
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        issues: [{ fieldId: 'day', message: 'This field is not yours to fill in.' }],
      });
    });

    it('accepts a signature only once', async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      await expect(signAsMember(created.memberToken)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'You have already signed this document.',
      });
    });

    it('lets exactly one of two simultaneous submissions win', async () => {
      const created = await open();
      const results = await Promise.allSettled([
        signAsMember(created.memberToken),
        signAsMember(created.memberToken),
      ]);
      const outcomes = results.map((result) => result.status).sort();
      expect(outcomes).toEqual(['fulfilled', 'rejected']);

      const events = await listEvents(harness.deps, world.alpha.viewer, created.request.id);
      expect(events.filter((event) => event.kind === 'signed')).toHaveLength(1);
    });

    it('completes exactly once when both parties sign at the same moment', async () => {
      const created = await open();
      const states = await Promise.all([
        signAsMember(created.memberToken),
        signAsSteward(created.stewardToken),
      ]);
      expect(states.sort()).toEqual(['COMPLETED', 'SIGNED']);
      const events = await listEvents(harness.deps, world.alpha.viewer, created.request.id);
      expect(events.map((event) => event.kind)).toEqual([
        'created',
        'signed',
        'signed',
        'completed',
      ]);
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('expiry, revoking and new links', () => {
    it('stops accepting signatures after the expiry date and hides the content', async () => {
      const created = await open();
      const start = harness.deps.now();
      harness.advance(7 * DAY + 1);

      expect(await currentStatus(created.request.id)).toBe('EXPIRED');
      const session = await openSigningSession(harness.deps, created.memberToken, 'test');
      expect(session).toMatchObject({ state: 'EXPIRED', fields: [], parties: [], message: '' });
      await expect(signAsMember(created.memberToken)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This signing link has expired.',
      });
      expect(await recordView(harness.deps, created.memberToken, 'test')).toBe(false);
      harness.setNow(start);
    });

    it('revokes an open request and refuses to sign or revoke afterwards', async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      const revoked = await revokeRequest(harness.deps, world.alpha.editor, created.request.id);
      expect(statusOf(revoked, harness.deps.now())).toBe('REVOKED');

      await expect(signAsSteward(created.stewardToken)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This request was withdrawn.',
      });
      const session = await openSigningSession(harness.deps, created.stewardToken, 'test');
      expect(session).toMatchObject({ state: 'REVOKED', fields: [] });
      await expect(
        revokeRequest(harness.deps, world.alpha.editor, created.request.id),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('cannot revoke a completed request, and viewers cannot revoke at all', async () => {
      const created = await open();
      await expect(
        revokeRequest(harness.deps, world.alpha.viewer, created.request.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await signAsMember(created.memberToken);
      await signAsSteward(created.stewardToken);
      await expect(
        revokeRequest(harness.deps, world.alpha.owner, created.request.id),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('replaces a link: the new one works and the old one is dead', async () => {
      const created = await open();
      const memberLink = created.links.find((link) => link.label === 'Member');
      const fresh = await reissueLink(harness.deps, world.alpha.editor, memberLink?.signerId ?? '');
      const freshToken = tokenOf(fresh.url);
      expect(freshToken).not.toBe(created.memberToken);

      await expect(
        openSigningSession(harness.deps, created.memberToken, 'test'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await signAsMember(freshToken)).toBe('SIGNED');

      await expect(
        reissueLink(harness.deps, world.alpha.editor, memberLink?.signerId ?? ''),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('listing by status', () => {
    it('filters in SQL with the same rules the status is derived by', async () => {
      const scope = world.beta.owner;
      const start = harness.deps.now();
      const make = async (title: string) => {
        harness.advance(1000);
        return twoPartyRequest(harness.deps, scope, title);
      };
      const sign = (token: string, answers: typeof memberAnswers) =>
        submitSignature(harness.deps, token, { answers, signature: drawn }, 'test');

      const expired = await make('expired');
      harness.advance(8 * DAY);
      const awaiting = await make('awaiting');
      const partly = await make('partly');
      await sign(partly.memberToken, memberAnswers);
      const completed = await make('completed');
      await sign(completed.memberToken, memberAnswers);
      await sign(completed.stewardToken, stewardAnswers);
      const revoked = await make('revoked');
      await revokeRequest(harness.deps, scope, revoked.request.id);

      const titles = async (status: Parameters<typeof listRequests>[3]) =>
        (await listRequests(harness.deps, scope, normalizePageRequest(50, null), status)).items.map(
          (item) => item.title,
        );

      expect(await titles('EXPIRED')).toEqual([expired.request.title]);
      expect(await titles('AWAITING')).toEqual([awaiting.request.title]);
      expect(await titles('PARTLY_SIGNED')).toEqual([partly.request.title]);
      expect(await titles('COMPLETED')).toEqual([completed.request.title]);
      expect(await titles('REVOKED')).toEqual([revoked.request.title]);
      expect(await titles(null)).toEqual(['revoked', 'completed', 'partly', 'awaiting', 'expired']);

      const firstPage = await listRequests(
        harness.deps,
        scope,
        normalizePageRequest(2, null),
        null,
      );
      expect(firstPage.hasNextPage).toBe(true);
      const secondPage = await listRequests(
        harness.deps,
        scope,
        normalizePageRequest(2, firstPage.endCursor),
        null,
      );
      expect(secondPage.items.map((item) => item.title)).toEqual(['partly', 'awaiting']);
      harness.setNow(start);
    });
  });

  describe('history', () => {
    it('verifies as intact after a normal life cycle', async () => {
      const created = await open();
      await recordView(harness.deps, created.memberToken, 'test');
      await signAsMember(created.memberToken);
      await signAsSteward(created.stewardToken);

      expect(await verifyHistory(harness.deps, world.alpha.viewer, created.request.id)).toEqual({
        intact: true,
        checkedEvents: 5,
        problem: null,
      });
    });

    it('refuses updates and deletes of events in the database', async () => {
      const created = await open();
      await expect(
        harness.deps.db.admin.query(
          "update request_events set actor = 'nobody' where request_id = $1",
          [created.request.id],
        ),
      ).rejects.toThrow(/cannot be changed or removed/);
      await expect(
        harness.deps.db.admin.query('delete from request_events where request_id = $1', [
          created.request.id,
        ]),
      ).rejects.toThrow(/cannot be changed or removed/);
    });

    it('detects an event that was rewritten by someone who bypassed the trigger', async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      const admin = harness.deps.db.admin;

      await admin.query('alter table request_events disable trigger request_events_append_only');
      await admin.query(
        `update request_events set occurred_at = occurred_at - interval '3 days'
          where request_id = $1 and seq = 2`,
        [created.request.id],
      );
      await admin.query('alter table request_events enable trigger request_events_append_only');

      const check = await verifyHistory(harness.deps, world.alpha.viewer, created.request.id);
      expect(check.intact).toBe(false);
      expect(check.problem).toContain('Event 2 does not fit the chain');
    });

    it('detects a deleted event', async () => {
      const created = await open();
      await recordView(harness.deps, created.memberToken, 'test');
      await signAsMember(created.memberToken);
      const admin = harness.deps.db.admin;

      await admin.query('alter table request_events disable trigger request_events_append_only');
      await admin.query('delete from request_events where request_id = $1 and seq = 2', [
        created.request.id,
      ]);
      await admin.query('alter table request_events enable trigger request_events_append_only');

      const check = await verifyHistory(harness.deps, world.alpha.viewer, created.request.id);
      expect(check).toMatchObject({ intact: false });
      expect(check.problem).toContain('Event 3');
    });

    it('detects answers that were edited after signing', async () => {
      const created = await open();
      await signAsMember(created.memberToken);
      await harness.deps.db.admin.query(
        `update signers set answers = jsonb_set(answers, '{phone}', '"555 9999"')
          where request_id = $1 and label = 'Member'`,
        [created.request.id],
      );

      const check = await verifyHistory(harness.deps, world.alpha.viewer, created.request.id);
      expect(check.intact).toBe(false);
      expect(check.problem).toContain('Member');
      expect(check.problem).toContain('fingerprint');
    });
  });

  describe('through the API', () => {
    it('runs the whole flow, batching the list page into a fixed number of queries', async () => {
      const cookie = await harness.signIn('editor@alpha.example');
      const version = await publishedVersion(harness.deps, world.alpha.editor);

      const created = await harness.gql<{
        createSigningRequest: { request: { id: string }; links: { label: string; url: string }[] };
      }>(
        `mutation ($ws: ID!, $input: NewRequestInput!) {
          createSigningRequest(workspaceId: $ws, input: $input) {
            request { id status }
            links { label url }
          }
        }`,
        {
          ws: world.alpha.id,
          input: {
            templateVersionId: version.id,
            title: 'API flow',
            message: '',
            expiresInDays: 3,
            signers: [
              { blockId: 'sig_member', name: 'Ada', email: 'ada@example.com' },
              { blockId: 'sig_steward', name: 'Sol', email: 'sol@example.com' },
            ],
          },
        },
        cookie,
      );
      expect(created.errors).toEqual([]);
      const memberUrl = created.data?.createSigningRequest.links.find(
        (link) => link.label === 'Member',
      )?.url;
      const token = tokenOf(memberUrl ?? '');

      const session = await harness.gql<{ signingSession: { state: string } }>(
        'query ($token: String!) { signingSession(token: $token) { state fields { id } } }',
        { token },
      );
      expect(session.data?.signingSession.state).toBe('OPEN');

      const submitted = await harness.gql<{ submitSignature: string }>(
        `mutation ($token: String!, $input: SubmissionInput!) {
          submitSignature(token: $token, input: $input)
        }`,
        {
          token,
          input: {
            answers: memberAnswers,
            signature: { kind: 'DRAWN', strokes: [{ points: drawn.strokes[0] }] },
          },
        },
      );
      expect(submitted.errors).toEqual([]);
      expect(submitted.data?.submitSignature).toBe('SIGNED');

      const invalid = await harness.gql(
        `mutation ($token: String!, $input: SubmissionInput!) {
          submitSignature(token: $token, input: $input)
        }`,
        { token, input: { answers: [], signature: { kind: 'TYPED', text: 'Ada' } } },
      );
      expect(invalid.errors[0]?.extensions?.code).toBe('CONFLICT');

      const list = await harness.gql<{
        workspace: {
          requests: {
            items: {
              title: string;
              status: string;
              version: { number: number };
              signers: { label: string; signedAt: string | null }[];
            }[];
          };
        };
      }>(
        `query ($ws: ID!) {
          workspace(id: $ws) {
            requests(first: 50) {
              items {
                title status signedCount signerCount
                version { number title }
                signers { label name signedAt signature { kind strokes { points { x y } } } }
              }
            }
          }
        }`,
        { ws: world.alpha.id },
        cookie,
      );
      expect(list.errors).toEqual([]);
      const items = list.data?.workspace.requests.items ?? [];
      expect(items.length).toBeGreaterThan(10);
      expect(items[0]).toMatchObject({ title: 'API flow', status: 'PARTLY_SIGNED' });
      expect(items[0]?.signers.map((signer) => signer.signedAt !== null)).toEqual([true, false]);
    });

    it('returns validation issues with field ids in the error extensions', async () => {
      const created = await open();
      const result = await harness.gql(
        `mutation ($token: String!, $input: SubmissionInput!) {
          submitSignature(token: $token, input: $input)
        }`,
        {
          token: created.memberToken,
          input: { answers: [], signature: { kind: 'TYPED', text: '' } },
        },
      );
      expect(result.errors[0]?.extensions).toMatchObject({
        code: 'VALIDATION',
        issues: expect.arrayContaining([
          { fieldId: 'sig_member', message: 'Type your name to sign.' },
        ]) as unknown,
      });
    });
  });
});
