import type { SchemaDiagram } from '@shared/metadata';

/**
 * Modelo geométrico del diagrama ER (specs/13 §3 y §4): cajas, relaciones, disposición automática y
 * enrutado de líneas. Todo es puro y determinista: el mismo esquema produce siempre la misma disposición.
 */

export const BOX_WIDTH = 230;
export const HEADER_HEIGHT = 28;
export const ROW_HEIGHT = 20;
const GAP_X = 110;
const GAP_Y = 36;
const COMPONENT_GAP = 60;
/** Tablas sin relaciones: cuadrícula de este ancho (en cajas). */
const GRID_COLUMNS = 4;
/** Largo del tramo recto que sale de la caja antes de girar. */
const STUB = 18;

export interface BoxColumn {
  name: string;
  nativeType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  nullable: boolean;
}

export interface Box {
  /** Nombre de la tabla; las cajas externas usan `esquema.tabla` con prefijo `ext:`. */
  id: string;
  label: string;
  /** Tabla de otro esquema (o inexistente): se dibuja atenuada y sin columnas. */
  external: boolean;
  columns: BoxColumn[];
  height: number;
}

export interface Edge {
  id: string;
  /** Nombre de la restricción (puede estar vacío). */
  name: string;
  from: string;
  to: string;
  fromColumns: string[];
  toColumns: string[];
  /** La clave foránea admite NULL en alguna de sus columnas: el extremo se dibuja vacío. */
  optional: boolean;
}

export interface DiagramModel {
  boxes: Box[];
  edges: Edge[];
}

export interface Point {
  x: number;
  y: number;
}

export type Positions = Record<string, Point>;

export function boxHeight(columnCount: number): number {
  return HEADER_HEIGHT + columnCount * ROW_HEIGHT + (columnCount > 0 ? 6 : 0);
}

