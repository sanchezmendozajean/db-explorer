import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { es } from '../i18n/es';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Borde superior de 3 px de color (p. ej. rojo en confirmaciones de Producción). */
  accentColor?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Diálogo modal: Esc cierra, el foco queda atrapado dentro y vuelve al cerrar. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
  accentColor,
}: ModalProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first =
      el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width, borderTop: accentColor ? `3px solid ${accentColor}` : undefined }}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="close" label={es.dialogs.close} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
