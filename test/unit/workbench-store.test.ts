import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorTab } from '../../src/renderer/stores/workbench-store';
import { useWorkbenchStore } from '../../src/renderer/stores/workbench-store';

const tab = (id: string, extra: Partial<EditorTab> = {}): EditorTab => ({
  id,
  kind: 'script',
  title: id,
  tooltip: id,
  dirty: false,
  preview: false,
  ...extra,
});

const s = useWorkbenchStore.getState;
const ids = (): string[] => s().tabs.map((t) => t.id);

beforeEach(() => {
  useWorkbenchStore.setState({ tabs: [], activeId: null, closed: [] });
  s().open(tab('a'));
  s().open(tab('b', { dirty: true }));
  s().open(tab('c'));
});

describe('workbench-store', () => {
  it('al cerrar la activa, activa la vecina', () => {
    s().activate('b');
    s().close('b');
    expect(ids()).toEqual(['a', 'c']);
    expect(s().activeId).toBe('c');
  });

  it('reabre la última pestaña cerrada', () => {
    s().close('c');
    s().reopenClosed();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(s().activeId).toBe('c');
  });

  it('la pestaña preview se reemplaza al abrir otra preview', () => {
    s().open(tab('p1', { preview: true }));
    s().open(tab('p2', { preview: true }));
    expect(ids()).toEqual(['a', 'b', 'c', 'p2']);
    s().pin('p2');
    s().open(tab('p3', { preview: true }));
    expect(ids()).toEqual(['a', 'b', 'c', 'p2', 'p3']);
  });

  it('cerrar guardadas conserva solo las que tienen cambios', () => {
    s().closeSaved();
    expect(ids()).toEqual(['b']);
    expect(s().activeId).toBe('b');
  });

  it('cicla con siguiente/anterior y reordena', () => {
    s().activate('c');
    s().activateRelative(1);
    expect(s().activeId).toBe('a');
    s().activateRelative(-1);
    expect(s().activeId).toBe('c');
    s().move('c', 0);
    expect(ids()).toEqual(['c', 'a', 'b']);
  });

  it('cerrar a la derecha y cerrar otras', () => {
    s().closeToRight('a');
    expect(ids()).toEqual(['a']);
    s().reopenClosed();
    s().closeOthers('a');
    expect(ids()).toEqual(['a']);
  });
});