/** Convierte el resultado del driver en cajas y relaciones; las tablas de otro esquema pasan a cajas externas. */
export function buildModel(diagram: SchemaDiagram, scopeSchema: string): DiagramModel {
  const boxes = new Map<string, Box>();
  const foreignColumns = new Map<string, Set<string>>();
  const nullable = new Map<string, Map<string, boolean>>();
  for (const t of diagram.tables) {
    nullable.set(t.name, new Map(t.columns.map((c) => [c.name, c.nullable])));
  }
  for (const r of diagram.relations) {
    const set = foreignColumns.get(r.from.table) ?? new Set<string>();
    for (const c of r.from.columns) set.add(c);
    foreignColumns.set(r.from.table, set);
  }
  for (const t of diagram.tables) {
    const fks = foreignColumns.get(t.name);
    boxes.set(t.name, {
      id: t.name,
      label: t.name,
      external: false,
      columns: t.columns.map((c) => ({
        name: c.name,
        nativeType: c.nativeType,
        primaryKey: c.primaryKey,
        foreignKey: fks?.has(c.name) ?? false,
        nullable: c.nullable,
      })),
      height: boxHeight(t.columns.length),
    });
  }
  const edges: Edge[] = [];
  diagram.relations.forEach((r, index) => {
    if (!boxes.has(r.from.table)) return;
    const sameSchema = r.to.schema === scopeSchema || r.to.schema === '';
    let to = r.to.table;
    if (!sameSchema || !boxes.has(to)) {
      to = `ext:${r.to.schema ? `${r.to.schema}.` : ''}${r.to.table}`;
      if (!boxes.has(to)) {
        boxes.set(to, {
          id: to,
          label: r.to.schema ? `${r.to.schema}.${r.to.table}` : r.to.table,
          external: true,
          columns: [],
          height: HEADER_HEIGHT,
        });
      }
    }
    const columnNullable = nullable.get(r.from.table);
    edges.push({
      id: `${r.from.table}#${index}`,
      name: r.name,
      from: r.from.table,
      to,
      fromColumns: r.from.columns,
      toColumns: r.to.columns,
      optional: r.from.columns.some((c) => columnNullable?.get(c) ?? true),
    });
  });
  return { boxes: [...boxes.values()], edges };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Disposición inicial (specs/13 §4): por componentes conectados y, dentro de cada uno, por capas. Una
 * tabla va a la derecha de las que referencia; las tablas sin relaciones, en una cuadrícula al final.
 */
export function autoLayout(model: DiagramModel): Positions {
  const ids = model.boxes.map((b) => b.id).sort(compare);
  const heights = new Map(model.boxes.map((b) => [b.id, b.height]));
  const targets = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const neighbours = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of model.edges) {
    if (e.from === e.to) continue;
    targets.get(e.from)!.add(e.to);
    neighbours.get(e.from)!.add(e.to);
    neighbours.get(e.to)!.add(e.from);
  }

  // Componentes conectados, en orden de nombre.
  const seen = new Set<string>();
  const components: string[][] = [];
  const singles: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      members.push(current);
      for (const n of neighbours.get(current)!) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (members.length === 1) singles.push(members[0]!);
    else components.push(members.sort(compare));
  }
  components.sort((a, b) => b.length - a.length || compare(a[0]!, b[0]!));

  const positions: Positions = {};
  let top = 0;

  for (const members of components) {
    const layer = assignLayers(members, targets);
    const columns = new Map<number, string[]>();
    for (const id of members) {
      const l = layer.get(id)!;
      columns.set(l, [...(columns.get(l) ?? []), id]);
    }
    const order = [...columns.keys()].sort((a, b) => a - b);
    // Una pasada de baricentro respecto a la capa de la izquierda reduce los cruces de líneas.
    const row = new Map<string, number>();
    for (const l of order) {
      const column = columns.get(l)!;
      const score = (id: string): number => {
        const linked = [...neighbours.get(id)!].filter((n) => (layer.get(n) ?? 0) < l && row.has(n));
        if (linked.length === 0) return Number.MAX_SAFE_INTEGER;
        return linked.reduce((sum, n) => sum + row.get(n)!, 0) / linked.length;
      };
      column.sort((a, b) => score(a) - score(b) || compare(a, b));
      column.forEach((id, i) => row.set(id, i));
    }
    let componentHeight = 0;
    for (const l of order) {
      let y = top;
      for (const id of columns.get(l)!) {
        positions[id] = { x: l * (BOX_WIDTH + GAP_X), y };
        y += heights.get(id)! + GAP_Y;
      }
      componentHeight = Math.max(componentHeight, y - top - GAP_Y);
    }
    top += componentHeight + COMPONENT_GAP;
  }

  // Cuadrícula de tablas sin relaciones: cada fila mide lo que la caja más alta.
  for (let start = 0; start < singles.length; start += GRID_COLUMNS) {
    const chunk = singles.slice(start, start + GRID_COLUMNS);
    chunk.forEach((id, i) => {
      positions[id] = { x: i * (BOX_WIDTH + GAP_X), y: top };
    });
    top += Math.max(...chunk.map((id) => heights.get(id)!)) + GAP_Y;
  }
  return positions;
}

/** Capa de cada tabla: 0 para las que no referencian a nadie, y 1 + la mayor de las que referencia. */
function assignLayers(members: string[], targets: Map<string, Set<string>>): Map<string, number> {
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    let result = 0;
    for (const t of [...targets.get(id)!].sort(compare)) {
      // Una referencia circular se ignora al llegar a una tabla que ya se está resolviendo.
      if (visiting.has(t)) continue;
      result = Math.max(result, depth(t) + 1);
    }
    visiting.delete(id);
    layer.set(id, result);
    return result;
  };
  for (const id of members) depth(id);
  return layer;
}

export interface Route {
  /** Vértices de la línea (ortogonal). */
  points: Point[];
  /** Extremo de la clave foránea y extremo referenciado, con el sentido en que la línea sale de la caja. */
  fkEnd: Point & { dir: 1 | -1 };
  refEnd: Point & { dir: 1 | -1 };
}

