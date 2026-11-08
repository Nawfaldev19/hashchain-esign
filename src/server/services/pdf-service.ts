import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { isInputKind } from '../../shared/fields';
import type { Signature, TemplateField } from '../../shared/fields';
import { STATUS_LABELS } from '../../shared/status';
import type { RequestStatus } from '../../shared/status';
import type { StoredEvent } from '../domain/history';
import type { HistoryCheck } from './request-service';
import type {
  RequestRecord,
  SignerRecord,
  TemplateVersionRecord,
  WorkspaceRecord,
} from './records';

/**
 * Builds the signed copy of a request as a PDF: the document with everyone's
 * answers and signatures, followed by the event history.
 *
 * The standard PDF fonts are used, which keeps the file small and needs no font
 * files, but they only cover Latin text. Characters outside that set are shown
 * as "?" in the PDF (the stored answer is untouched). This limit is documented
 * in the README.
 */

export interface PdfInput {
  workspace: WorkspaceRecord;
  request: RequestRecord;
  status: RequestStatus;
  version: TemplateVersionRecord;
  signers: SignerRecord[];
  events: StoredEvent[];
  actorNames: ReadonlyMap<string, string>;
  history: HistoryCheck;
  generatedAt: Date;
}

const PAGE = { width: 595.28, height: 841.89, margin: 56 } as const;
const INK = rgb(0.12, 0.16, 0.18);
const MUTED = rgb(0.34, 0.38, 0.4);
const RULE = rgb(0.85, 0.81, 0.75);

export function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Replaces characters the font cannot draw, so one odd character never fails the export. */
export function toDrawable(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  let result = '';
  for (const char of text.replace(/\t/g, ' ').replace(/\r/g, '')) {
    const code = char.codePointAt(0) ?? 0;
    result += char === '\n' || supported.has(code) ? char : '?';
  }
  return result;
}

/** Breaks text into lines no wider than maxWidth, splitting overlong words. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let piece = word;
      while (font.widthOfTextAtSize(piece, size) > maxWidth && piece.length > 1) {
        let cut = piece.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > maxWidth) cut -= 1;
        if (line !== '') lines.push(line);
        lines.push(piece.slice(0, cut));
        line = '';
        piece = piece.slice(cut);
      }
      const candidate = line === '' ? piece : `${line} ${piece}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = piece;
      }
    }
    lines.push(line);
  }
  return lines;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

/** A top-to-bottom writer that starts a new page when the current one is full. */
class Writer {
  private page: PDFPage;
  private y: number;
  readonly contentWidth = PAGE.width - PAGE.margin * 2;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  ensureSpace(height: number): void {
    if (this.y - height >= PAGE.margin + 24) return;
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  gap(height: number): void {
    this.y -= height;
  }

  text(
    content: string,
    options: { font?: PDFFont; size?: number; color?: RGB; indent?: number } = {},
  ): void {
    const font = options.font ?? this.fonts.regular;
    const size = options.size ?? 10.5;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.45;
    const lines = wrapText(toDrawable(content, font), font, size, this.contentWidth - indent);
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.y -= lineHeight;
      this.page.drawText(line, {
        x: PAGE.margin + indent,
        y: this.y,
        size,
        font,
        color: options.color ?? INK,
      });
    }
  }

  rule(color: RGB = RULE, thickness = 0.75): void {
    this.ensureSpace(12);
    this.y -= 8;
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness,
      color,
    });
    this.y -= 4;
  }

  signatureBox(signature: Signature | null, height = 64): void {
    const width = 230;
    this.ensureSpace(height + 8);
    this.y -= height + 4;
    const origin = { x: PAGE.margin, y: this.y };
    this.page.drawRectangle({
      x: origin.x,
      y: origin.y,
      width,
      height,
      borderColor: RULE,
      borderWidth: 0.75,
    });
    if (signature === null) return;

    if (signature.kind === 'typed') {
      const font = this.fonts.italic;
      const text = toDrawable(signature.text, font);
      let size = 24;
      while (size > 9 && font.widthOfTextAtSize(text, size) > width - 16) size -= 1;
      this.page.drawText(text, {
        x: origin.x + 8,
        y: origin.y + height / 2 - size / 3,
        size,
        font,
      });
      return;
    }
    const inset = 6;
    for (const stroke of signature.strokes) {
      for (let index = 1; index < stroke.length; index += 1) {
        const from = stroke[index - 1];
        const to = stroke[index];
        if (!from || !to) continue;
        this.page.drawLine({
          start: {
            x: origin.x + inset + from.x * (width - inset * 2),
            y: origin.y + inset + (1 - from.y) * (height - inset * 2),
          },
          end: {
            x: origin.x + inset + to.x * (width - inset * 2),
            y: origin.y + inset + (1 - to.y) * (height - inset * 2),
          },
          thickness: 1.2,
          color: INK,
        });
      }
    }
  }
}

