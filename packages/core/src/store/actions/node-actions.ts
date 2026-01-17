import { AnyNode, AnyNodeId } from "../../schema";
import { SceneState } from "../use-scene";

export const createNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ops: { node: AnyNode; parentId?: AnyNodeId }[],
) => {
  set((state) => {
    const nextNodes = { ...state.nodes };
    const nextRootIds = [...state.rootNodeIds];

    for (const { node, parentId } of ops) {
      // 1. Assign parentId to the child (Safe because BaseNode has parentId)
      const newNode = {
        ...node,
        parentId: parentId ?? null,
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
            children: Array.from(
              new Set([...parent.children, newNode.id]),
            ) as any, // We don't verify child types here
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
};

export const updateNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
) => {
  const parentsToUpdate = new Set<string>();

  set((state) => {
    const nextNodes = { ...state.nodes };

    for (const { id, data } of updates) {
      const currentNode = nextNodes[id];
      if (!currentNode) continue;

      // Handle Reparenting Logic
      if (
        data.parentId !== undefined &&
        data.parentId !== currentNode.parentId
      ) {
        // 1. Remove from old parent
        if (currentNode.parentId && nextNodes[currentNode.parentId]) {
          const oldParent = nextNodes[currentNode.parentId] as AnyContainerNode;
          nextNodes[oldParent.id] = {
            ...oldParent,
            children: oldParent.children.filter((childId) => childId !== id),
          };
          parentsToUpdate.add(oldParent.id);
        }

        // 2. Add to new parent
        if (data.parentId && nextNodes[data.parentId]) {
          const newParent = nextNodes[data.parentId] as AnyContainerNode;
          nextNodes[newParent.id] = {
            ...newParent,
            children: Array.from(new Set([...newParent.children, id])),
          };
          parentsToUpdate.add(newParent.id);
        }
      }

      // Apply the update
      nextNodes[id] = { ...nextNodes[id], ...data };
    }

    return { nodes: nextNodes };
  });

  // Mark dirty
  updates.forEach((u) => get().markDirty(u.id));
  parentsToUpdate.forEach((pId) => get().markDirty(pId));
};

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  const parentsToMarkDirty = new Set<string>();

  set((state) => {
    const nextNodes = { ...state.nodes };
    let nextRootIds = [...state.rootNodeIds];

    for (const id of ids) {
      const node = nextNodes[id];
      if (!node) continue;

      // 1. Remove reference from Parent
      if (node.parentId && nextNodes[node.parentId]) {
        const parent = nextNodes[node.parentId] as AnyContainerNode;
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((cid) => cid !== id),
          };
          parentsToMarkDirty.add(parent.id);
        }
      }

      // 2. Remove from Root list
      nextRootIds = nextRootIds.filter((rid) => rid !== id);

      // 3. Delete the node itself
      delete nextNodes[id];

      // Inside the deleteNodes loop
      if ("children" in node && node.children.length > 0) {
        // Recursively delete all children first
        get().deleteNodes(node.children);
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds };
  });

  // Notify systems that the parent has changed (e.g. Wall needs to fill a window hole)
  parentsToMarkDirty.forEach((pId) => get().markDirty(pId));
};
