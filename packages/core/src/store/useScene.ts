import { create } from "zustand";
import { ItemNode } from "../schema/nodes/item";
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

  levelMode: "stacked" | "exploded" | "solo" | "manual";
  setLevelMode: (mode: "stacked" | "exploded" | "solo" | "manual") => void;
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

    level0.children.push(wall0.id, wall1.id, wall2.id, wall3.id);

    // Define all nodes flat
    const nodes: Record<AnyNodeId, AnyNode> = {
      // Level 0

      wall_0_0: WallNode.parse({
        id: "wall_0_0",
        start: [0, 0],
        end: [5, 0],
        children: ["item_1_1", "item_1_2", "item_1_3"],
      }),
      wall_0_1: WallNode.parse({
        id: "wall_0_1",
        start: [0, 0],
        end: [0, 5],
      }),
      wall_0_2: WallNode.parse({
        id: "wall_0_2",
        start: [5, 5],
        end: [0, 5],
      }),
      wall_0_3: WallNode.parse({
        id: "wall_0_3",
        start: [5, 5],
        end: [5, 0],
      }),

      // Level 1
      level_1: LevelNode.parse({
        id: "level_1",
        level: 1,
        children: ["item_1_0"],
      }),
      item_1_0: ItemNode.parse({
        id: "item_1_0",
        position: [-1, 0, 0],
      }),
      item_1_1: ItemNode.parse({
        id: "item_1_1",
        parentId: "wall_0_0",
        position: [2.5, 0.8, 0],
      }),
      item_1_2: ItemNode.parse({
        id: "item_1_2",
        parentId: "wall_0_0",
        position: [1, 0.8, 0],
      }),
      item_1_3: ItemNode.parse({
        id: "item_1_3",
        parentId: "wall_0_0",
        position: [4, 0.8, 0],
      }),

      // Level 2
      level_2: LevelNode.parse({
        id: "level_2",
        level: 2,
        children: [],
      }),
    };

    // Root nodes are the levels
    const rootNodeIds = ["level_0", "level_1", "level_2"];

    get().dirtyNodes.add("wall_0_0");
    get().dirtyNodes.add("wall_0_1");
    get().dirtyNodes.add("wall_0_2");
    get().dirtyNodes.add("wall_0_3");
    set({ nodes, rootNodeIds });
  },

  markDirty: (id: string) => {
    get().dirtyNodes.add(id);
  },

  clearDirty: (id: string) => {
    get().dirtyNodes.delete(id);
  },

  levelMode: "exploded",
  setLevelMode: (mode) => set({ levelMode: mode }),
}));

useScene.getState().loadScene();
export default useScene;
