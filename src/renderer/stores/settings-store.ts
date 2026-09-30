import { create } from 'zustand';
import type { SettingKey, Settings } from '@shared/settings';
import { DEFAULT_SETTINGS } from '@shared/settings';

interface SettingsStore {
  settings: Settings;
  hydrate: (settings: Settings) => void;
  /** Cambia una preferencia (se guarda en settings.json). Devuelve false si main la rechazó. */
  update: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: (settings) => set({ settings }),
  update: async (key, value) => {
    const previous = get().settings;
    set({ settings: { ...previous, [key]: value } });
    const r = await window.api.settings.update({ key, value });
    set({ settings: r.ok ? r.data : previous });
    return r.ok;
  },
}));

/** Lectura puntual fuera de React. */
export function setting<K extends SettingKey>(key: K): Settings[K] {
  return useSettingsStore.getState().settings[key];
}
