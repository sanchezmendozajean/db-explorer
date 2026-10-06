import { create } from 'zustand';
import type { PanelLayout, SideBarView, ThemePreference, UiState } from '@shared/ui-state';
import { DEFAULT_UI_STATE } from '@shared/ui-state';

interface UiStore extends UiState {
  /** Tema efectivo (resuelve "system" con la preferencia del sistema operativo). */
  effectiveTheme: 'dark' | 'light';
  hydrate: (state: UiState) => void;
  setTheme: (theme: ThemePreference) => void;
  setSystemDark: (dark: boolean) => void;
  toggleSideBar: () => void;
  /** Muestra una vista; si ya está activa y visible, colapsa la barra (como VS Code). */
  showView: (view: SideBarView, toggleIfActive?: boolean) => void;
  togglePanel: () => void;
  toggleMaximizePanel: () => void;
  setEditorLayout: (layout: PanelLayout) => void;
}

let systemDark = true;

function resolveTheme(theme: ThemePreference): 'dark' | 'light' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

export const useUiStore = create<UiStore>((set, get) => ({
  ...DEFAULT_UI_STATE,
  effectiveTheme: 'dark',

  hydrate: (state) => set({ ...state, effectiveTheme: resolveTheme(state.theme) }),

  setTheme: (theme) => set({ theme, effectiveTheme: resolveTheme(theme) }),

  setSystemDark: (dark) => {
    systemDark = dark;
    set({ effectiveTheme: resolveTheme(get().theme) });
  },

  toggleSideBar: () => set((s) => ({ sideBar: { ...s.sideBar, visible: !s.sideBar.visible } })),

  showView: (view, toggleIfActive = false) =>
    set((s) => {
      if (toggleIfActive && s.sideBar.visible && s.sideBar.view === view) {
        return { sideBar: { ...s.sideBar, visible: false } };
      }
      return { sideBar: { visible: true, view } };
    }),

  togglePanel: () =>
    set((s) => ({
      panel: { visible: !s.panel.visible, maximized: s.panel.visible ? false : s.panel.maximized },
    })),

  toggleMaximizePanel: () => set((s) => ({ panel: { visible: true, maximized: !s.panel.maximized } })),

  setEditorLayout: (layout) => set((s) => ({ layout: { ...s.layout, editor: layout } })),
}));

/** Extrae la parte persistible del store. */
export function selectPersistedUiState(s: UiStore): UiState {
  return { version: 1, theme: s.theme, sideBar: s.sideBar, panel: s.panel, layout: s.layout };
}

/**
 * Guarda el estado de UI en main cada vez que cambia (con un pequeño retraso
 * para agrupar cambios seguidos, p. ej. al arrastrar un sash).
 */
export function startUiStatePersistence(delayMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = JSON.stringify(selectPersistedUiState(useUiStore.getState()));
  const flush = (): void => {
    const state = selectPersistedUiState(useUiStore.getState());
    const text = JSON.stringify(state);
    if (text === last) return;
    last = text;
    void window.api.app.setUiState(state);
  };
  const unsubscribe = useUiStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  const onUnload = (): void => flush();
  window.addEventListener('beforeunload', onUnload);
  return () => {
    unsubscribe();
    clearTimeout(timer);
    window.removeEventListener('beforeunload', onUnload);
  };
}
