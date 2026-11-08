import type { TemplateField } from '../../src/shared/fields';

/** Plain test data with no dependency on the server, usable by every test layer. */

export const field = (
  id: string,
  kind: TemplateField['kind'],
  label: string,
  extra: Partial<TemplateField> = {},
): TemplateField => ({
  id,
  kind,
  label,
  body: null,
  required: false,
  options: [],
  assignedTo: null,
  ...extra,
});

/** A small two-party document used by most tests. */
export const twoPartyFields: TemplateField[] = [
  field('h1', 'heading', 'Bench rules'),
  field('p1', 'paragraph', '', { body: 'Keep the bench tidy.' }),
  field('agree', 'checkbox', 'I agree', { required: true, assignedTo: 'sig_member' }),
  field('phone', 'text', 'Phone', { required: true, assignedTo: 'sig_member' }),
  field('level', 'choice', 'Level', { options: ['New', 'Skilled'], assignedTo: 'sig_member' }),
  field('day', 'date', 'Checked on', { required: true, assignedTo: 'sig_steward' }),
  field('sig_member', 'signature', 'Member'),
  field('sig_steward', 'signature', 'Steward'),
];

export const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

export const drawn = {
  kind: 'drawn' as const,
  strokes: [
    [
      { x: 0.1, y: 0.5 },
      { x: 0.5, y: 0.2 },
      { x: 0.9, y: 0.6 },
    ],
  ],
};
