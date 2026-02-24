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
  selection: SelectionPath
  hoveredId: AnyNode['id'] | ZoneNode['id'] | null
  setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void

  cameraMode: 'perspective' | 'orthographic'
  setCameraMode: (mode: 'perspective' | 'orthographic') => void

  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'
  setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void

  wallMode: 'up' | 'cutaway' | 'down'
  setWallMode: (mode: 'up' | 'cutaway' | 'down') => void

  showScans: boolean
  setShowScans: (show: boolean) => void

  showGuides: boolean
  setShowGuides: (show: boolean) => void

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
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      hoveredId: null,
      setHoveredId: (id) => set({ hoveredId: id }),

      cameraMode: "perspective",
      setCameraMode: (mode) => set({ cameraMode: mode }),

      levelMode: "stacked",
      setLevelMode: (mode) => set({ levelMode: mode }),

      wallMode: 'cutaway',
      setWallMode: (mode) => set({ wallMode: mode }),

      showScans: true,
      setShowScans: (show) => set({ showScans: show }),

      showGuides: true,
      setShowGuides: (show) => set({ showGuides: show }),

      setSelection: (updates) =>
        set((state) => {
          const newSelection = { ...state.selection, ...updates };

          // Hierarchy Guard: If we change a high-level parent, reset the children
          if (updates.buildingId !== undefined) {
            newSelection.levelId = null;
            newSelection.zoneId = null;
            newSelection.selectedIds = [];
          } else if (updates.levelId !== undefined) {
            newSelection.zoneId = null;
            newSelection.selectedIds = [];
          } else if (updates.zoneId !== undefined) {
            newSelection.selectedIds = [];
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
        levelMode: state.levelMode,
        wallMode: state.wallMode,
        showScans: state.showScans,
        showGuides: state.showGuides,
      }),
    },
  ),
);

export default useViewer;
