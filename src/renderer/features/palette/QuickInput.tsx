import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Codicon } from '../../components/Codicon';
import { commands, keybindingLabel } from '../../commands/service';
import { commandTitle, es } from '../../i18n/es';
import { useOverlayStore } from '../../stores/overlay-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { sampleConnection, sampleSearchableFiles, sampleSearchableObjects } from '../../sample/sample-data';
import { useSampleStore } from '../../stores/sample-store';
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

const OBJECT_ICON: Record<string, string> = { table: 'table', view: 'eye', function: 'symbol-method' };

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

function quickOpenItems(query: string): PickItem[] {
  if (!useSampleStore.getState().enabled) return [];
  const open = useWorkbenchStore.getState().open;
  const objects: PickItem[] = [];
  for (const o of sampleSearchableObjects()) {
    const match = fuzzyMatch(query, o.name);
    if (!match) continue;
    const conn = sampleConnection(o.connectionId);
    objects.push({
      id: `obj:${o.path}/${o.name}`,
      label: o.name,
      icon: OBJECT_ICON[o.kind] ?? 'symbol-misc',
      iconColor: o.kind === 'table' ? 'var(--icon-table)' : undefined,
      detail: o.path,
      group: es.palette.groupObjects,
      match,
      run: () =>
        open({
          id: `object:${o.path}/${o.name}`,
          kind: 'object',
          title: o.name,
          tooltip: `${o.path} › ${o.name}`,
          connectionId: conn?.id,
          dirty: false,
          preview: true,
        }),
    });
  }
  const files: PickItem[] = [];
  for (const f of sampleSearchableFiles()) {
    const match = fuzzyMatch(query, f.name);
    if (!match) continue;
    const title = f.name.replace(/\.sql$/i, '');
    files.push({
      id: `file:${f.dir}/${f.name}`,
      label: f.name,
      icon: f.name.endsWith('.sql') ? 'database' : 'file',
      iconColor: 'var(--icon-sql)',
      detail: f.dir,
      group: es.palette.groupFiles,
      match,
      run: () =>
        open({
          id: `script:${f.dir}\\${f.name}`,
          kind: 'script',
          title,
          tooltip: `${f.dir}\\${f.name}`,
          dirty: false,
          preview: false,
        }),
    });
  }
  const byScore = (a: PickItem, b: PickItem): number => b.match.score - a.match.score;
  return [...objects.sort(byScore), ...files.sort(byScore)];
}

/** Paleta rápida (specs/04 §13): `>` = comandos; sin prefijo = objetos y archivos. */
export function QuickInput(): React.JSX.Element | null {
  const { open, initialValue } = useOverlayStore((s) => s.palette);
  const close = useOverlayStore((s) => s.closePalette);
  if (!open) return null;
  return <QuickInputBox initialValue={initialValue} onClose={close} />;
}

function QuickInputBox({
  initialValue,
  onClose,
}: {
  initialValue: string;
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  const isCommands = value.startsWith('>');
  const query = isCommands ? value.slice(1) : value;
  const items = useMemo(
    () => (isCommands ? commandItems(query) : quickOpenItems(query)),
    [isCommands, query],
  );

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
        className="quick-input"
        role="dialog"
        aria-label={isCommands ? es.palette.placeholderCommands : es.palette.placeholderQuickOpen}
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
            placeholder={isCommands ? es.palette.placeholderCommands : es.palette.placeholderQuickOpen}
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
