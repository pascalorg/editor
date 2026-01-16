"use client";

import { LevelNode } from "@pascal-app/core";
import { create } from "zustand";

type ViewerState = {
  levelMode: "stacked" | "exploded" | "solo" | "manual";
  setLevelMode: (mode: "stacked" | "exploded" | "solo" | "manual") => void;

  currentLevelId: LevelNode["id"] | null;
  setCurrentLevelId: (id: LevelNode["id"] | null) => void;
};

const useViewer = create<ViewerState>()((set, get) => ({
  levelMode: "exploded",
  setLevelMode: (mode) => set({ levelMode: mode }),
  currentLevelId: null,
  setCurrentLevelId: (id) => set({ currentLevelId: id }),
}));

export default useViewer;
