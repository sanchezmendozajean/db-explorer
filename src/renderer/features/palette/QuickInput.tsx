import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Codicon } from '../../components/Codicon';
import { commands, keybindingLabel } from '../../commands/service';
import { commandTitle, es } from '../../i18n/es';
import { useOverlayStore } from '../../stores/overlay-store';
import type { PickAnchor, QuickPick } from '../../stores/overlay-store';
import type { FileNode } from '@shared/workspace';
import { useFilesStore } from '../../stores/files-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { openScript } from '../editor/scripts';
import type { FuzzyMatch } from './fuzzy';
import { fuzzyMatch } from './fuzzy';

interface PickItem {
  id: string;
  label: string;
  icon: string;
  iconColor?: string;
  detail?: string;
  keybinding?: string;
  group?: string;
  match: FuzzyMatch;
  run: () => void;
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }): React.JSX.Element {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) parts.push(text.slice(pos, a));
    parts.push(
      <span key={i} className="match">
        {text.slice(a, b)}
      </span>,
    );
    pos = b;
  });
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

function commandItems(query: string): PickItem[] {
  const out: PickItem[] = [];
  for (const cmd of commands.all()) {
    if (cmd.hidden || !commands.isEnabled(cmd.id)) continue;
    const title = cmd.title ?? commandTitle(cmd.id);
    const label = cmd.category ? `${cmd.category}: ${title}` : title;
    const match = fuzzyMatch(query, label);
    if (!match) continue;
    out.push({
      id: cmd.id,
      label,
      icon: '',
      keybinding: keybindingLabel(cmd.id),
      match,
      run: () => void commands.execute(cmd.id),
    });
  }
  return out.sort((a, b) => b.match.score - a.match.score || a.label.localeCompare(b.label, 'es'));
}

/**
 * Ctrl+P: archivos del espacio de trabajo. La búsqueda de objetos de base de
 * datos (caché de metadatos) llega en M6.
 */
function quickOpenItems(query: string): PickItem[] {
  const root = useWorkspaceStore.getState().path;
  const files: PickItem[] = [];
  const walk = (nodes: FileNode[]): void => {
    for (const f of nodes) {
      if (f.dir) {
        walk(f.children ?? []);
        continue;
      }
      const match = fuzzyMatch(query, f.name);
      if (!match) continue;
      const dir = f.path.slice(root.length + 1, f.path.length - f.name.length - 1);
      files.push({
        id: `file:${f.path}`,
        label: f.name,
        icon: f.name.toLowerCase().endsWith('.sql') ? 'database' : 'file',
        iconColor: 'var(--icon-sql)',
        detail: dir,
        group: es.palette.groupFiles,
        match,
        run: () => openScript(f.path),
      });
    }
  };
  walk(useFilesStore.getState().nodes);
  return files.sort((a, b) => b.match.score - a.match.score);
}

function pickItems(pick: QuickPick, query: string): PickItem[] {
  const out: PickItem[] = [];
  for (const item of pick.items) {
    const match = fuzzyMatch(query, item.label);
    if (match) out.push({ ...item, icon: item.icon ?? '', match });
  }
  return query ? out.sort((a, b) => b.match.score - a.match.score) : out;
}

/** Ancho mínimo de una lista desplegable bajo un chip. */
const ANCHORED_MIN_WIDTH = 320;

/** Lista desplegable bajo el control que la abrió, sin salirse de la ventana. */
function anchoredStyle(anchor: PickAnchor): React.CSSProperties {
  const width = Math.min(Math.max(anchor.width, ANCHORED_MIN_WIDTH), window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return { left, top: anchor.top, width };
}

/** Paleta rápida (specs/04 §13): `>` = comandos; sin prefijo = objetos y archivos; o una lista de selección. */
export function QuickInput(): React.JSX.Element | null {
  const { open, initialValue, pick } = useOverlayStore((s) => s.palette);
  const close = useOverlayStore((s) => s.closePalette);
  if (!open) return null;
  return <QuickInputBox initialValue={initialValue} pick={pick} onClose={close} />;
}

function QuickInputBox({
  initialValue,
  pick,
  onClose,
}: {
  initialValue: string;
  pick: QuickPick | null;
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [active, setActive] = useState(() => Math.max(0, pick?.items.findIndex((i) => i.current) ?? 0));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  const isCommands = !pick && value.startsWith('>');
  const query = isCommands ? value.slice(1) : value;
  const items = useMemo(
    () => (pick ? pickItems(pick, query) : isCommands ? commandItems(query) : quickOpenItems(query)),
    [pick, isCommands, query],
  );
  const placeholder = pick
    ? pick.placeholder
    : isCommands
      ? es.palette.placeholderCommands
      : es.palette.placeholderQuickOpen;

  useEffect(() => {
    inputRef.current?.focus();
    const restore = previousFocus.current;
    return () => restore?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const accept = (item: PickItem | undefined): void => {
    if (!item) return;
    previousFocus.current = null;
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        setActive((a) => Math.min(items.length - 1, a + 1));
        break;
      case 'ArrowUp':
        setActive((a) => Math.max(0, a - 1));
        break;
      case 'PageDown':
        setActive((a) => Math.min(items.length - 1, a + 10));
        break;
      case 'PageUp':
        setActive((a) => Math.max(0, a - 10));
        break;
      case 'Enter':
        accept(items[active]);
        break;
      case 'Escape':
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div className="quick-input-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={pick?.anchor ? 'quick-input is-anchored' : 'quick-input'}
        style={pick?.anchor ? anchoredStyle(pick.anchor) : undefined}
        role="dialog"
        aria-label={placeholder}
      >
        <div className="input">
          <input
            ref={inputRef}
            value={value}
            spellCheck={false}
            role="combobox"
            data-testid="quick-input"
            aria-expanded
            aria-controls="quick-input-list"
            aria-activedescendant={items[active] ? `qi-${active}` : undefined}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              if (
                !e.relatedTarget ||
                !e.currentTarget.closest('.quick-input')?.contains(e.relatedTarget as Node)
              )
                onClose();
            }}
          />
        </div>
        <div className="quick-input-list" id="quick-input-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="quick-input-empty">{es.palette.noResults}</div>}
          {items.slice(0, 200).map((item, i) => {
            const showGroup = item.group && item.group !== items[i - 1]?.group;
            return (
              <div
                key={item.id}
                id={`qi-${i}`}
                role="option"
                aria-selected={i === active}
                className={[
                  'quick-input-item',
                  i === active ? 'is-active' : '',
                  showGroup && i > 0 ? 'has-separator' : '',
                ].join(' ')}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(item)}
              >
                {item.icon && <Codicon name={item.icon} color={item.iconColor} size={16} />}
                <span className="quick-input-label">
                  <Highlighted text={item.label} ranges={item.match.ranges} />
                </span>
                {item.detail && <span className="quick-input-detail">{item.detail}</span>}
                <span className="quick-input-spacer" />
                {showGroup && <span className="quick-input-group">{item.group}</span>}
                {item.keybinding && (
                  <span className="quick-input-keys">
                    {item.keybinding.split(' ').map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