const formatTime = (date: Date): string =>
  `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function describeAnswer(field: TemplateField, value: string | undefined): string {
  if (field.kind === 'checkbox') return value === 'true' ? '[x] Ticked' : '[ ] Not ticked';
  return value === undefined || value === '' ? '(left empty)' : value;
}

const EVENT_PHRASES: Readonly<Record<string, string>> = {
  created: 'Request created',
  viewed: 'Link opened',
  signed: 'Signed',
  completed: 'All signatures collected',
  revoked: 'Request revoked',
  link_reissued: 'New link issued',
};

export async function renderRequestPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  doc.setTitle(input.request.title);
  doc.setCreator('Signoff Ledger');
  doc.setProducer('Signoff Ledger');
  doc.setCreationDate(input.generatedAt);

  const accent = hexToRgb(input.workspace.accentColor);
  const writer = new Writer(doc, fonts);
  const signerByBlock = new Map(input.signers.map((signer) => [signer.blockId, signer]));
  const answers: Record<string, string> = {};
  for (const signer of input.signers) Object.assign(answers, signer.answers);

  writer.text(input.workspace.name.toUpperCase(), { font: fonts.bold, size: 9, color: accent });
  writer.text(input.version.title, { font: fonts.bold, size: 20 });
  writer.text(
    `${input.request.title}  |  version ${input.version.number}  |  ${STATUS_LABELS[input.status]}`,
    { size: 9.5, color: MUTED },
  );
  writer.rule(accent, 1.5);
  if (input.version.description !== '') {
    writer.text(input.version.description, { color: MUTED });
    writer.gap(6);
  }

  for (const field of input.version.fields) {
    if (field.kind === 'heading') {
      writer.gap(10);
      writer.text(field.label, { font: fonts.bold, size: 13.5 });
    } else if (field.kind === 'paragraph') {
      writer.gap(4);
      writer.text(field.body ?? '');
    } else if (field.kind === 'signature') {
      const signer = signerByBlock.get(field.id);
      writer.gap(12);
      writer.text(field.label, { font: fonts.bold, size: 10.5 });
      writer.signatureBox(signer?.signature ?? null);
      writer.text(
        signer?.signedAt
          ? `${signer.name}, signed ${formatTime(signer.signedAt)}`
          : `${signer?.name ?? 'Nobody named'}, not signed`,
        { size: 9, color: MUTED },
      );
    } else if (isInputKind(field.kind)) {
      writer.gap(8);
      writer.text(field.label, { font: fonts.bold, size: 9.5, color: MUTED });
      writer.text(describeAnswer(field, answers[field.id]), { indent: 8 });
    }
  }

  writer.gap(24);
  writer.rule();
  writer.text('History', { font: fonts.bold, size: 13.5 });
  writer.text(
    input.history.intact
      ? `Checked ${input.history.checkedEvents} events when this file was made: the history is intact.`
      : `Warning: ${input.history.problem ?? 'the history check failed.'}`,
    { size: 9.5, color: MUTED },
  );
  writer.gap(4);
  for (const event of input.events) {
    const phrase = EVENT_PHRASES[event.kind] ?? event.kind;
    const actor = input.actorNames.get(event.actor) ?? 'Signoff Ledger';
    writer.gap(4);
    writer.text(`${event.seq}. ${phrase} (${actor})`, { size: 10 });
    writer.text(`${formatTime(event.occurredAt)}   ${event.hash.slice(0, 24)}`, {
      font: fonts.mono,
      size: 8,
      color: MUTED,
      indent: 14,
    });
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawText(
      toDrawable(
        `Made by Signoff Ledger on ${formatTime(input.generatedAt)}  |  page ${index + 1} of ${pages.length}`,
        fonts.regular,
      ),
      { x: PAGE.margin, y: PAGE.margin - 18, size: 8, font: fonts.regular, color: MUTED },
    );
  });
  return doc.save();
}
