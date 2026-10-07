import { describe, expect, it } from 'vitest';
import type { KeyEventLike } from '../../src/renderer/commands/keybindings';
import {
  KeybindingResolver,
  chordFromEvent,
  evaluateWhen,
  formatSequence,
  parseKeybinding,
} from '../../src/renderer/commands/keybindings';
import { DEFAULT_KEYBINDINGS } from '../../src/renderer/commands/default-keybindings';

const ev = (key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

const always = (): boolean => true;
const none = new Set<string>();

describe('parseKeybinding / formatSequence', () => {
  it('interpreta modificadores y acordes', () => {
    expect(parseKeybinding('ctrl+shift+p')).toEqual([
      { ctrl: true, shift: true, alt: false, meta: false, key: 'p' },
    ]);
    expect(parseKeybinding('ctrl+k ctrl+s')).toHaveLength(2);
    expect(formatSequence(parseKeybinding('ctrl+k s'))).toBe('Ctrl+K S');
  });

  it('acepta la tecla "+" y alias', () => {
    expect(parseKeybinding('ctrl++')[0]!.key).toBe('+');
    expect(parseKeybinding('ctrl+shift++')[0]).toMatchObject({ ctrl: true, shift: true, key: '+' });
    expect(parseKeybinding('ctrl+pgdn')[0]!.key).toBe('pagedown');
    expect(formatSequence(parseKeybinding('ctrl+pagedown'))).toBe('Ctrl+AvPág');
  });

  it('rechaza atajos sin tecla o con más de dos acordes', () => {
    expect(() => parseKeybinding('ctrl+')).toThrow();
    expect(() => parseKeybinding('a b c')).toThrow();
  });

  it('todos los atajos por defecto son válidos', () => {
    for (const rule of DEFAULT_KEYBINDINGS) expect(() => parseKeybinding(rule.key)).not.toThrow();
  });
});

describe('chordFromEvent', () => {
  it('usa el código físico para letras y dígitos (independiente de la distribución)', () => {
    expect(chordFromEvent(ev('B', 'KeyB', { ctrlKey: true, shiftKey: true }))).toMatchObject({
      key: 'b',
      ctrl: true,
      shift: true,
    });
    expect(chordFromEvent(ev('!', 'Digit1', { altKey: true }))).toMatchObject({ key: '1', alt: true });
    expect(chordFromEvent(ev('0', 'Numpad0', { ctrlKey: true }))?.key).toBe('numpad0');
    expect(chordFromEvent(ev('F5', 'F5'))?.key).toBe('f5');
  });

  it('trata el Enter del teclado numérico como Enter', () => {
    expect(chordFromEvent(ev('Enter', 'NumpadEnter', { ctrlKey: true }))).toMatchObject({
      key: 'enter',
      ctrl: true,
    });
  });

  it('ignora las teclas modificadoras solas', () => {
    expect(chordFromEvent(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(ev('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull();
  });

  it('usa la tecla producida para signos de puntuación', () => {
    expect(chordFromEvent(ev(',', 'Comma', { ctrlKey: true }))?.key).toBe(',');
    expect(chordFromEvent(ev('+', 'BracketRight', { ctrlKey: true }))?.key).toBe('+');
  });
});

describe('evaluateWhen', () => {
  const ctx = new Set(['editorTextFocus', 'isProduction']);
  it('evalúa !, && y ||', () => {
    expect(evaluateWhen(undefined, ctx)).toBe(true);
    expect(evaluateWhen('editorTextFocus', ctx)).toBe(true);
    expect(evaluateWhen('!editorTextFocus', ctx)).toBe(false);
    expect(evaluateWhen('editorTextFocus && !treeFocus', ctx)).toBe(true);
    expect(evaluateWhen('treeFocus || isProduction', ctx)).toBe(true);
    expect(evaluateWhen('treeFocus && isProduction', ctx)).toBe(false);
  });
});

describe('KeybindingResolver', () => {
  it('resuelve un atajo simple', () => {
    const r = new KeybindingResolver();
    r.setRules([{ key: 'ctrl+b', command: 'db.toggleSidebar' }]);
    expect(r.resolve(parseKeybinding('ctrl+b')[0]!, none, always)).toEqual({
      kind: 'command',
      command: 'db.toggleSidebar',
    });
    expect(r.resolve(parseKeybinding('ctrl+j')[0]!, none, always)).toEqual({
      kind: 'no-match',
      afterChord: false,
    });
  });

  it('resuelve acordes de dos pasos', () => {
    const r = new KeybindingResolver();
    r.setRules([
      { key: 'ctrl+k s', command: 'db.saveAll' },
      { key: 'ctrl+k ctrl+s', command: 'db.keybindings.open' },
    ]);
    const ctrlK = parseKeybinding('ctrl+k')[0]!;
    expect(r.resolve(ctrlK, none, always).kind).toBe('chord-pending');
    expect(r.resolve(parseKeybinding('s')[0]!, none, always)).toEqual({
      kind: 'command',
      command: 'db.saveAll',
    });
    r.resolve(ctrlK, none, always);
    expect(r.resolve(parseKeybinding('ctrl+s')[0]!, none, always)).toEqual({
      kind: 'command',
      command: 'db.keybindings.open',
    });
    r.resolve(ctrlK, none, always);
    expect(r.resolve(parseKeybinding('x')[0]!, none, always)).toEqual({ kind: 'no-match', afterChord: true });
  });

  it('respeta la cláusula when', () => {
    const r = new KeybindingResolver();
    r.setRules([{ key: 'ctrl+enter', command: 'db.executeStatement', when: 'editorTextFocus' }]);
    const chord = parseKeybinding('ctrl+enter')[0]!;
    expect(r.resolve(chord, none, always).kind).toBe('no-match');
    expect(r.resolve(chord, new Set(['editorTextFocus']), always).kind).toBe('command');
  });

  it('no consume teclas de comandos no disponibles', () => {
    const r = new KeybindingResolver();
    r.setRules([{ key: 'ctrl+n', command: 'db.newScript' }]);
    expect(r.resolve(parseKeybinding('ctrl+n')[0]!, none, () => false).kind).toBe('no-match');
  });

  it('la última regla gana y "-comando" quita un atajo', () => {
    const r = new KeybindingResolver();
    r.setRules([
      { key: 'ctrl+e', command: 'a' },
      { key: 'ctrl+e', command: 'b' },
      { key: 'ctrl+enter', command: 'c' },
      { key: 'ctrl+enter', command: '-c' },
    ]);
    expect(r.resolve(parseKeybinding('ctrl+e')[0]!, none, always)).toEqual({ kind: 'command', command: 'b' });
    expect(r.resolve(parseKeybinding('ctrl+enter')[0]!, none, always).kind).toBe('no-match');
  });

  it('muestra el atajo principal (el primero declarado)', () => {
    const r = new KeybindingResolver();
    r.setRules(DEFAULT_KEYBINDINGS);
    expect(formatSequence(r.lookup('db.showCommands')!)).toBe('Ctrl+Shift+P');
    expect(formatSequence(r.lookup('db.closeTab')!)).toBe('Ctrl+W');
    expect(r.lookupAll('db.showCommands').map(formatSequence)).toEqual(['Ctrl+Shift+P', 'F1']);
  });
});
