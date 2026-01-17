"use client";

import { create } from "zustand";
import { BuildingNode, ItemNode } from "../schema";
import { LevelNode } from "../schema/nodes/level";
import { WallNode } from "../schema/nodes/wall";
import { AnyNode, AnyNodeId } from "../schema/types";
import { temporal } from "zundo";

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

  createNode: (node: AnyNode, parentId?: AnyNodeId) => void;
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void;
};

type PartializedStoreState = Pick<SceneState, 'rootNodeIds' | 'nodes'>;

const useScene = create<SceneState>()(temporal((set, get) => ({
  
  // 1. Flat dictionary of all nodes
  nodes: {},

  // 2. Root node IDs
  rootNodeIds: [],

  // 3. Dirty set
  dirtyNodes: new Set<AnyNodeId>(),

  loadScene: () => {

    const building = BuildingNode.parse({
        children: [],
    });


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

    building.children.push(level0.id, level1.id, level2.id);

    // Define all nodes flat
    const nodes: Record<AnyNodeId, AnyNode> = {
      [building.id]: building,
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
    const rootNodeIds = [building.id];

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

  createNodes: (ops) => {
  set((state) => {
    const nextNodes = { ...state.nodes };
    const nextRootIds = [...state.rootNodeIds];

    for (const { node, parentId } of ops) {
      // 1. Assign parentId to the child (Safe because BaseNode has parentId)
      const newNode = { 
        ...node, 
        parentId: parentId ?? null 
      };
      
      nextNodes[newNode.id] = newNode;

      // 2. Update the Parent's children list
      if (parentId && nextNodes[parentId]) {
        const parent = nextNodes[parentId];

        // Type Guard: Check if the parent node is a container that supports children
        if ("children" in parent && Array.isArray(parent.children)) {
          nextNodes[parentId] = {
            ...parent,
            // Use Set to prevent duplicate IDs if createNode is called twice
            children: Array.from(new Set([...parent.children, newNode.id])) as any, // We don't verify child types here
          };
        }
      } else if (!parentId) {
        // 3. Handle Root nodes
        if (!nextRootIds.includes(newNode.id)) {
          nextRootIds.push(newNode.id);
        }
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds };
  });

  // 4. System Sync
  ops.forEach(({ node, parentId }) => {
    get().markDirty(node.id);
    if (parentId) get().markDirty(parentId);
  });
},

  // 3. The CONVENIENCE (Singular)
  createNode: (node, parentId) => get().createNodes([{ node, parentId }]),

  
}), {
  partialize: (state) => {
    const { nodes, rootNodeIds } = state; // Only track nodes and rootNodeIds in history
    return { nodes, rootNodeIds}
  },
  limit: 50, // Limit to last 50 actions
}));

useScene.getState().loadScene();
export default useScene;


// Subscribe to the temporal store (Undo/Redo events)
useScene.temporal.subscribe((state, prevState) => {
  // Check if we just jumped in time (Undo/Redo)
  // If the 'nodes' object changed but it wasn't a normal 'set'
  const currentNodes = useScene.getState().nodes;
  
  // Trigger a full scene re-validation
  Object.values(currentNodes).forEach(node => {
    if (node.type === 'wall') {
       useScene.getState().markDirty(node.id);
    }
  });
});