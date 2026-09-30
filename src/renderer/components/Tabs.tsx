import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Codicon } from './Codicon';

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  iconColor?: string;
  /** Contenido extra tras la etiqueta (p. ej. botón de fijar). */
  extra?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/** Pestañas planas con subrayado (estilo de los paneles de VS Code). Flechas ←/→ cambian de pestaña. */
export function Tabs({ items, activeId, onChange, ariaLabel }: TabsProps): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number): void => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + items.length) % items.length;
    onChange(items[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const selected = item.id === activeId;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={['tab', selected ? 'is-active' : ''].join(' ')}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {item.icon && <Codicon name={item.icon} size={14} color={item.iconColor} />}
            <span>{item.label}</span>
            {item.extra}
          </button>
        );
      })}
    </div>
  );
}
