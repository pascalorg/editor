"use client";

import { create } from "zustand";
import { ItemNode } from "../schema";
import { LevelNode } from "../schema/nodes/level";
import { WallNode } from "../schema/nodes/wall";
import { AnyNode, AnyNodeId } from "../schema/types";

type SceneState = {
  // 1. The Data: A flat dictionary of all nodes
  nodes: Record<AnyNodeId, AnyNode>;

  // 2. The Root: Which nodes are at the top level?
  rootNodeIds: AnyNodeId[];

  // 3. The "Dirty" Set: For the Wall/Physics systems
  dirtyNodes: Set<AnyNodeId>;

  // Actions
  loadScene: () => void;
  markDirty: (id: AnyNodeId) => void;
  clearDirty: (id: AnyNodeId) => void;
};

const useScene = create<SceneState>()((set, get) => ({
  // 1. Flat dictionary of all nodes
  nodes: {},

  // 2. Root node IDs
  rootNodeIds: [],

  // 3. Dirty set
  dirtyNodes: new Set<AnyNodeId>(),

  loadScene: () => {
    const level0 = LevelNode.parse({
      level: 0,
      children: [],
    });
    const level1 = LevelNode.parse({
      level: 1,
      children: [],
    });
    const level2 = LevelNode.parse({
      level: 2,
      children: [],
    });

    const wall0 = WallNode.parse({
      start: [0, 0],
      end: [5, 0],
      children: [],
    });

    const wall1 = WallNode.parse({
      start: [0, 0],
      end: [0, 5],
      children: [],
    });

    const wall2 = WallNode.parse({
      start: [5, 5],
      end: [0, 5],
      children: [],
    });

    const wall3 = WallNode.parse({
      start: [5, 5],
      end: [5, 0],
      children: [],
    });

    const window1 = ItemNode.parse({
      type: "item",
      name: "Window",
      position: [2.5, 0.5, 0],
      asset: {
        category: "windows",
        attachTo: "wall",
        src: "/items/window-round/model.glb",
      },
    });

    wall0.children.push(window1.id);

    level0.children.push(wall0.id, wall1.id, wall2.id, wall3.id);

    // Define all nodes flat
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level0.id]: level0,
      [level1.id]: level1,
      [level2.id]: level2,
      [wall0.id]: wall0,
      [wall1.id]: wall1,
      [wall2.id]: wall2,
      [wall3.id]: wall3,
      [window1.id]: window1,
    };

    // Root nodes are the levels
    const rootNodeIds = [level0.id, level1.id, level2.id];

    get().dirtyNodes.add(wall0.id);
    get().dirtyNodes.add(wall1.id);
    get().dirtyNodes.add(wall2.id);
    get().dirtyNodes.add(wall3.id);
    set({ nodes, rootNodeIds });
  },

  markDirty: (id) => {
    get().dirtyNodes.add(id);
  },

  clearDirty: (id) => {
    get().dirtyNodes.delete(id);
  },
}));

useScene.getState().loadScene();
export default useScene;
