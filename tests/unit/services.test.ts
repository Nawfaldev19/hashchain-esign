import { describe, expect, it } from 'vitest';
import { contentHash } from '../../src/server/services/event-log';
import { roleAtLeast } from '../../src/server/services/records';
import { newRequestSchema, parseInput } from '../../src/server/services/validation';

describe('content fingerprint', () => {
  it('fingerprints submitted content independent of key order', () => {
    const signature = { kind: 'typed' as const, text: 'Ada' };
    expect(contentHash({ a: '1', b: '2' }, signature)).toBe(
      contentHash({ b: '2', a: '1' }, signature),
    );
    expect(contentHash({ a: '1' }, signature)).not.toBe(contentHash({ a: '2' }, signature));
    expect(contentHash({ a: '1' }, signature)).not.toBe(
      contentHash({ a: '1' }, { kind: 'typed', text: 'Eve' }),
    );
  });
});

describe('roles and input parsing', () => {
  it('orders roles viewer < editor < owner', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('viewer', 'editor')).toBe(false);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
  });

  it('names the failing path when input is invalid', () => {
    expect(() =>
      parseInput(newRequestSchema, {
        title: '',
        message: '',
        expiresInDays: 400,
        signers: [{ blockId: 'a', name: 'A', email: 'nope' }],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION',
        issues: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringMatching(/^title: /) as unknown }),
          expect.objectContaining({
            message: expect.stringMatching(/^expiresInDays: /) as unknown,
          }),
          expect.objectContaining({
            message: expect.stringMatching(/^signers\.0\.email: /) as unknown,
          }),
        ]) as unknown,
      }) as Error,
    );
  });
});
