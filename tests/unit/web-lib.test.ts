import { describe, expect, it } from 'vitest';
import type { CombinedError } from 'urql';
import {
  answersToRecord,
  fromApiField,
  fromApiSignature,
  toApiField,
  toApiSignature,
} from '../../src/web/lib/api-mapping';
import { issuesByField, readFailure } from '../../src/web/lib/errors';
import { formatDate, formatDateTime } from '../../src/web/lib/format';
import { FIELD_KINDS } from '../../src/shared/fields';
import { field } from '../helpers/fixtures';

const graphQLFailure = (extensions: Record<string, unknown>, message = 'Nope'): CombinedError =>
  ({ graphQLErrors: [{ message, extensions }] }) as unknown as CombinedError;

describe('readFailure', () => {
  it('returns null when nothing failed', () => {
    expect(readFailure(undefined)).toBeNull();
  });

  it('reports a network failure when no GraphQL error arrived', () => {
    expect(readFailure({ graphQLErrors: [] } as unknown as CombinedError)).toMatchObject({
      code: 'NETWORK',
      issues: [],
    });
  });

  it('reads the code, message and well-formed issues', () => {
    const failure = readFailure(
      graphQLFailure({
        code: 'VALIDATION',
        issues: [
          { fieldId: 'a', message: 'Required.' },
          { fieldId: null, message: 'General.' },
          { fieldId: 7, message: 'Wrong id type.' },
          'not an issue',
          null,
        ],
      }),
    );
    expect(failure).toEqual({
      code: 'VALIDATION',
      message: 'Nope',
      issues: [
        { fieldId: 'a', message: 'Required.' },
        { fieldId: null, message: 'General.' },
      ],
    });
  });

  it('falls back to INTERNAL when the code is missing', () => {
    expect(readFailure(graphQLFailure({}))).toMatchObject({ code: 'INTERNAL', issues: [] });
    expect(readFailure(graphQLFailure({ code: 42, issues: 'oops' }))).toMatchObject({
      code: 'INTERNAL',
      issues: [],
    });
  });
});

describe('issuesByField', () => {
  it('groups messages per field and leaves out general issues', () => {
    const grouped = issuesByField([
      { fieldId: 'a', message: 'One.' },
      { fieldId: null, message: 'General.' },
      { fieldId: 'a', message: 'Two.' },
      { fieldId: 'b', message: 'Three.' },
    ]);
    expect([...grouped.entries()]).toEqual([
      ['a', ['One.', 'Two.']],
      ['b', ['Three.']],
    ]);
  });
});

describe('API mapping', () => {
  it('round-trips every field kind', () => {
    for (const kind of FIELD_KINDS) {
      const original = field('f1', kind, 'Label', {
        body: 'Help',
        required: true,
        options: ['A', 'B'],
        assignedTo: 's1',
      });
      const api = toApiField(original);
      expect(api.kind).toBe(api.kind.toUpperCase());
      expect(fromApiField(api)).toEqual(original);
    }
    expect(toApiField(field('f', 'longText', 'x')).kind).toBe('LONG_TEXT');
  });

  it('round-trips both kinds of signature', () => {
    const drawn = {
      kind: 'drawn' as const,
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    };
    const typed = { kind: 'typed' as const, text: 'Ada Member' };
    expect(toApiSignature(drawn)).toEqual({
      kind: 'DRAWN',
      strokes: [{ points: drawn.strokes[0] }],
    });
    expect(toApiSignature(typed)).toEqual({ kind: 'TYPED', text: 'Ada Member' });
    expect(
      fromApiSignature({
        kind: 'DRAWN',
        text: null,
        strokes: [{ points: drawn.strokes[0] ?? [] }],
      }),
    ).toEqual(drawn);
    expect(fromApiSignature({ kind: 'TYPED', text: 'Ada Member', strokes: [] })).toEqual(typed);
    expect(fromApiSignature(null)).toBeNull();
    expect(fromApiSignature({ kind: 'TYPED', text: null, strokes: [] })).toEqual({
      kind: 'typed',
      text: '',
    });
  });

  it('turns an answer list into a lookup', () => {
    expect(
      answersToRecord([
        { fieldId: 'a', value: '1' },
        { fieldId: 'b', value: '' },
      ]),
    ).toEqual({ a: '1', b: '' });
  });
});

describe('formatting', () => {
  it('formats dates in the reader locale', () => {
    expect(formatDate('2025-03-14T10:30:00Z')).toMatch(/2025/);
    expect(formatDateTime('2025-03-14T10:30:00Z')).toMatch(/2025/);
    expect(formatDateTime('2025-03-14T10:30:00Z').length).toBeGreaterThan(
      formatDate('2025-03-14T10:30:00Z').length,
    );
  });
});
