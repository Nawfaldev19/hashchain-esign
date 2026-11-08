import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config';
import { AppError, conflict, forbidden, invalid, notFound } from '../../src/server/domain/errors';
import {
  GENESIS_HASH,
  canonicalJson,
  computeEventHash,
  verifyChain,
} from '../../src/server/domain/history';
import type { EventContent, StoredEvent } from '../../src/server/domain/history';
import {
  decodeCursor,
  encodeCursor,
  isUuid,
  normalizePageRequest,
  toPage,
} from '../../src/server/domain/pagination';
import { createRateLimiter } from '../../src/server/domain/rate-limit';
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../src/server/domain/secrets';
import { createLogger, describeError } from '../../src/server/logger';
import { STATUS_LABELS, deriveRequestStatus, isOpen } from '../../src/shared/status';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function chain(length: number): StoredEvent[] {
  const events: StoredEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= length; seq += 1) {
    const content: EventContent = {
      requestId: REQUEST_ID,
      seq,
      kind: seq === 1 ? 'created' : 'viewed',
      actor: 'system',
      detail: { step: seq },
      occurredAt: new Date(Date.UTC(2025, 0, seq)),
    };
    const hash = computeEventHash(prevHash, content);
    events.push({ ...content, prevHash, hash });
    prevHash = hash;
  }
  return events;
}

describe('history chain', () => {
  it('produces the same JSON whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: [true, null, { z: 'x', y: 2 }] })).toBe(
      '{"a":[true,null,{"y":2,"z":"x"}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('hashes to 64 hex characters and changes with any part of the event', () => {
    const [event] = chain(1);
    if (!event) throw new Error('no event');
    const base = computeEventHash(GENESIS_HASH, event);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const variants: EventContent[] = [
      { ...event, kind: 'signed' },
      { ...event, actor: 'user:1' },
      { ...event, seq: 2 },
      { ...event, detail: { step: 2 } },
      { ...event, occurredAt: new Date(event.occurredAt.getTime() + 1) },
      { ...event, requestId: '22222222-2222-4222-8222-222222222222' },
    ];
    for (const variant of variants) {
      expect(computeEventHash(GENESIS_HASH, variant)).not.toBe(base);
    }
    expect(computeEventHash('f'.repeat(64), event)).not.toBe(base);
  });

  it('accepts an untouched chain, including an empty one', () => {
    expect(verifyChain([])).toEqual({ intact: true, checkedEvents: 0, brokenAtSeq: null });
    expect(verifyChain(chain(6))).toEqual({ intact: true, checkedEvents: 6, brokenAtSeq: null });
  });

  it('points at the first event that was edited, removed, reordered or forged', () => {
    const edited = chain(5);
    edited[2] = { ...(edited[2] as StoredEvent), actor: 'user:intruder' };
    expect(verifyChain(edited).brokenAtSeq).toBe(3);

    const removed = chain(5).filter((event) => event.seq !== 2);
    expect(verifyChain(removed).brokenAtSeq).toBe(3);

    const [first, second, ...rest] = chain(4);
    expect(verifyChain([second, first, ...rest] as StoredEvent[]).brokenAtSeq).toBe(2);

    const forged = chain(3);
    const last = forged[2] as StoredEvent;
    const rewritten = { ...last, detail: { step: 99 } };
    forged[2] = { ...rewritten, hash: computeEventHash('0'.repeat(64), rewritten) };
    expect(verifyChain(forged)).toMatchObject({ intact: false, brokenAtSeq: 3 });
  });
});

describe('request status', () => {
  const now = new Date('2025-06-01T12:00:00Z');
  const facts = {
    expiresAt: new Date('2025-06-08T12:00:00Z'),
    completedAt: null,
    revokedAt: null,
    signerCount: 2,
    signedCount: 0,
  };

  it('derives each status from the facts', () => {
    expect(deriveRequestStatus(facts, now)).toBe('AWAITING');
    expect(deriveRequestStatus({ ...facts, signedCount: 1 }, now)).toBe('PARTLY_SIGNED');
    expect(deriveRequestStatus({ ...facts, signedCount: 2, completedAt: now }, now)).toBe(
      'COMPLETED',
    );
    expect(deriveRequestStatus({ ...facts, revokedAt: now }, now)).toBe('REVOKED');
    expect(deriveRequestStatus({ ...facts, expiresAt: now }, now)).toBe('EXPIRED');
  });

  it('keeps a completed request completed after its expiry date', () => {
    const later = new Date('2026-01-01T00:00:00Z');
    expect(deriveRequestStatus({ ...facts, completedAt: now }, later)).toBe('COMPLETED');
  });

  it('is open only while signatures are still accepted', () => {
    expect(isOpen('AWAITING')).toBe(true);
    expect(isOpen('PARTLY_SIGNED')).toBe(true);
    expect(['COMPLETED', 'EXPIRED', 'REVOKED'].some((status) => isOpen(status as never))).toBe(
      false,
    );
    expect(Object.keys(STATUS_LABELS)).toHaveLength(5);
  });
});

