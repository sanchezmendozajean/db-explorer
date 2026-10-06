import { create } from 'zustand';
import type { SettingKey, Settings } from '@shared/settings';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { withoutKey } from '@shared/records';

interface SettingsStore {
  settings: Settings;
  hydrate: (settings: Settings) => void;
  /** Cambia una preferencia (se guarda en settings.json). Devuelve false si main la rechazó. */
  update: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<boolean>;
  /** Quita la clave de settings.json: vuelve al valor por defecto. */
  reset: (key: SettingKey) => Promise<boolean>;
  /** Cambia una opción de Monaco (`editor.<nombre>`); `undefined` la quita. */
  updateEditor: (name: string, value: unknown) => Promise<boolean>;
}

/**
 * Valores que se están guardando. Un `settings:changed` de un guardado anterior
 * puede llegar después del cambio optimista: no debe volver al valor viejo
 * (el control parpadeaba y un clic parecía no hacer nada).
 */
const inFlight = new Map<SettingKey, unknown>();

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: (settings) => set({ settings: { ...settings, ...Object.fromEntries(inFlight) } }),
  update: async (key, value) => {
    const previous = get().settings;
    inFlight.set(key, value);
    set({ settings: { ...previous, [key]: value } });
    const r = await window.api.settings.update({ key, value });
    if (inFlight.get(key) === value) inFlight.delete(key);
    set({
      settings: r.ok
        ? { ...r.data, ...Object.fromEntries(inFlight) }
        : { ...previous, ...Object.fromEntries(inFlight) },
    });
    return r.ok;
  },
  reset: async (key) => {
    const previous = get().settings;
    set({ settings: { ...previous, [key]: DEFAULT_SETTINGS[key] } });
    const r = await window.api.settings.update({ key, value: undefined });
    set({ settings: r.ok ? { ...r.data, ...Object.fromEntries(inFlight) } : previous });
    return r.ok;
  },
  updateEditor: async (name, value) => {
    const previous = get().settings;
    const editor =
      value === undefined ? withoutKey(previous.editor, name) : { ...previous.editor, [name]: value };
    set({ settings: { ...previous, editor } });
    const r = await window.api.settings.update({ key: `editor.${name}`, value });
    set({ settings: r.ok ? { ...r.data, ...Object.fromEntries(inFlight) } : previous });
    return r.ok;
  },
}));

/** Lectura puntual fuera de React. */
export function setting<K extends SettingKey>(key: K): Settings[K] {
  return useSettingsStore.getState().settings[key];
}
