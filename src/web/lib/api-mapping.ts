import type { FieldKind, Signature, TemplateField } from '../../shared/fields';
import type { ResultOf } from '../graphql/tada';
import type { FieldParts, SignatureParts } from '../graphql/operations';

/**
 * GraphQL enum values are UPPER_CASE by convention; the shared field model uses
 * the camelCase names the server stores. These two tables are the only place
 * that knows both spellings.
 */
type ApiField = ResultOf<typeof FieldParts>;
type ApiSignature = ResultOf<typeof SignatureParts>;
type ApiKind = ApiField['kind'];

const KIND_FROM_API: Readonly<Record<ApiKind, FieldKind>> = {
  HEADING: 'heading',
  PARAGRAPH: 'paragraph',
  TEXT: 'text',
  LONG_TEXT: 'longText',
  CHECKBOX: 'checkbox',
  DATE: 'date',
  CHOICE: 'choice',
  SIGNATURE: 'signature',
};

const KIND_TO_API = Object.fromEntries(
  Object.entries(KIND_FROM_API).map(([api, kind]) => [kind, api]),
) as Readonly<Record<FieldKind, ApiKind>>;

export function fromApiField(field: ApiField): TemplateField {
  return {
    id: field.id,
    kind: KIND_FROM_API[field.kind],
    label: field.label,
    body: field.body,
    required: field.required,
    options: [...field.options],
    assignedTo: field.assignedTo,
  };
}

export function toApiField(field: TemplateField) {
  return {
    id: field.id,
    kind: KIND_TO_API[field.kind],
    label: field.label,
    body: field.body,
    required: field.required,
    options: field.options,
    assignedTo: field.assignedTo,
  };
}

export function fromApiSignature(signature: ApiSignature | null): Signature | null {
  if (signature === null) return null;
  return signature.kind === 'TYPED'
    ? { kind: 'typed', text: signature.text ?? '' }
    : { kind: 'drawn', strokes: signature.strokes.map((stroke) => stroke.points) };
}

export function toApiSignature(signature: Signature) {
  return signature.kind === 'typed'
    ? { kind: 'TYPED' as const, text: signature.text }
    : {
        kind: 'DRAWN' as const,
        strokes: signature.strokes.map((points) => ({ points })),
      };
}

export function answersToRecord(
  answers: readonly { fieldId: string; value: string }[],
): Record<string, string> {
  return Object.fromEntries(answers.map((answer) => [answer.fieldId, answer.value]));
}
