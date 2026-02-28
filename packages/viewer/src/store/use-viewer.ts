"use client";

import type {
  AnyNode,
  BaseNode,
  BuildingNode,
  LevelNode,
  ZoneNode,
} from "@pascal-app/core";
import type { Object3D } from "three";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type SelectionPath = {
  buildingId: BuildingNode["id"] | null;
  levelId: LevelNode["id"] | null;
  zoneId: ZoneNode["id"] | null;
  selectedIds: BaseNode["id"][]; // For items/assets (multi-select)
};

type Outliner = {
  selectedObjects: Object3D[];
  hoveredObjects: Object3D[];
};

type ViewerState = {
  isEditor: boolean
  setIsEditor: (isEditor: boolean) => void

  selection: SelectionPath
  hoveredId: AnyNode['id'] | ZoneNode['id'] | null
  setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void

  cameraMode: 'perspective' | 'orthographic'
  setCameraMode: (mode: 'perspective' | 'orthographic') => void

  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void

  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'
  setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void

  wallMode: 'up' | 'cutaway' | 'down'
  setWallMode: (mode: 'up' | 'cutaway' | 'down') => void

  showScans: boolean
  setShowScans: (show: boolean) => void

  showGuides: boolean
  setShowGuides: (show: boolean) => void

  showGrid: boolean
  setShowGrid: (show: boolean) => void

  projectId: string | null
  setProjectId: (id: string | null) => void
  projectPreferences: Record<string, { showScans?: boolean, showGuides?: boolean, showGrid?: boolean }>

  // Smart selection update
  setSelection: (updates: Partial<SelectionPath>) => void
  resetSelection: () => void

  outliner: Outliner // No setter as we will manipulate directly the arrays

  // Export functionality
  exportScene: (() => Promise<void>) | null
  setExportScene: (fn: (() => Promise<void>) | null) => void

  cameraDragging: boolean
  setCameraDragging: (dragging: boolean) => void
}

const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      isEditor: false,
      setIsEditor: (isEditor) => set({ isEditor }),
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      hoveredId: null,
      setHoveredId: (id) => set({ hoveredId: id }),

      cameraMode: "perspective",
      setCameraMode: (mode) => set({ cameraMode: mode }),

      theme: "light",
      setTheme: (theme) => set({ theme }),

      levelMode: "stacked",
      setLevelMode: (mode) => set({ levelMode: mode }),

      wallMode: 'up',
      setWallMode: (mode) => set({ wallMode: mode }),

      showScans: true,
      setShowScans: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) };
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showScans: show,
            };
          }
          return { showScans: show, projectPreferences };
        }),

      showGuides: true,
      setShowGuides: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) };
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showGuides: show,
            };
          }
          return { showGuides: show, projectPreferences };
        }),

      showGrid: true,
      setShowGrid: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) };
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showGrid: show,
            };
          }
          return { showGrid: show, projectPreferences };
        }),

      projectId: null,
      setProjectId: (id) =>
        set((state) => {
          if (!id) return { projectId: id };
          const prefs = state.projectPreferences?.[id] || {};
          return {
            projectId: id,
            showScans: prefs.showScans ?? true,
            showGuides: prefs.showGuides ?? true,
            showGrid: prefs.showGrid ?? true,
          };
        }),
      projectPreferences: {},

      setSelection: (updates) =>
        set((state) => {
          const newSelection = { ...state.selection, ...updates };

          // Hierarchy Guard: If we change a high-level parent, reset the children unless explicitly provided
          if (updates.buildingId !== undefined) {
            if (updates.levelId === undefined) newSelection.levelId = null;
            if (updates.zoneId === undefined) newSelection.zoneId = null;
            if (updates.selectedIds === undefined) newSelection.selectedIds = [];
          }
          if (updates.levelId !== undefined) {
            if (updates.zoneId === undefined) newSelection.zoneId = null;
            if (updates.selectedIds === undefined) newSelection.selectedIds = [];
          }
          if (updates.zoneId !== undefined) {
            if (updates.selectedIds === undefined) newSelection.selectedIds = [];
          }

          return { selection: newSelection };
        }),

      resetSelection: () =>
        set({
          selection: {
            buildingId: null,
            levelId: null,
            zoneId: null,
            selectedIds: [],
          },
        }),

      outliner: { selectedObjects: [], hoveredObjects: [] },

      exportScene: null,
      setExportScene: (fn) => set({ exportScene: fn }),

      cameraDragging: false,
      setCameraDragging: (dragging) => set({ cameraDragging: dragging }),
    }),
    {
      name: 'viewer-preferences',
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        theme: state.theme,
        levelMode: state.levelMode,
        wallMode: state.wallMode,
        projectPreferences: state.projectPreferences,
      }),
    },
  ),
);

export default useViewer;
