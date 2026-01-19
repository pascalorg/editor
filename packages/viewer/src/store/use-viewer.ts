"use client";

import { BuildingNode, LevelNode } from "@pascal-app/core";
import { create } from "zustand";

type ViewerState = {
  levelMode: "stacked" | "exploded" | "solo" | "manual";
  setLevelMode: (mode: "stacked" | "exploded" | "solo" | "manual") => void;

  currentBuildingId: BuildingNode["id"] | null;
  setCurrentBuildingId: (id: BuildingNode["id"] | null) => void;
  currentLevelId: LevelNode["id"] | null;
  setCurrentLevelId: (id: LevelNode["id"] | null) => void;
};

const useViewer = create<ViewerState>()((set, get) => ({
  levelMode: "stacked",
  setLevelMode: (mode) => set({ levelMode: mode }),
  currentLevelId: null,
  setCurrentLevelId: (id) => set({ currentLevelId: id }),
  currentBuildingId: null,
  setCurrentBuildingId: (id) => set({ currentBuildingId: id }),
}));

export default useViewer;
