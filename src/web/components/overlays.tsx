import { createContext, use, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './ui';

/**
 * A modal built on the native <dialog> element, which traps focus, closes on
 * Escape and restores focus to the opener without extra code.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      {open ? (
        <div className="dialog__body">
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

interface Toast {
  id: number;
  message: string;
}

/** Short confirmations in a polite live region, so screen readers announce them. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): (message: string) => void {
  return use(ToastContext);
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast('Copied to the clipboard');
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      toast('Copying is blocked by the browser. Select the text and copy it by hand.');
    }
  };

  return (
    <Button
      onClick={() => {
        void copy();
      }}
      aria-label={label}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
