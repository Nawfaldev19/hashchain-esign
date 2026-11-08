/**
 * The field model of an agreement template, shared by the API and the web app so
 * that both sides validate with exactly the same rules.
 */

export const FIELD_KINDS = [
  'heading',
  'paragraph',
  'text',
  'longText',
  'checkbox',
  'date',
  'choice',
  'signature',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export interface TemplateField {
  /** Stable within one template. Answers and signer assignments refer to it. */
  id: string;
  kind: FieldKind;
  /** Heading text, question label, or the signer label of a signature block. */
  label: string;
  /** Paragraph text, or help text shown under an input. */
  body: string | null;
  /** Only meaningful for input kinds. */
  required: boolean;
  /** Only meaningful for the "choice" kind. */
  options: string[];
  /** For input kinds: the id of the signature block whose signer fills this in. */
  assignedTo: string | null;
}

export const LIMITS = {
  fieldsPerTemplate: 60,
  labelLength: 200,
  bodyLength: 4000,
  optionsPerChoice: 12,
  optionLength: 80,
  textAnswerLength: 300,
  longTextAnswerLength: 4000,
  typedSignatureLength: 80,
  strokesPerSignature: 120,
  pointsPerSignature: 4000,
} as const;

const INPUT_KINDS: ReadonlySet<FieldKind> = new Set([
  'text',
  'longText',
  'checkbox',
  'date',
  'choice',
]);

export function isInputKind(kind: FieldKind): boolean {
  return INPUT_KINDS.has(kind);
}

export function signatureBlocks(fields: readonly TemplateField[]): TemplateField[] {
  return fields.filter((field) => field.kind === 'signature');
}

export interface FieldIssue {
  /** Null when the problem concerns the template as a whole. */
  fieldId: string | null;
  message: string;
}

/**
 * Checks that a set of fields can be published as a version. A draft may break
 * these rules while it is being edited; a published version never does.
 */
export function validateForPublishing(fields: readonly TemplateField[]): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const blocks = signatureBlocks(fields);
  const blockIds = new Set(blocks.map((block) => block.id));

  if (fields.length === 0) {
    issues.push({ fieldId: null, message: 'Add at least one field before publishing.' });
  }
  if (fields.length > LIMITS.fieldsPerTemplate) {
    issues.push({
      fieldId: null,
      message: `A template can hold at most ${LIMITS.fieldsPerTemplate} fields.`,
    });
  }
  if (fields.length > 0 && blocks.length === 0) {
    issues.push({ fieldId: null, message: 'Add at least one signature block.' });
  }

  const seenIds = new Set<string>();
  const seenBlockLabels = new Set<string>();
  for (const field of fields) {
    if (seenIds.has(field.id)) {
      issues.push({ fieldId: field.id, message: 'Two fields share the same id.' });
    }
    seenIds.add(field.id);

    const label = field.label.trim();
    if (field.kind !== 'paragraph' && label === '') {
      issues.push({ fieldId: field.id, message: 'Give this field a label.' });
    }
    if (field.kind === 'paragraph' && (field.body ?? '').trim() === '') {
      issues.push({ fieldId: field.id, message: 'Write the paragraph text.' });
    }

    if (field.kind === 'signature') {
      const key = label.toLocaleLowerCase();
      if (label !== '' && seenBlockLabels.has(key)) {
        issues.push({ fieldId: field.id, message: 'Signer labels must be different.' });
      }
      seenBlockLabels.add(key);
    }

    if (field.kind === 'choice') {
      const options = field.options.map((option) => option.trim());
      if (options.length < 2) {
        issues.push({ fieldId: field.id, message: 'A choice needs at least two options.' });
      }
      if (options.some((option) => option === '')) {
        issues.push({ fieldId: field.id, message: 'Options cannot be empty.' });
      }
      if (new Set(options).size !== options.length) {
        issues.push({ fieldId: field.id, message: 'Options must be different.' });
      }
    }

    if (isInputKind(field.kind)) {
      if (field.assignedTo === null || !blockIds.has(field.assignedTo)) {
        issues.push({ fieldId: field.id, message: 'Choose which signer fills this in.' });
      }
    }
  }
  return issues;
}

