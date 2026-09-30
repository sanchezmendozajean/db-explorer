import { create } from 'zustand';
import { es } from '../i18n/es';
import { CommandRegistry } from './registry';
import { DEFAULT_KEYBINDINGS } from './default-keybindings';
import type { KeySequence } from './keybindings';
import { KeybindingResolver, chordFromEvent, formatChord, formatSequence } from './keybindings';

/** Instancias únicas de la aplicación. */
export const commands = new CommandRegistry();
export const keybindings = new KeybindingResolver();
keybindings.setRules(DEFAULT_KEYBINDINGS);

/** Mensaje transitorio en la status bar (p. ej. acorde pendiente). */
interface KeyStatusState {
  message: string | null;
  set: (message: string | null) => void;
}

export const useKeyStatus = create<KeyStatusState>((set) => ({
  message: null,
  set: (message) => set({ message }),
}));

/** Atajo formateado de un comando, para menús y tooltips. */
export function keybindingLabel(command: string): string | undefined {
  const sequence: KeySequence | undefined = keybindings.lookup(command);
  return sequence ? formatSequence(sequence) : undefined;
}

type ContextProvider = () => readonly string[];
const contextProviders = new Set<ContextProvider>();

/** Agrega contextos calculados (p. ej. `editorTextFocus` según Monaco). */
export function registerContextProvider(provider: ContextProvider): () => void {
  contextProviders.add(provider);
  return () => contextProviders.delete(provider);
}

/**
 * Contextos de foco para las cláusulas `when`. Cada zona de la UI declara
 * `data-focus-context="treeFocus"` (u otro) y se toman todos los ancestros.
 */
export function currentContext(): Set<string> {
  const context = new Set<string>();
  for (const provider of contextProviders) provider().forEach((c) => context.add(c));
  let el: Element | null = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) context.add('inputFocus');
  while (el) {
    const value = el.getAttribute('data-focus-context');
    if (value) value.split(/\s+/).forEach((v) => context.add(v));
    el = el.parentElement;
  }
  return context;
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;

function showKeyMessage(message: string | null, clearAfterMs?: number): void {
  clearTimeout(messageTimer);
  useKeyStatus.getState().set(message);
  if (message && clearAfterMs)
    messageTimer = setTimeout(() => useKeyStatus.getState().set(null), clearAfterMs);
}

/** Instala el manejador global de atajos. Devuelve la función para quitarlo. */
export function installKeybindingHandler(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const chord = chordFromEvent(event);
    if (!chord) return;
    const result = keybindings.resolve(chord, currentContext(), (id) => commands.isEnabled(id));
    switch (result.kind) {
      case 'command':
        event.preventDefault();
        event.stopPropagation();
        showKeyMessage(null);
        void commands.execute(result.command);
        break;
      case 'chord-pending':
        // Dentro de Monaco los acordes los resuelve el editor (tiene los suyos, como Ctrl+K Ctrl+0, y
        // también los de la app, registrados en setup.ts): no se interceptan aquí.
        if (event.target instanceof Element && event.target.closest('.monaco-editor')) {
          keybindings.reset();
          break;
        }
        event.preventDefault();
        event.stopPropagation();
        showKeyMessage(es.statusBar.chordPending(formatChord(result.first)));
        break;
      case 'no-match':
        if (result.afterChord) {
          event.preventDefault();
          event.stopPropagation();
          showKeyMessage(es.statusBar.chordUnknown(formatChord(chord)), 3000);
        }
        break;
    }
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
