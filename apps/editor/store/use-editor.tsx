"use client";

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
  setPhase: (phase) => set({ phase }),
  mode: "select",
  setMode: (mode) => set({ mode }),
  tool: null,
  setTool: (tool) => set({ tool }),
}));

export default useEditor;
