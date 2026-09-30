/**
 * Atajos de teclado con sintaxis compatible con VS Code
 * (`"ctrl+shift+p"`, acordes `"ctrl+k ctrl+s"`) y cláusulas `when` mínimas.
 * Módulo puro (sin DOM) para poder probarlo en Node.
 */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Tecla normalizada en minúsculas: `a`, `1`, `f5`, `enter`, `pagedown`, `numpad0`, `,`… */
  key: string;
}

/** Uno o dos acordes (`ctrl+k ctrl+s`). */
export type KeySequence = KeyChord[];

export interface KeybindingRule {
  key: string;
  command: string;
  when?: string;
}

export interface ResolvedKeybinding {
  sequence: KeySequence;
  command: string;
  when?: string;
}

/** Subconjunto de `KeyboardEvent` que se necesita (permite probar sin DOM). */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  pgup: 'pageup',
  pgdn: 'pagedown',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  space: ' ',
  plus: '+',
  numpad_add: 'numpadadd',
  numpad_subtract: 'numpadsubtract',
};

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os']);

export function parseChord(text: string): KeyChord {
  const parts = text.toLowerCase().split('+');
  // "ctrl++" → la última parte vacía es la tecla "+".
  if (text.endsWith('++')) parts.splice(parts.length - 2, 2, '+');
  const chord: KeyChord = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  for (const raw of parts) {
    const part = raw.trim();
    if (part === 'ctrl' || part === 'control') chord.ctrl = true;
    else if (part === 'shift') chord.shift = true;
    else if (part === 'alt') chord.alt = true;
    else if (part === 'meta' || part === 'cmd' || part === 'win') chord.meta = true;
    else chord.key = KEY_ALIASES[part] ?? part;
  }
  if (!chord.key) throw new Error(`Atajo sin tecla: "${text}"`);
  return chord;
}

export function parseKeybinding(text: string): KeySequence {
  const chords = text.trim().split(/\s+/).map(parseChord);
  if (chords.length === 0 || chords.length > 2) throw new Error(`Atajo inválido: "${text}"`);
  return chords;
}

/** Normaliza la tecla de un evento. Devuelve `null` si solo se pulsó un modificador. */
export function chordFromEvent(e: KeyEventLike): KeyChord | null {
  const lowerKey = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(lowerKey)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad/.test(e.code)) key = e.code.toLowerCase();
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code.toLowerCase();
  else if (e.key === 'Dead' || e.key === 'Unidentified') key = e.code.toLowerCase();
  else key = lowerKey;
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key };
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta && a.key === b.key;
}

const DISPLAY_KEYS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  pageup: 'RePág',
  pagedown: 'AvPág',
  pause: 'Pausa',
  delete: 'Supr',
  backspace: 'Retroceso',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Espacio',
  numpadadd: 'NumPad+',
  numpadsubtract: 'NumPad-',
};

export function formatChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.shift) parts.push('Shift');
  if (chord.alt) parts.push('Alt');
  if (chord.meta) parts.push('Win');
  const k = chord.key;
  const display =
    DISPLAY_KEYS[k] ??
    (k.startsWith('numpad') ? `NumPad${k.slice(6)}` : k.length === 1 ? k.toUpperCase() : k.toUpperCase());
  parts.push(display);
  return parts.join('+');
}

export function formatSequence(sequence: KeySequence): string {
  return sequence.map(formatChord).join(' ');
}

/**
 * Evalúa una cláusula `when` con operadores `!`, `&&` y `||` (sin paréntesis),
 * como el subconjunto mínimo de VS Code.
 */
export function evaluateWhen(when: string | undefined, context: ReadonlySet<string>): boolean {
  if (!when || !when.trim()) return true;
  return when.split('||').some((conjunction) =>
    conjunction.split('&&').every((term) => {
      const t = term.trim();
      if (!t) return true;
      if (t === 'true') return true;
      if (t === 'false') return false;
      return t.startsWith('!') ? !context.has(t.slice(1).trim()) : context.has(t);
    }),
  );
}

export type ResolveResult =
  | { kind: 'command'; command: string }
  | { kind: 'chord-pending'; first: KeyChord }
  | { kind: 'no-match'; afterChord: boolean };

/**
 * Resuelve atajos por acordes. Aplica la semántica de VS Code:
 * la última regla registrada gana, y `-comando` elimina atajos anteriores.
 */
export class KeybindingResolver {
  private rules: ResolvedKeybinding[] = [];
  private pending: KeyChord | null = null;

  setRules(rules: readonly KeybindingRule[]): void {
    const resolved: ResolvedKeybinding[] = [];
    for (const rule of rules) {
      let sequence: KeySequence;
      try {
        sequence = parseKeybinding(rule.key);
      } catch {
        continue;
      }
      if (rule.command.startsWith('-')) {
        const target = rule.command.slice(1);
        for (let i = resolved.length - 1; i >= 0; i--) {
          const r = resolved[i]!;
          if (r.command === target && sequencesEqual(r.sequence, sequence)) resolved.splice(i, 1);
        }
        continue;
      }
      resolved.push({ sequence, command: rule.command, when: rule.when });
    }
    this.rules = resolved;
    this.pending = null;
  }

  get pendingChord(): KeyChord | null {
    return this.pending;
  }

  reset(): void {
    this.pending = null;
  }

  /**
   * Atajo principal de un comando (para mostrarlo en menús): el primero
   * declarado. En la tabla por defecto el principal va primero (p. ej.
   * Ctrl+Shift+P antes que F1).
   */
  lookup(command: string): KeySequence | undefined {
    return this.rules.find((r) => r.command === command)?.sequence;
  }

  lookupAll(command: string): KeySequence[] {
    return this.rules.filter((r) => r.command === command).map((r) => r.sequence);
  }

  /**
   * Procesa un acorde. `isAvailable` indica si un comando existe y está
   * habilitado: los atajos a comandos no disponibles no consumen la tecla.
   */
  resolve(
    chord: KeyChord,
    context: ReadonlySet<string>,
    isAvailable: (command: string) => boolean,
  ): ResolveResult {
    const candidates = this.rules.filter((r) => evaluateWhen(r.when, context) && isAvailable(r.command));

    if (this.pending) {
      const first = this.pending;
      this.pending = null;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const r = candidates[i]!;
        if (
          r.sequence.length === 2 &&
          chordsEqual(r.sequence[0]!, first) &&
          chordsEqual(r.sequence[1]!, chord)
        ) {
          return { kind: 'command', command: r.command };
        }
      }
      return { kind: 'no-match', afterChord: true };
    }

    const startsChord = candidates.some((r) => r.sequence.length === 2 && chordsEqual(r.sequence[0]!, chord));
    if (startsChord) {
      this.pending = chord;
      return { kind: 'chord-pending', first: chord };
    }
    for (let i = candidates.length - 1; i >= 0; i--) {
      const r = candidates[i]!;
      if (r.sequence.length === 1 && chordsEqual(r.sequence[0]!, chord))
        return { kind: 'command', command: r.command };
    }
    return { kind: 'no-match', afterChord: false };
  }
}

function sequencesEqual(a: KeySequence, b: KeySequence): boolean {
  return a.length === b.length && a.every((c, i) => chordsEqual(c, b[i]!));
}
