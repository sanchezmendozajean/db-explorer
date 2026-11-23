import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionConfig } from '@shared/connection';
import { connectionAddress } from '@shared/connection';
import { IconButton } from './Button';
import { Codicon } from './Codicon';
import { dotStyle } from './env-dot';
import { es } from '../i18n/es';

export type ModalIntent = 'info' | 'warning' | 'danger' | 'success';

export interface ModalProps {
  title: string;
  /** Nombre de Codicon del encabezado. Obligatorio: todo modal muestra un ícono. */
  icon: string;
  /** Color del encabezado. Por defecto 'info'. */
  intent?: ModalIntent;
  /** Línea secundaria en texto libre. Se ignora si se pasa `connection`. */
  subtitle?: string;
  /**
   * Contexto de conexión: dibuja en el subtítulo el punto de entorno, el nombre,
   * la base (si se indica) y la dirección, y agrega el chip QA/PROD.
   */
  connection?: { config: ConnectionConfig; database?: string; showAddress?: boolean };
  /** Si es false, se oculta el botón cerrar y Esc / clic fuera no cierran. Por defecto true. */
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Clase adicional para el cuerpo del diálogo. */
  bodyClassName?: string;
  /** Si es false, un clic fuera del diálogo no lo cierra (Esc y el botón de cierre siguen funcionando). */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Diálogo modal: Esc cierra, el foco queda atrapado dentro y vuelve al cerrar. */
export function Modal({
  title,
  icon,
  intent = 'info',
  subtitle,
  connection,
  dismissible = true,
  onClose,
  children,
  footer,
  width = 480,
  bodyClassName,
  closeOnBackdrop = true,
}: ModalProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();

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
      if (dismissible) onClose();
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

  const env = connection?.config.environment;
  const chip = env === 'prod' ? es.dialogs.envChip.prod : env === 'qa' ? es.dialogs.envChip.qa : null;
  const hasSubtitle = !!connection || !!subtitle;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => dismissible && closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={`modal is-${intent}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasSubtitle ? subtitleId : undefined}
        tabIndex={-1}
        style={{ width }}
        onKeyDown={onKeyDown}
      >
        <div className="modal-header">
          <span className="modal-icon" aria-hidden="true">
            <Codicon name={icon} size={18} />
          </span>
          <div className="modal-heading">
            <h2 id={titleId}>{title}</h2>
            {connection ? (
              <div className="modal-subtitle" id={subtitleId}>
                <span
                  className="env-dot"
                  style={dotStyle(connection.config.color ?? `var(--env-${connection.config.environment})`)}
                />
                <span className="modal-subtitle-name" data-testid="modal-connection">
                  {connection.config.name}
                </span>
                {connection.database && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span data-testid="modal-database">{connection.database}</span>
                  </>
                )}
                {(connection.showAddress ?? true) && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="modal-subtitle-address">{connectionAddress(connection.config)}</span>
                  </>
                )}
              </div>
            ) : (
              subtitle && (
                <div className="modal-subtitle" id={subtitleId}>
                  {subtitle}
                </div>
              )
            )}
          </div>
          {chip && <span className={`modal-env-chip is-${env}`}>{chip}</span>}
          {dismissible && <IconButton icon="close" label={es.dialogs.close} onClick={onClose} />}
        </div>
        <div className={bodyClassName ? `modal-body ${bodyClassName}` : 'modal-body'}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
