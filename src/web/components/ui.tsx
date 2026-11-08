import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CircleAlert, Inbox } from 'lucide-react';

type ButtonVariant = 'default' | 'primary' | 'danger' | 'quiet';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows that work is in progress and blocks a second click. */
  busy?: boolean;
  iconOnly?: boolean;
}

export function Button({
  variant = 'default',
  busy = false,
  iconOnly = false,
  className = '',
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'button',
    variant === 'default' ? '' : `button--${variant}`,
    iconOnly ? 'button--icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled === true || busy}
      aria-busy={busy}
    >
      {children}
    </button>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | 'accent';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>{children}</span>;
}

export function Banner({
  tone,
  children,
  role = 'status',
}: {
  tone: 'danger' | 'success' | 'warning';
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`banner banner--${tone}`} role={role}>
      {children}
    </div>
  );
}

/** Grey bars shown while content loads, sized like the text they stand in for. */
export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="skeleton"
          style={{ width: `${String(92 - ((index * 17) % 40))}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <Inbox aria-hidden="true" />
      <h2>{title}</h2>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <CircleAlert aria-hidden="true" />
      <h2>{title}</h2>
      <p className="muted">{message}</p>
      {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean;
}

/**
 * A label, optional hint and error messages wired to one control. The control
 * is passed as a function so it receives the ids that tie everything together
 * for screen readers.
 */
export function Field({
  label,
  hint,
  errors = [],
  children,
}: {
  label: ReactNode;
  hint?: string | null;
  errors?: readonly string[];
  children: (control: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : null;
  const errorId = errors.length > 0 ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': errors.length > 0,
      })}
      {hint && hintId ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {errorId ? (
        <span className="field__error" id={errorId}>
          {errors.join(' ')}
        </span>
      ) : null}
    </div>
  );
}

export function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
