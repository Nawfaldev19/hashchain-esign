import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  hexToRgb,
  renderRequestPdf,
  toDrawable,
  wrapText,
} from '../../src/server/services/pdf-service';
import type { PdfInput } from '../../src/server/services/pdf-service';
import { field } from '../helpers/fixtures';

let font: PDFFont;

beforeAll(async () => {
  const document = await PDFDocument.create();
  font = await document.embedFont(StandardFonts.Helvetica);
});

describe('PDF text helpers', () => {
  it('converts hex colours', () => {
    expect(hexToRgb('#FF8000')).toMatchObject({ red: 1, blue: 0 });
    expect(hexToRgb('#000000')).toMatchObject({ red: 0, green: 0, blue: 0 });
  });

  it('keeps Latin text and replaces what the font cannot draw', () => {
    expect(toDrawable('Zoë café, naïve', font)).toBe('Zoë café, naïve');
    expect(toDrawable('山田 signs', font)).toBe('?? signs');
    expect(toDrawable('a\tb\r\nc', font)).toBe('a b\nc');
    expect(toDrawable('ok 👍', font)).toBe('ok ?');
  });

  it('wraps on spaces and keeps every word', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the old timber workbench';
    const lines = wrapText(text, font, 10, 120);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(120);
  });

  it('splits a word that is wider than the line', () => {
    const lines = wrapText('x'.repeat(200), font, 10, 100);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join('')).toBe('x'.repeat(200));
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(100);
  });

  it('keeps blank lines between paragraphs', () => {
    expect(wrapText('one\n\ntwo', font, 10, 200)).toEqual(['one', '', 'two']);
  });
});

describe('renderRequestPdf', () => {
  const now = new Date('2025-06-02T09:00:00Z');
  const input: PdfInput = {
    workspace: { id: 'w', name: 'Fernhill Makerspace', accentColor: '#0F5C5C' },
    request: {
      id: 'r',
      workspaceId: 'w',
      templateVersionId: 'v',
      title: 'Bench sign-off',
      message: '',
      expiresAt: now,
      completedAt: null,
      revokedAt: null,
      createdAt: now,
      signerCount: 2,
      signedCount: 1,
    },
    status: 'PARTLY_SIGNED',
    version: {
      id: 'v',
      workspaceId: 'w',
      templateId: 't',
      number: 3,
      title: 'Bench agreement',
      description: 'A short description.',
      draftRevision: 4,
      publishedAt: now,
      fields: [
        field('h', 'heading', 'Rules'),
        field('p', 'paragraph', '', { body: 'Keep the bench tidy. '.repeat(400) }),
        field('c', 'checkbox', 'I agree', { assignedTo: 's1' }),
        field('t', 'longText', 'Notes', { assignedTo: 's1' }),
        field('d', 'date', 'Checked on', { assignedTo: 's2' }),
        field('s1', 'signature', 'Member'),
        field('s2', 'signature', 'Steward'),
      ],
    },
    signers: [
      {
        id: 'a',
        workspaceId: 'w',
        requestId: 'r',
        blockId: 's1',
        label: 'Member',
        name: 'Zoë 山田',
        email: 'zoe@example.com',
        viewedAt: now,
        signedAt: now,
        signature: {
          kind: 'drawn',
          strokes: [
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          ],
        },
        answers: { c: 'true', t: 'Ünïcödé and 日本語 and a\ttab' },
      },
      {
        id: 'b',
        workspaceId: 'w',
        requestId: 'r',
        blockId: 's2',
        label: 'Steward',
        name: 'Sol Steward',
        email: 'sol@example.com',
        viewedAt: null,
        signedAt: null,
        signature: null,
        answers: {},
      },
    ],
    events: [
      {
        requestId: 'r',
        seq: 1,
        kind: 'created',
        actor: 'user:u',
        detail: {},
        occurredAt: now,
        prevHash: '0'.repeat(64),
        hash: 'a'.repeat(64),
      },
      {
        requestId: 'r',
        seq: 2,
        kind: 'some_future_kind',
        actor: 'signer:a',
        detail: {},
        occurredAt: now,
        prevHash: 'a'.repeat(64),
        hash: 'b'.repeat(64),
      },
    ],
    actorNames: new Map([['user:u', 'Mira Okafor']]),
    history: { intact: true, checkedEvents: 2, problem: null },
    generatedAt: now,
  };

  it('produces a multi-page document that a PDF reader can open', async () => {
    const bytes = await renderRequestPdf(input);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe('Bench sign-off');
    expect(document.getCreator()).toBe('Signoff Ledger');
  });

  it('handles a typed signature, a very long name and a failed history check', async () => {
    const [member, steward] = input.signers;
    if (!member || !steward) throw new Error('fixture is missing signers');
    const bytes = await renderRequestPdf({
      ...input,
      version: { ...input.version, description: '' },
      signers: [
        { ...member, signature: { kind: 'typed', text: 'A very long typed name '.repeat(6) } },
        steward,
      ],
      history: { intact: false, checkedEvents: 2, problem: 'Event 2 does not fit the chain.' },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it('renders a document with no signers named at all', async () => {
    const bytes = await renderRequestPdf({ ...input, signers: [], events: [] });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
