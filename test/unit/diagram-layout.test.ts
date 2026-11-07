import { describe, expect, it } from 'vitest';
import type { SchemaDiagram } from '@shared/metadata';
import { DEFAULT_UI_STATE, MAX_DIAGRAMS_REMEMBERED, parseUiState } from '@shared/ui-state';
import {
  BOX_WIDTH,
  HEADER_HEIGHT,
  MAX_TABLES,
  ROW_HEIGHT,
  autoLayout,
  buildModel,
  contentBounds,
  fitText,
  initialSelection,
  mergePositions,
  routeEdge,
} from '../../src/renderer/features/diagram/diagram-layout';
import { useUiStore } from '../../src/renderer/stores/ui-store';

const col = (name: string, primaryKey = false, nullable = !primaryKey) => ({
  name,
  nativeType: 'int',
  nullable,
  primaryKey,
});
const table = (name: string, ...columns: ReturnType<typeof col>[]) => ({ name, columns });
const fk = (from: string, fromCols: string[], to: string, toCols: string[], toSchema = 'main') => ({
  name: `${from}_${to}_fk`,
  from: { schema: 'main', table: from, columns: fromCols },
  to: { schema: toSchema, table: to, columns: toCols },
});

const sample: SchemaDiagram = {
  tables: [
    table('pedidos', col('id', true), col('cliente_id', false, false), col('vendedor_id')),
    table('clientes', col('id', true)),
    table('vendedores', col('id', true)),
    table('suelta_b', col('id', true)),
    table('suelta_a', col('id', true)),
  ],
  relations: [
    fk('pedidos', ['cliente_id'], 'clientes', ['id']),
    fk('pedidos', ['vendedor_id'], 'vendedores', ['id']),
  ],
};

describe('diagrama ER: modelo', () => {
  it('marca claves foráneas y opcionalidad de la relación', () => {
    const model = buildModel(sample, 'main');
    const pedidos = model.boxes.find((b) => b.id === 'pedidos')!;
    expect(pedidos.columns.map((c) => c.foreignKey)).toEqual([false, true, true]);
    expect(pedidos.height).toBe(HEADER_HEIGHT + 3 * ROW_HEIGHT + 6);
    const byTarget = Object.fromEntries(model.edges.map((e) => [e.to, e.optional]));
    expect(byTarget).toEqual({ clientes: false, vendedores: true });
  });

  it('un destino de otro esquema o inexistente es una caja externa atenuada sin columnas', () => {
    const model = buildModel(
      {
        tables: [table('a', col('id', true), col('x'))],
        relations: [fk('a', ['x'], 'b', ['id'], 'otro'), fk('a', ['id'], 'faltante', ['id'])],
      },
      'main',
    );
    const external = model.boxes.filter((b) => b.external);
    expect(external.map((b) => [b.id, b.label, b.columns.length, b.height])).toEqual([
      ['ext:otro.b', 'otro.b', 0, HEADER_HEIGHT],
      ['ext:main.faltante', 'main.faltante', 0, HEADER_HEIGHT],
    ]);
    expect(model.edges.map((e) => e.to)).toEqual(['ext:otro.b', 'ext:main.faltante']);
  });
});

describe('diagrama ER: disposición', () => {
  it('es determinista aunque cambie el orden de entrada', () => {
    const shuffled: SchemaDiagram = {
      tables: [...sample.tables].reverse(),
      relations: [...sample.relations].reverse(),
    };
    expect(autoLayout(buildModel(shuffled, 'main'))).toEqual(autoLayout(buildModel(sample, 'main')));
  });

  it('pone cada tabla a la derecha de las que referencia', () => {
    const p = autoLayout(buildModel(sample, 'main'));
    expect(p['clientes']!.x).toBe(0);
    expect(p['vendedores']!.x).toBe(0);
    expect(p['pedidos']!.x).toBeGreaterThan(p['clientes']!.x + BOX_WIDTH);
  });

  it('las tablas sin relaciones van debajo, en cuadrícula, sin solaparse con el resto', () => {
    const model = buildModel(sample, 'main');
    const p = autoLayout(model);
    const bottomOfRelated = Math.max(
      ...['pedidos', 'clientes', 'vendedores'].map(
        (id) => p[id]!.y + model.boxes.find((b) => b.id === id)!.height,
      ),
    );
    expect(p['suelta_a']!.y).toBeGreaterThan(bottomOfRelated);
    expect(p['suelta_a']!.y).toBe(p['suelta_b']!.y);
    expect(p['suelta_a']!.x).toBeLessThan(p['suelta_b']!.x);
  });

  it('tolera referencias circulares y a sí misma', () => {
    const model = buildModel(
      {
        tables: [table('a', col('id', true), col('b_id')), table('b', col('id', true), col('a_id'))],
        relations: [
          fk('a', ['b_id'], 'b', ['id']),
          fk('b', ['a_id'], 'a', ['id']),
          fk('a', ['id'], 'a', ['id']),
        ],
      },
      'main',
    );
    const p = autoLayout(model);
    expect(Object.keys(p).sort()).toEqual(['a', 'b']);
    expect(p['a']).not.toEqual(p['b']);
  });

  it('las posiciones guardadas pisan a las automáticas y las de tablas inexistentes se ignoran', () => {
    const model = buildModel(sample, 'main');
    const merged = mergePositions(model, { clientes: [500, 600], borrada: [1, 1] });
    expect(merged['clientes']).toEqual({ x: 500, y: 600 });
    expect(merged['pedidos']).toEqual(autoLayout(model)['pedidos']);
    expect(merged['borrada']).toBeUndefined();
  });
});

