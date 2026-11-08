import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { isInputKind } from '../../../shared/fields';
import type { TemplateField } from '../../../shared/fields';
import { Button, Field } from '../../components/ui';
import { KIND_LABELS } from './builder-state';
import type { BuilderAction } from './builder-state';

interface FieldCardProps {
  field: TemplateField;
  position: number;
  total: number;
  signatureBlocks: readonly TemplateField[];
  issues: readonly string[];
  disabled: boolean;
  dispatch: (action: BuilderAction) => void;
}

const LABEL_NAMES: Partial<Record<TemplateField['kind'], string>> = {
  heading: 'Heading text',
  signature: 'Signer label',
};

/** One field of the draft, with the controls that make sense for its kind. */
export function FieldCard({
  field,
  position,
  total,
  signatureBlocks,
  issues,
  disabled,
  dispatch,
}: FieldCardProps) {
  const change = (patch: Partial<Omit<TemplateField, 'id' | 'kind'>>): void => {
    dispatch({ type: 'fieldChanged', id: field.id, patch });
  };
  const name = field.label.trim() || KIND_LABELS[field.kind];
  const isInput = isInputKind(field.kind);

  return (
    <li
      className={issues.length > 0 ? 'field-card field-card--invalid' : 'field-card'}
      aria-label={`Field ${String(position + 1)}: ${name}`}
    >
      <div className="row row--between">
        <span className="kind-chip">{KIND_LABELS[field.kind]}</span>
        <div className="row">
          <Button
            variant="quiet"
            iconOnly
            disabled={disabled || position === 0}
            aria-label={`Move ${name} up`}
            onClick={() => {
              dispatch({ type: 'fieldMoved', id: field.id, direction: -1 });
            }}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="quiet"
            iconOnly
            disabled={disabled || position === total - 1}
            aria-label={`Move ${name} down`}
            onClick={() => {
              dispatch({ type: 'fieldMoved', id: field.id, direction: 1 });
            }}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            variant="quiet"
            iconOnly
            disabled={disabled}
            aria-label={`Remove ${name}`}
            onClick={() => {
              dispatch({ type: 'fieldRemoved', id: field.id });
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      {field.kind === 'paragraph' ? (
        <Field label="Paragraph text">
          {(control) => (
            <textarea
              {...control}
              className="textarea"
              disabled={disabled}
              value={field.body ?? ''}
              onChange={(event) => {
                change({ body: event.target.value });
              }}
            />
          )}
        </Field>
      ) : (
        <Field label={LABEL_NAMES[field.kind] ?? 'Question'}>
          {(control) => (
            <input
              {...control}
              className="input"
              disabled={disabled}
              value={field.label}
              onChange={(event) => {
                change({ label: event.target.value });
              }}
            />
          )}
        </Field>
      )}

      {field.kind === 'choice' ? (
        <fieldset className="stack stack--tight" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">Options</legend>
          {field.options.map((option, index) => (
            <div key={index} className="row">
              <input
                className="input grow"
                aria-label={`Option ${String(index + 1)}`}
                disabled={disabled}
                value={option}
                onChange={(event) => {
                  change({
                    options: field.options.map((current, at) =>
                      at === index ? event.target.value : current,
                    ),
                  });
                }}
              />
              <Button
                variant="quiet"
                iconOnly
                disabled={disabled || field.options.length <= 2}
                aria-label={`Remove option ${String(index + 1)}`}
                onClick={() => {
                  change({ options: field.options.filter((_, at) => at !== index) });
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              disabled={disabled}
              onClick={() => {
                change({ options: [...field.options, ''] });
              }}
            >
              <Plus aria-hidden="true" />
              Add option
            </Button>
          </div>
        </fieldset>
      ) : null}

      {isInput ? (
        <>
          <Field label="Help text (optional)">
            {(control) => (
              <input
                {...control}
                className="input"
                disabled={disabled}
                value={field.body ?? ''}
                onChange={(event) => {
                  change({ body: event.target.value === '' ? null : event.target.value });
                }}
              />
            )}
          </Field>
          <div className="row">
            <div className="grow">
              <Field label="Filled in by">
                {(control) => (
                  <select
                    {...control}
                    className="select"
                    disabled={disabled}
                    value={field.assignedTo ?? ''}
                    onChange={(event) => {
                      change({ assignedTo: event.target.value === '' ? null : event.target.value });
                    }}
                  >
                    <option value="">Choose a signer…</option>
                    {signatureBlocks.map((block) => (
                      <option key={block.id} value={block.id}>
                        {block.label.trim() || 'Unnamed signer'}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                disabled={disabled}
                checked={field.required}
                onChange={(event) => {
                  change({ required: event.target.checked });
                }}
              />
              <span>Required</span>
            </label>
          </div>
        </>
      ) : null}

      {issues.map((message) => (
        <p key={message} className="field__error">
          {message}
        </p>
      ))}
    </li>
  );
}
