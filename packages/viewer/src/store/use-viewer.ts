"use client";

import { BuildingNode, ItemNode, LevelNode, Zone } from "@pascal-app/core";
import { create } from "zustand";

type SelectionPath = {
  buildingId: BuildingNode["id"] | null;
  levelId: LevelNode["id"] | null;
  zoneId: Zone["id"] | null;
  selectedIds: ItemNode["id"][]; // For items/assets (multi-select)
};

type ViewerState = {
  selection: SelectionPath;
  levelMode: "stacked" | "exploded" | "solo" | "manual";

  // Actions
  setLevelMode: (mode: "stacked" | "exploded" | "solo" | "manual") => void;

  // Smart selection update
  setSelection: (updates: Partial<SelectionPath>) => void;
  resetSelection: () => void;
};

const useViewer = create<ViewerState>()((set, get) => ({
  selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
  levelMode: "stacked",
  setLevelMode: (mode) => set({ levelMode: mode }),

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
}));

export default useViewer;