export type Answers = Readonly<Record<string, string>>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Validates what one signer submitted against the fields assigned to their
 * signature block. Answers to anybody else's fields are rejected, not ignored,
 * so that a tampered request cannot write into another signer's part.
 */
export function validateAnswers(
  fields: readonly TemplateField[],
  blockId: string,
  answers: Answers,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const byId = new Map(fields.map((field) => [field.id, field]));

  for (const fieldId of Object.keys(answers)) {
    const field = byId.get(fieldId);
    if (!field || !isInputKind(field.kind) || field.assignedTo !== blockId) {
      issues.push({ fieldId, message: 'This field is not yours to fill in.' });
    }
  }

  for (const field of fields) {
    if (!isInputKind(field.kind) || field.assignedTo !== blockId) continue;
    const value = (answers[field.id] ?? '').trim();
    const issue = validateOneAnswer(field, value);
    if (issue !== null) issues.push({ fieldId: field.id, message: issue });
  }
  return issues;
}

function validateOneAnswer(field: TemplateField, value: string): string | null {
  if (field.kind === 'checkbox') {
    if (value !== '' && value !== 'true' && value !== 'false') return 'Tick or untick the box.';
    if (field.required && value !== 'true') return 'You need to tick this box to continue.';
    return null;
  }
  if (value === '') {
    return field.required ? 'This field is required.' : null;
  }
  switch (field.kind) {
    case 'text':
      return value.length > LIMITS.textAnswerLength
        ? `Keep this under ${LIMITS.textAnswerLength} characters.`
        : null;
    case 'longText':
      return value.length > LIMITS.longTextAnswerLength
        ? `Keep this under ${LIMITS.longTextAnswerLength} characters.`
        : null;
    case 'date':
      return isRealIsoDate(value) ? null : 'Enter a real date.';
    case 'choice':
      return field.options.includes(value) ? null : 'Pick one of the listed options.';
    default:
      return null;
  }
}

export interface Point {
  /** Horizontal position, 0 (left edge) to 1 (right edge) of the signature box. */
  x: number;
  /** Vertical position, 0 (top) to 1 (bottom). */
  y: number;
}

export type Signature = { kind: 'drawn'; strokes: Point[][] } | { kind: 'typed'; text: string };

/** Returns a message when the signature cannot be accepted, or null when it can. */
export function validateSignature(signature: Signature): string | null {
  if (signature.kind === 'typed') {
    const text = signature.text.trim();
    if (text === '') return 'Type your name to sign.';
    if (text.length > LIMITS.typedSignatureLength) {
      return `Keep the typed signature under ${LIMITS.typedSignatureLength} characters.`;
    }
    return null;
  }

  const strokes = signature.strokes.filter((stroke) => stroke.length > 1);
  if (strokes.length === 0) return 'Draw your signature to sign.';
  if (signature.strokes.length > LIMITS.strokesPerSignature)
    return 'The signature is too detailed.';
  const pointCount = signature.strokes.reduce((total, stroke) => total + stroke.length, 0);
  if (pointCount > LIMITS.pointsPerSignature) return 'The signature is too detailed.';
  const inBox = signature.strokes.every((stroke) =>
    stroke.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= 1 &&
        point.y >= 0 &&
        point.y <= 1,
    ),
  );
  return inBox ? null : 'The signature leaves the signing box.';
}

let fieldCounter = 0;

/** Makes an id that is unique within a template. Not a secret, only a handle. */
export function newFieldId(existing: readonly TemplateField[]): string {
  const taken = new Set(existing.map((field) => field.id));
  for (;;) {
    fieldCounter += 1;
    const id = `f_${Date.now().toString(36)}${fieldCounter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

export function blankField(kind: FieldKind, existing: readonly TemplateField[]): TemplateField {
  const firstBlock = signatureBlocks(existing)[0];
  return {
    id: newFieldId(existing),
    kind,
    label: '',
    body: null,
    required: isInputKind(kind),
    options: kind === 'choice' ? ['', ''] : [],
    assignedTo: isInputKind(kind) ? (firstBlock?.id ?? null) : null,
  };
}
