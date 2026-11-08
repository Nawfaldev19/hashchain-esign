import { z } from 'zod';
import { FIELD_KINDS, LIMITS } from '../../shared/fields';
import { invalid } from '../domain/errors';

/**
 * Input schemas for everything that crosses the API edge. GraphQL already checks
 * types; these check meaning (lengths, formats, ranges) before any query runs.
 */

const fieldSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'must be a short identifier'),
  kind: z.enum(FIELD_KINDS),
  label: z.string().max(LIMITS.labelLength),
  body: z.string().max(LIMITS.bodyLength).nullable(),
  required: z.boolean(),
  options: z.array(z.string().max(LIMITS.optionLength)).max(LIMITS.optionsPerChoice),
  assignedTo: z.string().max(40).nullable(),
});

export const newTemplateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
});

export const draftSchema = newTemplateSchema.extend({
  fields: z.array(fieldSchema).max(LIMITS.fieldsPerTemplate),
  expectedRevision: z.number().int().positive(),
});

export const newRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(1000),
  expiresInDays: z.number().int().min(1).max(90),
  signers: z
    .array(
      z.object({
        blockId: z.string().min(1).max(40),
        name: z.string().trim().min(1).max(80),
        email: z.email().max(200),
      }),
    )
    .min(1)
    .max(LIMITS.fieldsPerTemplate),
});

export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a colour like #0F5C5C'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
});

const pointSchema = z.object({ x: z.number(), y: z.number() });

export const submissionSchema = z.object({
  answers: z
    .array(
      z.object({ fieldId: z.string().max(40), value: z.string().max(LIMITS.longTextAnswerLength) }),
    )
    .max(LIMITS.fieldsPerTemplate),
  signature: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('typed'), text: z.string().max(LIMITS.typedSignatureLength * 2) }),
    z.object({
      kind: z.literal('drawn'),
      strokes: z
        .array(z.array(pointSchema).max(LIMITS.pointsPerSignature))
        .max(LIMITS.strokesPerSignature * 2),
    }),
  ]),
});

/** Parses input or throws a VALIDATION error that names each failing path. */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw invalid(
    'Some of the input is not valid.',
    result.error.issues.map((issue) => ({
      fieldId: null,
      message: `${issue.path.join('.') || 'input'}: ${issue.message}`,
    })),
  );
}
