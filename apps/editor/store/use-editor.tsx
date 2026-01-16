"use client";

import { BuildingNode, LevelNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { create } from "zustand";

export type Phase = "site" | "structure" | "furnish";
export type Mode = "select" | "edit" | "delete" | "build";

// Structure mode tools (building elements)
export type StructureTool =
  | "wall"
  | "room"
  | "custom-room"
  | "slab"
  | "ceiling"
  | "roof"
  | "column"
  | "stair"
  | "door"
  | "window"
  | "zone";

// Furnish mode tools (items and decoration)
export type FurnishTool =
  | "furniture"
  | "appliance"
  | "kitchen"
  | "bathroom"
  | "outdoor"
  | "painting";

// Site mode tools
export type SiteTool = "property-line";

// Combined tool type
export type Tool = SiteTool | StructureTool | FurnishTool;

type EditorState = {
  phase: Phase;
  setPhase: (phase: Phase) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  tool: Tool | null;
  setTool: (tool: Tool | null) => void;
};

const useEditor = create<EditorState>()((set, get) => ({
  phase: "site",
  setPhase: (phase) => {
    const currentPhase = get().phase;
    if (currentPhase === phase) return;

    set({ phase });

    const viewer = useViewer.getState();
    const scene = useScene.getState();

    switch (phase) {
      case "site":
        // In Site mode, we zoom out and deselect specific levels/buildings
        viewer.setCurrentBuildingId(null);
        viewer.setCurrentLevelId(null);
        viewer.setLevelMode("stacked");
        break;

      case "structure":
        // In Structure mode, we often want to focus on a specific building/level
        // Auto-select the first building if none is selected
        if (!viewer.currentBuildingId) {
          const firstBuildingId = scene.rootNodeIds.find((id) => {
            const node = scene.nodes[id];
            return node?.type === "building" || null;
          });
          if (firstBuildingId) {
            viewer.setCurrentBuildingId(firstBuildingId as BuildingNode["id"]);
            const buildingNode = scene.nodes[firstBuildingId] as BuildingNode;
            const firstLevelId = buildingNode.children[0];
            if (firstLevelId) {
              viewer.setCurrentLevelId(firstLevelId as LevelNode["id"]);
            }
          }
        }
        viewer.setLevelMode("exploded"); // Better for structure editing
        break;

      case "furnish":
        // Maybe in furnish mode we force "solo" level view to see inside rooms
        viewer.setLevelMode("solo");
        break;
      }
  },
  mode: "select",
  setMode: (mode) => set({ mode }),
  tool: null,
  setTool: (tool) => set({ tool }),
}));

export default useEditor;
