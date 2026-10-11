'use client';
import { ReactNode, useEffect, useId, useRef } from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * A dialog over the page. Built on the browser's own <dialog>, which traps
 * focus, closes on Esc and puts focus back on the button that opened it.
 */
export function Modal({ open, onClose, title, children, actions }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Buttons along the bottom, e.g. Cancel and Save. */
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      // Esc closes the dialog natively; tell the page. A close we asked for ourselves isn't reported twice.
      onClose={() => open && onClose()}
      // A click on the backdrop lands on the dialog itself, not on what is inside it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t.common.close} onClick={onClose}>✕</button>
        </div>
        {open && children}
        {actions && <div className="form-actions">{actions}</div>}
      </div>
    </dialog>
  );
}