describe('diagrama ER: líneas', () => {
  const model = buildModel(sample, 'main');
  const boxes = new Map(model.boxes.map((b) => [b.id, b]));

  it('sale del lado más cercano y apunta a la fila de la columna', () => {
    const positions = {
      ...autoLayout(model),
      pedidos: { x: 400, y: 0 },
      clientes: { x: 0, y: 100 },
      vendedores: { x: 0, y: 300 },
    };
    const edge = model.edges.find((e) => e.to === 'clientes')!;
    const route = routeEdge(edge, boxes, positions)!;
    expect(route.fkEnd).toMatchObject({ x: 400, dir: -1 });
    expect(route.refEnd).toMatchObject({ x: BOX_WIDTH, dir: 1 });
    // cliente_id es la segunda columna de pedidos; id, la primera de clientes.
    expect(route.fkEnd.y).toBe(HEADER_HEIGHT + ROW_HEIGHT + ROW_HEIGHT / 2);
    expect(route.refEnd.y).toBe(100 + HEADER_HEIGHT + ROW_HEIGHT / 2);
    expect(route.points[0]).toEqual({ x: route.fkEnd.x, y: route.fkEnd.y });
    expect(route.points.at(-1)).toEqual({ x: route.refEnd.x, y: route.refEnd.y });
  });

  it('cajas una sobre otra y autorreferencias dan la vuelta por la derecha', () => {
    const edge = model.edges[0]!;
    const positions = { ...autoLayout(model), pedidos: { x: 0, y: 0 }, clientes: { x: 20, y: 200 } };
    const route = routeEdge(edge, boxes, positions)!;
    expect([route.fkEnd.dir, route.refEnd.dir]).toEqual([1, 1]);
    expect(Math.max(...route.points.map((p) => p.x))).toBeGreaterThan(BOX_WIDTH + 20);
  });

  it('los límites del contenido incluyen todas las cajas', () => {
    const positions = autoLayout(model);
    const b = contentBounds(model, positions);
    for (const box of model.boxes) {
      const p = positions[box.id]!;
      expect(p.x).toBeGreaterThanOrEqual(b.x);
      expect(p.y + box.height).toBeLessThanOrEqual(b.y + b.height);
      expect(p.x + BOX_WIDTH).toBeLessThanOrEqual(b.x + b.width);
    }
  });
});

describe('diagrama ER: esquemas grandes', () => {
  const many: SchemaDiagram = {
    tables: Array.from({ length: 400 }, (_, i) => table(`t${String(i).padStart(3, '0')}`, col('id', true))),
    relations: [fk('t300', ['id'], 't301', ['id']), fk('t302', ['id'], 't300', ['id'])],
  };

  it('sin tabla pedida, las primeras por nombre hasta el límite', () => {
    const sel = initialSelection(many);
    expect(sel.size).toBe(MAX_TABLES);
    expect(sel.has('t000')).toBe(true);
    expect(sel.has('t300')).toBe(false);
  });

  it('con tabla pedida empieza por ella y sus relacionadas a un nivel', () => {
    const sel = initialSelection(many, 't300', 5);
    expect([...sel].sort()).toEqual(['t000', 't001', 't300', 't301', 't302'].sort());
  });
});

describe('diagrama ER: texto y estado', () => {
  it('recorta con puntos suspensivos', () => {
    expect(fitText('corto', 10)).toBe('corto');
    expect(fitText('nombre_muy_largo', 8)).toBe('nombre_…');
    expect(fitText('x', 1)).toBe('');
  });

  it('el estado de la interfaz valida y descarta posiciones dañadas', () => {
    const key = 'c\u0000main\u0000main';
    const ok = parseUiState({ diagramPositions: { [key]: { clientes: [10, 20] } } });
    expect(ok.diagramPositions[key]).toEqual({ clientes: [10, 20] });
    expect(parseUiState({ diagramPositions: { k: { t: ['x', 1] } } }).diagramPositions).toEqual({});
    expect(parseUiState({}).diagramPositions).toEqual(DEFAULT_UI_STATE.diagramPositions);
  });

  it('recuerda un máximo de diagramas y borra al guardar un conjunto vacío', () => {
    const { setDiagramPositions } = useUiStore.getState();
    for (let i = 0; i < MAX_DIAGRAMS_REMEMBERED + 5; i++) setDiagramPositions(`k${i}`, { t: [i, i] });
    const keys = Object.keys(useUiStore.getState().diagramPositions);
    expect(keys).toHaveLength(MAX_DIAGRAMS_REMEMBERED);
    expect(keys.at(-1)).toBe(`k${MAX_DIAGRAMS_REMEMBERED + 4}`);
    expect(keys[0]).toBe('k5');
    setDiagramPositions('k5', null);
    expect(useUiStore.getState().diagramPositions['k5']).toBeUndefined();
  });
});