function rowY(box: Box, y: number, columns: string[]): number {
  if (box.external || columns.length === 0) return y + HEADER_HEIGHT / 2;
  const index = box.columns.findIndex((c) => c.name === columns[0]);
  return y + HEADER_HEIGHT + (index < 0 ? 0 : index) * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/** Línea ortogonal desde la columna de la clave foránea hasta la columna referenciada (specs/13 §3). */
export function routeEdge(edge: Edge, boxes: Map<string, Box>, positions: Positions): Route | null {
  const a = boxes.get(edge.from);
  const b = boxes.get(edge.to);
  const pa = positions[edge.from];
  const pb = positions[edge.to];
  if (!a || !b || !pa || !pb) return null;
  const ay = rowY(a, pa.y, edge.fromColumns);
  const by = rowY(b, pb.y, edge.toColumns);

  let aDir: 1 | -1;
  let bDir: 1 | -1;
  if (edge.from === edge.to || (pa.x < pb.x + BOX_WIDTH && pb.x < pa.x + BOX_WIDTH)) {
    // Cajas una sobre otra (o la misma): ambas líneas salen por la derecha y dan la vuelta.
    aDir = 1;
    bDir = 1;
  } else if (pa.x > pb.x) {
    aDir = -1;
    bDir = 1;
  } else {
    aDir = 1;
    bDir = -1;
  }
  const ax = aDir === 1 ? pa.x + BOX_WIDTH : pa.x;
  const bx = bDir === 1 ? pb.x + BOX_WIDTH : pb.x;

  let points: Point[];
  if (aDir === bDir) {
    const turn = aDir === 1 ? Math.max(ax, bx) + STUB * 2 : Math.min(ax, bx) - STUB * 2;
    points = [
      { x: ax, y: ay },
      { x: turn, y: ay },
      { x: turn, y: by },
      { x: bx, y: by },
    ];
  } else {
    const middle = (ax + bx) / 2;
    points = [
      { x: ax, y: ay },
      { x: middle, y: ay },
      { x: middle, y: by },
      { x: bx, y: by },
    ];
  }
  return { points, fkEnd: { x: ax, y: ay, dir: aDir }, refEnd: { x: bx, y: by, dir: bDir } };
}

export function pathOf(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

/** Pata de gallo (lado "muchos") en el extremo de la clave foránea. */
export function crowsFoot(end: Point & { dir: 1 | -1 }): string {
  const tip = end.x + end.dir * 12;
  return `M${tip} ${end.y} L${end.x} ${end.y - 6} M${tip} ${end.y} L${end.x} ${end.y + 6}`;
}

/** Barra (lado "uno") en el extremo referenciado. */
export function oneBar(end: Point & { dir: 1 | -1 }): string {
  const x = end.x + end.dir * 8;
  return `M${x} ${end.y - 6} L${x} ${end.y + 6}`;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectángulo que contiene todas las cajas y líneas, con un margen. */
export function contentBounds(model: DiagramModel, positions: Positions, margin = 40): Bounds {
  const boxes = new Map(model.boxes.map((b) => [b.id, b]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const b of model.boxes) {
    const p = positions[b.id];
    if (!p) continue;
    include(p.x, p.y);
    include(p.x + BOX_WIDTH, p.y + b.height);
  }
  for (const e of model.edges) {
    const route = routeEdge(e, boxes, positions);
    for (const p of route?.points ?? []) include(p.x, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 400, height: 300 };
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

/** Posiciones guardadas por el usuario sobre la disposición automática; descarta las de tablas que ya no existen. */
export function mergePositions(
  model: DiagramModel,
  saved: Record<string, [number, number]> | undefined,
): Positions {
  const auto = autoLayout(model);
  if (!saved) return auto;
  const merged: Positions = { ...auto };
  for (const b of model.boxes) {
    const s = saved[b.id];
    if (s) merged[b.id] = { x: s[0], y: s[1] };
  }
  return merged;
}

/** Hasta cuántas tablas se dibujan completas; con más, el usuario elige cuáles incluir (specs/13 §2.2). */
export const MAX_TABLES = 150;

/**
 * Selección inicial cuando el esquema supera `MAX_TABLES`: la tabla pedida y las relacionadas con ella a
 * un nivel; sin tabla pedida (o sin relaciones), las primeras por nombre hasta el límite.
 */
export function initialSelection(diagram: SchemaDiagram, focus?: string, max = MAX_TABLES): Set<string> {
  const names = diagram.tables.map((t) => t.name).sort(compare);
  const chosen = new Set<string>();
  if (focus && names.includes(focus)) {
    chosen.add(focus);
    for (const r of diagram.relations) {
      if (r.from.table === focus) chosen.add(r.to.table);
      if (r.to.table === focus) chosen.add(r.from.table);
    }
  }
  const known = new Set(names);
  const related = [...chosen].filter((n) => known.has(n)).sort(compare);
  const result = new Set(related.slice(0, max));
  for (const n of names) {
    if (result.size >= max) break;
    result.add(n);
  }
  return result;
}

/** Recorta un texto con puntos suspensivos si pasa de `max` caracteres. */
export function fitText(text: string, max: number): string {
  if (max < 2) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
