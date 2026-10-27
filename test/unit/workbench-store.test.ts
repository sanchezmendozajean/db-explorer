import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorTab } from '../../src/renderer/stores/workbench-store';
import { groupOf, useWorkbenchStore } from '../../src/renderer/stores/workbench-store';

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
  useWorkbenchStore.setState({ tabs: [], activeId: null, groupActive: [null, null], closed: [] });
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

  describe('grupos del editor dividido', () => {
    const inGroup = (group: 0 | 1): string[] =>
      s()
        .tabs.filter((t) => groupOf(t) === group)
        .map((t) => t.id);

    it('mover una pestaña al grupo dividido la deja visible y activa en él', () => {
      s().moveToGroup('c', 1);
      expect(inGroup(0)).toEqual(['a', 'b']);
      expect(inGroup(1)).toEqual(['c']);
      expect(s().activeId).toBe('c');
      expect(s().groupActive).toEqual(['b', 'c']);
    });

    it('enfocar un grupo activa su pestaña visible', () => {
      s().moveToGroup('c', 1);
      s().activate('a');
      expect(s().groupActive).toEqual(['a', 'c']);
      s().focusGroup(1);
      expect(s().activeId).toBe('c');
      s().focusGroup(0);
      expect(s().activeId).toBe('a');
    });

    it('las pestañas nuevas se abren en el grupo enfocado', () => {
      s().moveToGroup('c', 1);
      s().open(tab('d'));
      expect(inGroup(1)).toEqual(['c', 'd']);
      s().focusGroup(0);
      s().open(tab('e'));
      expect(inGroup(0)).toEqual(['a', 'b', 'e']);
    });

    it('cerrar la activa elige la vecina del mismo grupo', () => {
      s().moveToGroup('b', 1);
      s().moveToGroup('c', 1);
      s().close('c');
      expect(s().activeId).toBe('b');
      s().activate('a');
      s().close('a');
      // Sin pestañas en el principal, las del dividido pasan a él.
      expect(s().activeId).toBe('b');
      expect(inGroup(0)).toEqual(['b']);
      expect(inGroup(1)).toEqual([]);
    });

    it('el grupo dividido desaparece al quedar vacío y el principal nunca queda vacío', () => {
      s().moveToGroup('c', 1);
      s().close('c');
      expect(inGroup(1)).toEqual([]);
      s().moveToGroup('a', 1);
      s().moveToGroup('b', 1);
      expect(inGroup(0)).toEqual(['a', 'b']);
      expect(inGroup(1)).toEqual([]);
    });

    it('siguiente/anterior y Alt+N recorren solo el grupo enfocado', () => {
      s().moveToGroup('c', 1);
      s().activate('a');
      s().activateRelative(1);
      expect(s().activeId).toBe('b');
      s().activateRelative(1);
      expect(s().activeId).toBe('a');
      s().activateIndex(1);
      expect(s().activeId).toBe('b');
    });

    it('juntar los grupos y arrastrar entre ellos', () => {
      s().moveToGroup('c', 1);
      s().move('a', 0, 1);
      expect(inGroup(1)).toEqual(['a', 'c']);
      expect(s().activeId).toBe('a');
      s().mergeGroups();
      expect(inGroup(1)).toEqual([]);
      expect(inGroup(0)).toEqual(['a', 'b', 'c']);
    });
  });
});