describe('secrets', () => {
  it('generates unguessable, URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[\w-]{43}$/);
  });

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies the right password only, with a fresh salt each time', async () => {
    const first = await hashPassword('open sesame', 1024);
    const second = await hashPassword('open sesame', 1024);
    expect(first).not.toBe(second);
    expect(first.startsWith('scrypt$1024$')).toBe(true);
    expect(await verifyPassword('open sesame', first)).toBe(true);
    expect(await verifyPassword('open sesame ', first)).toBe(false);
    expect(await verifyPassword('', first)).toBe(false);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    for (const stored of [
      '',
      'plain-text',
      'bcrypt$10$salt$key',
      'scrypt$x$salt$key',
      'scrypt$1024$$',
    ]) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });
});

describe('pagination', () => {
  const position = { createdAt: new Date('2025-06-01T12:00:00.123Z'), id: REQUEST_ID };

  it('round-trips a cursor', () => {
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('rejects cursors that were tampered with', () => {
    for (const cursor of [
      '',
      'garbage',
      Buffer.from('2025-06-01|not-a-uuid').toString('base64url'),
    ]) {
      expect(() => decodeCursor(cursor)).toThrow(AppError);
    }
  });

  it('applies defaults and limits to the page size', () => {
    expect(normalizePageRequest(null, undefined)).toEqual({ first: 20, after: null });
    expect(normalizePageRequest(50, 'abc')).toEqual({ first: 50, after: 'abc' });
    for (const bad of [0, 51, -1, 2.5]) {
      expect(() => normalizePageRequest(bad, null)).toThrow(AppError);
    }
  });

  it('uses the extra row only to detect another page', () => {
    const rows = [1, 2, 3].map((n) => ({
      createdAt: new Date(Date.UTC(2025, 0, n)),
      id: `0000000${n}-0000-4000-8000-000000000000`,
    }));
    const page = toPage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(page.hasNextPage).toBe(true);
    expect(decodeCursor(page.endCursor ?? '')).toEqual(rows[1]);
    expect(toPage(rows, 3)).toMatchObject({ hasNextPage: false });
    expect(toPage([], 3)).toEqual({ items: [], endCursor: null, hasNextPage: false });
  });

  it('recognises UUIDs', () => {
    expect(isUuid(REQUEST_ID)).toBe(true);
    expect(isUuid('1111')).toBe(false);
    expect(isUuid(`${REQUEST_ID}'; --`)).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per key and window, then resets', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.hit('b')).toBe(true);
    time = 999;
    expect(limiter.hit('a')).toBe(false);
    time = 1000;
    expect(limiter.hit('a')).toBe(true);
    limiter.reset('a');
    expect([limiter.hit('a'), limiter.hit('a')]).toEqual([true, true]);
  });

  it('forgets expired keys when it is full', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10, now: () => time, maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    expect(limiter.hit('a')).toBe(false);
    time = 20;
    limiter.hit('c');
    expect(limiter.hit('a')).toBe(true);
  });
});

describe('errors', () => {
  it('builds errors with stable codes', () => {
    expect(notFound('Template')).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Template not found.',
    });
    expect(forbidden().code).toBe('FORBIDDEN');
    expect(conflict('x').code).toBe('CONFLICT');
    expect(invalid('x', [{ fieldId: 'a', message: 'b' }]).issues).toHaveLength(1);
    expect(notFound('x')).toBeInstanceOf(Error);
  });
});

describe('configuration and logging', () => {
  it('uses safe defaults and reads overrides', () => {
    expect(loadConfig({})).toMatchObject({
      PORT: 4000,
      DATA_DIR: '.data/pglite',
      SEED_DEMO: true,
      SESSION_TTL_HOURS: 12,
      LOG_LEVEL: 'info',
    });
    expect(loadConfig({ PORT: '8080', SEED_DEMO: 'false', LOG_LEVEL: 'warn' })).toMatchObject({
      PORT: 8080,
      SEED_DEMO: false,
      LOG_LEVEL: 'warn',
    });
  });

  it('fails fast and names the bad setting', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/Invalid configuration\. PORT/);
    expect(() => loadConfig({ PUBLIC_URL: 'not a url' })).toThrow(/PUBLIC_URL/);
  });

  it('writes JSON lines at or above the chosen level', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (line) => lines.push(line));
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('careful', { requestId: 'r1' });
    logger.error('broken', describeError(new RangeError('too far')));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'warn',
      message: 'careful',
      requestId: 'r1',
    });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      level: 'error',
      errorName: 'RangeError',
      errorMessage: 'too far',
    });
    expect(describeError('plain')).toEqual({ errorMessage: 'plain' });
  });
});
