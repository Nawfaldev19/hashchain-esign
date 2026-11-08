import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizePageRequest } from '../../src/server/domain/pagination';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  listVersions,
  publishTemplate,
  saveDraft,
} from '../../src/server/services/template-service';
import { field, twoPartyFields } from '../helpers/fixtures';
import { createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

describe('templates and versions', () => {
  let harness: Harness;
  let world: World;

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
  });

  afterAll(async () => {
    await harness.close();
  });

  const newTemplate = (title = 'Kiln rules') =>
    createTemplate(harness.deps, world.alpha.editor, { title, description: 'For the kiln room.' });

  it('starts as an empty draft at revision 1', async () => {
    const template = await newTemplate();
    expect(template).toMatchObject({ title: 'Kiln rules', draftFields: [], draftRevision: 1 });
  });

  it('stores draft fields exactly as saved and bumps the revision', async () => {
    const template = await newTemplate();
    const saved = await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Kiln rules, revised',
      description: '',
      fields: twoPartyFields,
      expectedRevision: 1,
    });
    expect(saved.draftRevision).toBe(2);
    expect(saved.title).toBe('Kiln rules, revised');
    expect(saved.draftFields).toEqual(twoPartyFields);

    const reloaded = await getTemplate(harness.deps, world.alpha.viewer, template.id);
    expect(reloaded.draftFields).toEqual(twoPartyFields);
  });

  it('refuses a save that started from an outdated revision', async () => {
    const template = await newTemplate();
    const edit = { title: 'A', description: '', fields: [], expectedRevision: 1 };
    await saveDraft(harness.deps, world.alpha.editor, template.id, edit);

    await expect(
      saveDraft(harness.deps, world.alpha.owner, template.id, { ...edit, title: 'B' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const current = await getTemplate(harness.deps, world.alpha.editor, template.id);
    expect(current.title).toBe('A');
  });

  it('rejects malformed drafts before they reach the database', async () => {
    const template = await newTemplate();
    const save = (fields: unknown, title = 'Ok') =>
      saveDraft(harness.deps, world.alpha.editor, template.id, {
        title,
        description: '',
        fields: fields as never,
        expectedRevision: 1,
      });

    await expect(save([], '   ')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(save([field('bad id!', 'text', 'x')])).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(save([{ ...field('a', 'text', 'x'), kind: 'video' }])).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(save([field('a', 'text', 'x'), field('a', 'text', 'y')])).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Two fields share the same id.',
    });
    await expect(save([field('a', 'text', 'x'.repeat(201))])).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('publishes numbered versions and refuses to publish twice without changes', async () => {
    const template = await newTemplate();
    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Kiln rules',
      description: '',
      fields: twoPartyFields,
      expectedRevision: 1,
    });

    const first = await publishTemplate(harness.deps, world.alpha.editor, template.id);
    expect(first.number).toBe(1);
    await expect(
      publishTemplate(harness.deps, world.alpha.editor, template.id),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Kiln rules',
      description: 'Now with a second rule.',
      fields: [...twoPartyFields, field('p2', 'paragraph', '', { body: 'Vent the room.' })],
      expectedRevision: 2,
    });
    const second = await publishTemplate(harness.deps, world.alpha.editor, template.id);
    expect(second.number).toBe(2);

    const versions = await listVersions(harness.deps, world.alpha.viewer, template.id);
    expect(versions.map((version) => version.number)).toEqual([2, 1]);
  });

  it('keeps a published version unchanged when the draft is edited afterwards', async () => {
    const template = await newTemplate();
    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Original title',
      description: '',
      fields: twoPartyFields,
      expectedRevision: 1,
    });
    const version = await publishTemplate(harness.deps, world.alpha.editor, template.id);

    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Changed title',
      description: '',
      fields: [],
      expectedRevision: 2,
    });

    const versions = await listVersions(harness.deps, world.alpha.editor, template.id);
    expect(versions[0]).toMatchObject({ id: version.id, title: 'Original title' });
    expect(versions[0]?.fields).toEqual(twoPartyFields);
  });

  it('makes versions unchangeable in the database itself', async () => {
    const template = await newTemplate();
    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Kiln rules',
      description: '',
      fields: twoPartyFields,
      expectedRevision: 1,
    });
    const version = await publishTemplate(harness.deps, world.alpha.editor, template.id);

    await expect(
      harness.deps.db.admin.query('update template_versions set title = $1 where id = $2', [
        'Rewritten',
        version.id,
      ]),
    ).rejects.toThrow(/cannot be changed or removed/);
    await expect(
      harness.deps.db.admin.query('delete from template_versions where id = $1', [version.id]),
    ).rejects.toThrow(/cannot be changed or removed/);
  });

  it('refuses to publish a draft that is not ready, and says why', async () => {
    const template = await newTemplate();
    await saveDraft(harness.deps, world.alpha.editor, template.id, {
      title: 'Kiln rules',
      description: '',
      fields: [field('q', 'text', 'Name', { required: true })],
      expectedRevision: 1,
    });
    await expect(
      publishTemplate(harness.deps, world.alpha.editor, template.id),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: expect.arrayContaining([
        { fieldId: null, message: 'Add at least one signature block.' },
        { fieldId: 'q', message: 'Choose which signer fills this in.' },
      ]) as unknown,
    });
  });

  it('lets viewers read but not create, save or publish', async () => {
    const template = await newTemplate();
    await expect(
      createTemplate(harness.deps, world.alpha.viewer, { title: 'x', description: '' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      saveDraft(harness.deps, world.alpha.viewer, template.id, {
        title: 'x',
        description: '',
        fields: [],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      publishTemplate(harness.deps, world.alpha.viewer, template.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getTemplate(harness.deps, world.alpha.viewer, template.id)).resolves.toBeDefined();
  });

  it('answers NOT_FOUND for unknown and malformed ids', async () => {
    await expect(
      getTemplate(harness.deps, world.alpha.viewer, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getTemplate(harness.deps, world.alpha.viewer, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      saveDraft(harness.deps, world.alpha.editor, '00000000-0000-4000-8000-000000000000', {
        title: 'x',
        description: '',
        fields: [],
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('pages through templates newest first, without gaps or repeats', async () => {
    const scope = world.beta.owner;
    for (let index = 1; index <= 5; index += 1) {
      harness.advance(1000);
      await harness.deps.db.admin.query(
        'insert into templates (workspace_id, title, created_by, created_at) values ($1, $2, $3, $4)',
        [scope.workspaceId, `Template ${index}`, scope.userId, harness.deps.now()],
      );
    }

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await listTemplates(harness.deps, scope, normalizePageRequest(2, after));
      seen.push(...page.items.map((item) => item.title));
      if (!page.hasNextPage) break;
      after = page.endCursor;
    }
    expect(seen).toEqual(['Template 5', 'Template 4', 'Template 3', 'Template 2', 'Template 1']);
  });

  it('reports draft state through the API in one round trip', async () => {
    const template = await newTemplate('API template');
    const cookie = await harness.signIn('editor@alpha.example');
    const saved = await harness.gql<{ saveTemplateDraft: { draftRevision: number } }>(
      `mutation ($ws: ID!, $id: ID!, $input: DraftInput!) {
        saveTemplateDraft(workspaceId: $ws, templateId: $id, input: $input) { draftRevision }
      }`,
      {
        ws: world.alpha.id,
        id: template.id,
        input: {
          title: 'API template',
          description: '',
          expectedRevision: 1,
          fields: [
            { id: 's1', kind: 'SIGNATURE', label: 'Member', required: false, options: [] },
            {
              id: 'q1',
              kind: 'LONG_TEXT',
              label: 'Notes',
              required: false,
              options: [],
              assignedTo: 's1',
            },
          ],
        },
      },
      cookie,
    );
    expect(saved.errors).toEqual([]);
    expect(saved.data?.saveTemplateDraft.draftRevision).toBe(2);

    const query = `query ($ws: ID!, $id: ID!) {
      workspace(id: $ws) {
        template(id: $id) {
          hasUnpublishedChanges
          publishIssues { message }
          latestVersion { number }
          draftFields { id kind assignedTo }
        }
      }
    }`;
    interface TemplateState {
      workspace: {
        template: {
          hasUnpublishedChanges: boolean;
          publishIssues: unknown[];
          latestVersion: { number: number } | null;
          draftFields: { id: string; kind: string; assignedTo: string | null }[];
        };
      };
    }
    const before = await harness.gql<TemplateState>(
      query,
      { ws: world.alpha.id, id: template.id },
      cookie,
    );
    expect(before.data?.workspace.template).toEqual({
      hasUnpublishedChanges: true,
      publishIssues: [],
      latestVersion: null,
      draftFields: [
        { id: 's1', kind: 'SIGNATURE', assignedTo: null },
        { id: 'q1', kind: 'LONG_TEXT', assignedTo: 's1' },
      ],
    });

    await publishTemplate(harness.deps, world.alpha.editor, template.id);
    const after = await harness.gql<TemplateState>(
      query,
      { ws: world.alpha.id, id: template.id },
      cookie,
    );
    expect(after.data?.workspace.template).toMatchObject({
      hasUnpublishedChanges: false,
      latestVersion: { number: 1 },
    });
  });
});
