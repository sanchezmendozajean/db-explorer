import { useToastStore } from '../stores/toast-store';
import type { ToastSeverity } from '../stores/toast-store';
import { Codicon } from './Codicon';
import { IconButton } from './Button';
import { es } from '../i18n/es';

const ICONS: Record<ToastSeverity, { name: string; color: string }> = {
  info: { name: 'info', color: 'var(--link)' },
  success: { name: 'pass', color: 'var(--success)' },
  warning: { name: 'warning', color: 'var(--warning)' },
  error: { name: 'error', color: 'var(--error)' },
};

/** Notificaciones apiladas abajo a la derecha (specs/04 §14). */
export function Toasts(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toasts" role="region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role={t.severity === 'error' ? 'alert' : 'status'}>
          <Codicon name={ICONS[t.severity].name} color={ICONS[t.severity].color} />
          <div className="toast-body">
            <div className="toast-message">{t.message}</div>
            {t.actions && t.actions.length > 0 && (
              <div className="toast-actions">
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      dismiss(t.id);
                      a.run();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <IconButton icon="close" label={es.toasts.close} onClick={() => dismiss(t.id)} size={14} />
        </div>
      ))}
    </div>
  );
}
