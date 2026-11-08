import { useId } from 'react';
import type { ReactNode } from 'react';
import { isInputKind } from '../../shared/fields';
import type { Signature, TemplateField } from '../../shared/fields';
import { formatDateTime } from '../lib/format';
import { SignatureView } from './signature';
import { Field } from './ui';
import type { ControlProps } from './ui';

export interface DocumentParty {
  blockId: string;
  label: string;
  name: string | null;
  signedAt: string | null;
  signature: Signature | null;
}

interface DocumentFormProps {
  fields: readonly TemplateField[];
  parties: readonly DocumentParty[];
  /** Every answer known so far: other signers' submitted ones and your own draft. */
  answers: Readonly<Record<string, string>>;
  /** The signature block whose inputs can be edited, or null for a read-only copy. */
  editableBlockId: string | null;
  issues?: ReadonlyMap<string, readonly string[]>;
  onAnswer?: (fieldId: string, value: string) => void;
  /** Rendered inside the editable signature block (the signature controls). */
  signatureSlot?: ReactNode;
}

/**
 * Renders a template version as a document. The same component draws the
 * builder preview, the public signing form and the read-only signed copy, so
 * what an editor previews is what a signer gets.
 */
export function DocumentForm({
  fields,
  parties,
  answers,
  editableBlockId,
  issues = new Map(),
  onAnswer,
  signatureSlot,
}: DocumentFormProps) {
  const partyByBlock = new Map(parties.map((party) => [party.blockId, party]));
  const labelOfBlock = new Map(
    fields.filter((field) => field.kind === 'signature').map((field) => [field.id, field.label]),
  );

  return (
    <div className="document">
      {fields.map((field) => {
        if (field.kind === 'heading') {
          return <h3 key={field.id}>{field.label || 'Untitled heading'}</h3>;
        }
        if (field.kind === 'paragraph') {
          return (
            <p key={field.id} className="document__paragraph">
              {field.body}
            </p>
          );
        }
        if (field.kind === 'signature') {
          const party = partyByBlock.get(field.id);
          const editable = field.id === editableBlockId;
          return (
            <section key={field.id} className="document__party stack stack--tight">
              <p className="eyebrow">{field.label || 'Unnamed signer'}</p>
              {party?.name ? <p>{party.name}</p> : null}
              {party?.signature ? (
                <>
                  <SignatureView signature={party.signature} name={party.name ?? field.label} />
                  {party.signedAt ? (
                    <p className="muted small">Signed {formatDateTime(party.signedAt)}</p>
                  ) : null}
                </>
              ) : editable ? (
                signatureSlot
              ) : (
                <p className="muted small">Not signed yet</p>
              )}
              {(issues.get(field.id) ?? []).map((message) => (
                <p key={message} className="field__error">
                  {message}
                </p>
              ))}
            </section>
          );
        }
        if (!isInputKind(field.kind)) return null;

        const editable = editableBlockId !== null && field.assignedTo === editableBlockId;
        const value = answers[field.id] ?? '';
        if (!editable) {
          return (
            <ReadOnlyAnswer
              key={field.id}
              field={field}
              value={answers[field.id]}
              assignee={field.assignedTo ? labelOfBlock.get(field.assignedTo) : undefined}
            />
          );
        }
        return (
          <EditableAnswer
            key={field.id}
            field={field}
            value={value}
            errors={issues.get(field.id) ?? []}
            onChange={(next) => onAnswer?.(field.id, next)}
          />
        );
      })}
    </div>
  );
}

function ReadOnlyAnswer({
  field,
  value,
  assignee,
}: {
  field: TemplateField;
  value: string | undefined;
  assignee: string | undefined;
}) {
  let shown: string;
  if (value === undefined) shown = assignee ? `To be completed by ${assignee}` : 'Not assigned yet';
  else if (field.kind === 'checkbox') shown = value === 'true' ? 'Ticked' : 'Not ticked';
  else shown = value === '' ? 'Left empty' : value;

  return (
    <div className="stack stack--tight">
      <p className="field__label">
        {field.label || 'Untitled field'}
        {field.required ? <span className="muted"> (required)</span> : null}
      </p>
      <p
        className={
          value === undefined || value === '' ? 'document__answer muted' : 'document__answer'
        }
      >
        {shown}
      </p>
    </div>
  );
}

function EditableAnswer({
  field,
  value,
  errors,
  onChange,
}: {
  field: TemplateField;
  value: string;
  errors: readonly string[];
  onChange: (value: string) => void;
}) {
  const label = (
    <>
      {field.label}
      {field.required ? <span className="muted"> (required)</span> : null}
    </>
  );

  if (field.kind === 'checkbox') {
    return (
      <CheckboxAnswer field={field} value={value} errors={errors} onChange={onChange}>
        {label}
      </CheckboxAnswer>
    );
  }

  const control = (props: ControlProps): ReactNode => {
    switch (field.kind) {
      case 'longText':
        return (
          <textarea
            {...props}
            className="textarea"
            value={value}
            required={field.required}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        );
      case 'choice':
        return (
          <select
            {...props}
            className="select"
            value={value}
            required={field.required}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          >
            <option value="">Choose…</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      default:
        return (
          <input
            {...props}
            className="input"
            type={field.kind === 'date' ? 'date' : 'text'}
            value={value}
            required={field.required}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        );
    }
  };

  return (
    <Field label={label} hint={field.body} errors={errors}>
      {control}
    </Field>
  );
}

/** A checkbox wraps its own label, so it does not use the stacked Field layout. */
function CheckboxAnswer({
  field,
  value,
  errors,
  onChange,
  children,
}: {
  field: TemplateField;
  value: string;
  errors: readonly string[];
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const errorId = useId();
  return (
    <div className="field">
      <label className="check">
        <input
          type="checkbox"
          checked={value === 'true'}
          required={field.required}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length > 0 ? errorId : undefined}
          onChange={(event) => {
            onChange(event.target.checked ? 'true' : 'false');
          }}
        />
        <span>{children}</span>
      </label>
      {field.body ? <span className="field__hint">{field.body}</span> : null}
      {errors.length > 0 ? (
        <span className="field__error" id={errorId}>
          {errors.join(' ')}
        </span>
      ) : null}
    </div>
  );
}
