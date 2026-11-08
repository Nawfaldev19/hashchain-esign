import type { Deps, Scope, TemplateVersionRecord } from '../../src/server/services/records';
import { createRequest } from '../../src/server/services/request-service';
import type { CreatedRequest } from '../../src/server/services/request-service';
import {
  createTemplate,
  publishTemplate,
  saveDraft,
} from '../../src/server/services/template-service';
import type { TemplateField } from '../../src/shared/fields';
import { tokenOf, twoPartyFields } from './fixtures';

export async function publishedVersion(
  deps: Deps,
  scope: Scope,
  fields: TemplateField[] = twoPartyFields,
  title = 'Bench agreement',
): Promise<TemplateVersionRecord> {
  const template = await createTemplate(deps, scope, { title, description: '' });
  await saveDraft(deps, scope, template.id, {
    title,
    description: '',
    fields,
    expectedRevision: template.draftRevision,
  });
  return publishTemplate(deps, scope, template.id);
}

export interface OpenRequest extends CreatedRequest {
  memberToken: string;
  stewardToken: string;
}

export async function twoPartyRequest(
  deps: Deps,
  scope: Scope,
  title = 'Sign-off',
): Promise<OpenRequest> {
  const version = await publishedVersion(deps, scope);
  const created = await createRequest(deps, scope, {
    templateVersionId: version.id,
    title,
    message: 'Please sign.',
    expiresInDays: 7,
    signers: [
      { blockId: 'sig_member', name: 'Ada Member', email: 'ada@example.com' },
      { blockId: 'sig_steward', name: 'Sol Steward', email: 'sol@example.com' },
    ],
  });
  const linkFor = (label: string): string => {
    const link = created.links.find((candidate) => candidate.label === label);
    if (!link) throw new Error(`No link for ${label}`);
    return tokenOf(link.url);
  };
  return { ...created, memberToken: linkFor('Member'), stewardToken: linkFor('Steward') };
}

export const memberAnswers = [
  { fieldId: 'agree', value: 'true' },
  { fieldId: 'phone', value: '555 0100' },
  { fieldId: 'level', value: 'Skilled' },
];

export const stewardAnswers = [{ fieldId: 'day', value: '2025-06-01' }];
