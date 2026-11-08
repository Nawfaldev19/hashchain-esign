import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  blankField,
  isInputKind,
  isRealIsoDate,
  newFieldId,
  signatureBlocks,
  validateAnswers,
  validateForPublishing,
  validateSignature,
} from '../../src/shared/fields';
import type { TemplateField } from '../../src/shared/fields';
import { field, twoPartyFields } from '../helpers/fixtures';

const messages = (fields: TemplateField[]): string[] =>
  validateForPublishing(fields).map((issue) => issue.message);

describe('validateForPublishing', () => {
  it('accepts a complete two-party document', () => {
    expect(validateForPublishing(twoPartyFields)).toEqual([]);
  });

  it('asks for a field and a signature block', () => {
    expect(messages([])).toEqual(['Add at least one field before publishing.']);
    expect(messages([field('h', 'heading', 'Title')])).toEqual([
      'Add at least one signature block.',
    ]);
  });

  it('caps the number of fields', () => {
    const many = Array.from({ length: LIMITS.fieldsPerTemplate + 1 }, (_, index) =>
      field(`s${index}`, 'signature', `Signer ${index}`),
    );
    expect(messages(many)).toEqual([
      `A template can hold at most ${LIMITS.fieldsPerTemplate} fields.`,
    ]);
  });

  it('requires labels, and body text for paragraphs', () => {
    const issues = validateForPublishing([
      field('h', 'heading', '   '),
      field('p', 'paragraph', '', { body: ' ' }),
      field('ok', 'paragraph', '', { body: 'Text' }),
      field('s', 'signature', 'Member'),
    ]);
    expect(issues).toEqual([
      { fieldId: 'h', message: 'Give this field a label.' },
      { fieldId: 'p', message: 'Write the paragraph text.' },
    ]);
  });

  it('rejects duplicate ids and duplicate signer labels, ignoring case', () => {
    expect(
      validateForPublishing([
        field('s', 'signature', 'Member'),
        field('s', 'signature', 'Steward'),
        field('t', 'signature', 'member'),
      ]),
    ).toEqual([
      { fieldId: 's', message: 'Two fields share the same id.' },
      { fieldId: 't', message: 'Signer labels must be different.' },
    ]);
  });

  it('checks choice options', () => {
    const choice = (options: string[]) =>
      messages([
        field('c', 'choice', 'Pick', { options, assignedTo: 's' }),
        field('s', 'signature', 'Member'),
      ]);
    expect(choice(['Only one'])).toEqual(['A choice needs at least two options.']);
    expect(choice(['A', ' '])).toEqual(['Options cannot be empty.']);
    expect(choice(['A', 'A '])).toEqual(['Options must be different.']);
    expect(choice(['A', 'B'])).toEqual([]);
  });

  it('requires every input to be assigned to an existing signature block', () => {
    expect(
      validateForPublishing([
        field('a', 'text', 'Unassigned'),
        field('b', 'date', 'Dangling', { assignedTo: 'gone' }),
        field('c', 'checkbox', 'Assigned to a non-signature field', { assignedTo: 'a' }),
        field('s', 'signature', 'Member'),
      ]).map((issue) => issue.fieldId),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('validateAnswers', () => {
  const validate = (answers: Record<string, string>, block = 'sig_member') =>
    validateAnswers(twoPartyFields, block, answers);

  it('accepts complete answers and optional gaps', () => {
    expect(validate({ agree: 'true', phone: '555 0100' })).toEqual([]);
    expect(validate({ agree: 'true', phone: '555 0100', level: '' })).toEqual([]);
  });

  it('treats whitespace as empty', () => {
    expect(validate({ agree: 'true', phone: '   ' })).toEqual([
      { fieldId: 'phone', message: 'This field is required.' },
    ]);
  });

  it('needs a required checkbox to be ticked, and only accepts true or false', () => {
    expect(validate({ agree: 'false', phone: '1' })[0]?.message).toBe(
      'You need to tick this box to continue.',
    );
    expect(validate({ agree: 'yes', phone: '1' })[0]?.message).toBe('Tick or untick the box.');
  });

  it('only accepts listed options and real dates', () => {
    expect(validate({ agree: 'true', phone: '1', level: 'Expert' })).toEqual([
      { fieldId: 'level', message: 'Pick one of the listed options.' },
    ]);
    expect(validate({ day: '2025-02-30' }, 'sig_steward')).toEqual([
      { fieldId: 'day', message: 'Enter a real date.' },
    ]);
    expect(validate({ day: '2024-02-29' }, 'sig_steward')).toEqual([]);
  });

  it('enforces length limits', () => {
    const fields = [
      field('short', 'text', 'Short', { assignedTo: 's' }),
      field('long', 'longText', 'Long', { assignedTo: 's' }),
      field('s', 'signature', 'Member'),
    ];
    const issues = validateAnswers(fields, 's', {
      short: 'x'.repeat(LIMITS.textAnswerLength + 1),
      long: 'x'.repeat(LIMITS.longTextAnswerLength + 1),
    });
    expect(issues.map((issue) => issue.fieldId)).toEqual(['short', 'long']);
    expect(
      validateAnswers(fields, 's', {
        short: 'x'.repeat(LIMITS.textAnswerLength),
        long: 'x'.repeat(LIMITS.longTextAnswerLength),
      }),
    ).toEqual([]);
  });

  it("rejects answers to unknown fields, static fields and other signers' fields", () => {
    const issues = validate({ agree: 'true', phone: '1', ghost: 'x', h1: 'x', day: '2025-01-01' });
    expect(issues).toEqual([
      { fieldId: 'ghost', message: 'This field is not yours to fill in.' },
      { fieldId: 'h1', message: 'This field is not yours to fill in.' },
      { fieldId: 'day', message: 'This field is not yours to fill in.' },
    ]);
  });
});

describe('validateSignature', () => {
  const line = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ];

  it('accepts a typed name and a drawn line', () => {
    expect(validateSignature({ kind: 'typed', text: 'Ada Member' })).toBeNull();
    expect(validateSignature({ kind: 'drawn', strokes: [line] })).toBeNull();
  });

  it('rejects empty signatures', () => {
    expect(validateSignature({ kind: 'typed', text: '  ' })).toBe('Type your name to sign.');
    expect(validateSignature({ kind: 'drawn', strokes: [] })).toBe('Draw your signature to sign.');
    expect(validateSignature({ kind: 'drawn', strokes: [[{ x: 0.5, y: 0.5 }]] })).toBe(
      'Draw your signature to sign.',
    );
  });

  it('rejects oversized and out-of-box signatures', () => {
    expect(
      validateSignature({ kind: 'typed', text: 'x'.repeat(LIMITS.typedSignatureLength + 1) }),
    ).toContain('Keep the typed signature under');
    expect(
      validateSignature({
        kind: 'drawn',
        strokes: Array.from({ length: LIMITS.strokesPerSignature + 1 }, () => line),
      }),
    ).toBe('The signature is too detailed.');
    expect(
      validateSignature({
        kind: 'drawn',
        strokes: [
          Array.from({ length: LIMITS.pointsPerSignature + 1 }, () => ({ x: 0.5, y: 0.5 })),
        ],
      }),
    ).toBe('The signature is too detailed.');
    for (const bad of [1.2, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateSignature({ kind: 'drawn', strokes: [[...line, { x: bad, y: 0.5 }]] })).toBe(
        'The signature leaves the signing box.',
      );
    }
  });
});

describe('helpers', () => {
  it('knows which kinds take an answer', () => {
    expect(
      ['text', 'longText', 'checkbox', 'date', 'choice'].every((kind) =>
        isInputKind(kind as never),
      ),
    ).toBe(true);
    expect(['heading', 'paragraph', 'signature'].some((kind) => isInputKind(kind as never))).toBe(
      false,
    );
  });

  it('finds signature blocks in order', () => {
    expect(signatureBlocks(twoPartyFields).map((block) => block.label)).toEqual([
      'Member',
      'Steward',
    ]);
  });

  it('checks calendar dates strictly', () => {
    expect(isRealIsoDate('2025-12-31')).toBe(true);
    expect(isRealIsoDate('2025-13-01')).toBe(false);
    expect(isRealIsoDate('2025-04-31')).toBe(false);
    expect(isRealIsoDate('31/12/2025')).toBe(false);
    expect(isRealIsoDate('2025-1-1')).toBe(false);
  });

  it('makes ids that do not collide with existing fields', () => {
    const ids = new Set<string>();
    let fields: TemplateField[] = [];
    for (let index = 0; index < 200; index += 1) {
      const id = newFieldId(fields);
      ids.add(id);
      fields = [...fields, field(id, 'text', 'x')];
    }
    expect(ids.size).toBe(200);
  });

  it('creates sensible blank fields', () => {
    expect(blankField('heading', [])).toMatchObject({ required: false, assignedTo: null });
    expect(blankField('choice', [])).toMatchObject({ options: ['', ''], required: true });
    expect(blankField('text', twoPartyFields)).toMatchObject({ assignedTo: 'sig_member' });
    expect(blankField('signature', twoPartyFields)).toMatchObject({ assignedTo: null });
  });
});
