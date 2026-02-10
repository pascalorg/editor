import {
  type AnyNode,
  type BuildingNode,
  emitter,
  type ItemNode,
  type NodeEvent,
  resolveLevelId,
  sceneRegistry,
  useScene,
} from "@pascal-app/core";

import { useViewer } from "@pascal-app/viewer";
import { useEffect } from "react";
import useEditor from "@/store/use-editor";

const isNodeInCurrentLevel = (node: AnyNode): boolean => {
  const currentLevelId = useViewer.getState().selection.levelId;
  if (!currentLevelId) return true; // No level selected, allow all
  const nodeLevelId = resolveLevelId(node, useScene.getState().nodes);
  return nodeLevelId === currentLevelId;
};

type SelectableNodeType = "wall" | "item" | "building" | "zone" | 'slab' | 'ceiling' | 'roof';

interface SelectionStrategy {
  types: SelectableNodeType[];
  handleSelect: (node: AnyNode, isShift: boolean) => void;
  handleDeselect: () => void;
  isValid: (node: AnyNode) => boolean;
}

const SELECTION_STRATEGIES: Record<string, SelectionStrategy> = {
  site: {
    types: ["building"],
    handleSelect: (node) => {
      useViewer
        .getState()
        .setSelection({ buildingId: (node as BuildingNode).id });
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ buildingId: null });
    },
    isValid: (node) => node.type === "building",
  },

  structure: {
    types: ["wall", "item", "zone", "slab", "ceiling", "roof"],
    handleSelect: (node, isShift) => {
      const { selection, setSelection } = useViewer.getState();
      if (node.type === 'zone') {
        setSelection({ zoneId: node.id });
      } else {
      const nextIds = isShift
        ? selection.selectedIds.includes(node.id)
          ? selection.selectedIds.filter((id) => id !== node.id)
          : [...selection.selectedIds, node.id]
        : [node.id];
      setSelection({ selectedIds: nextIds });
      }
    },
    handleDeselect: () => {
      const structureLayer = useEditor.getState().structureLayer;
      if (structureLayer === "zones") {
        useViewer.getState().setSelection({ zoneId: null });
      } else {
        useViewer.getState().setSelection({ selectedIds: [] });
      }
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false;
      const structureLayer = useEditor.getState().structureLayer;
      if (structureLayer === "zones") {
        if (node.type === "zone") return true;
        return false;
      } else {
        if (node.type === "wall" || node.type === "slab" || node.type === "ceiling" || node.type === "roof") return true;
        if (node.type === "item") {
          return (
            (node as ItemNode).asset.category === "door" ||
            (node as ItemNode).asset.category === "window"
          );
        }
        return false;
      }
    },
  },

  furnish: {
    types: ["item"],
    handleSelect: (node, isShift) => {
      const { selection, setSelection } = useViewer.getState();
      const nextIds = isShift
        ? selection.selectedIds.includes(node.id)
          ? selection.selectedIds.filter((id) => id !== node.id)
          : [...selection.selectedIds, node.id]
        : [node.id];
      setSelection({ selectedIds: nextIds });
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ selectedIds: [] });
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false;
      if (node.type !== "item") return false;
      const item = node as ItemNode;
      return item.asset.category !== "door" && item.asset.category !== "window";
    },
  },
};

export const SelectionManager = () => {
  const phase = useEditor((s) => s.phase);
  const mode = useEditor((s) => s.mode);

  const movingNode = useEditor((s) => s.movingNode);

  useEffect(() => {
    if (mode !== "select") return;
    if (movingNode) return;

    const strategy = SELECTION_STRATEGIES[phase];
    if (!strategy) return;

    const onEnter = (event: NodeEvent) => {
      if (strategy.isValid(event.node)) {
        event.stopPropagation();
        useViewer.setState({ hoveredId: event.node.id });
      }
    };

    const onLeave = (event: NodeEvent) => {
      if (strategy.isValid(event.node)) {
        event.stopPropagation();
        useViewer.setState({ hoveredId: null });
      }
    };

    const onClick = (event: NodeEvent) => {
      if (!strategy.isValid(event.node)) return;

      event.stopPropagation();
      const isShift = event.nativeEvent?.shiftKey;
      strategy.handleSelect(event.node, isShift);
    };

    // Bind listeners for all potential types this strategy might care about
    strategy.types.forEach((type) => {
      emitter.on(`${type}:enter`, onEnter);
      emitter.on(`${type}:leave`, onLeave);
      emitter.on(`${type}:click`, onClick);
    });

    const onGridClick = () => strategy.handleDeselect();
    emitter.on("grid:click", onGridClick);

    return () => {
      strategy.types.forEach((type) => {
        emitter.off(`${type}:enter`, onEnter);
        emitter.off(`${type}:leave`, onLeave);
        emitter.off(`${type}:click`, onClick);
      });
      emitter.off("grid:click", onGridClick);
    };
  }, [phase, mode, movingNode]);

  return <EditorOutlinerSync />;
};

const EditorOutlinerSync = () => {
  const phase = useEditor((s) => s.phase);
  const selection = useViewer((s) => s.selection);
  const hoveredId = useViewer((s) => s.hoveredId);
  const outliner = useViewer((s) => s.outliner);

  useEffect(() => {
    let idsToHighlight: string[] = [];

    // 1. Determine what should be highlighted based on Phase
    switch (phase) {
      case "site":
        // Only highlight the building if one is selected
        if (selection.buildingId) idsToHighlight = [selection.buildingId];
        break;

      case "structure":
        // Highlight selected items (walls/slabs)
        // We IGNORE buildingId even if it's set in the store
        idsToHighlight = selection.selectedIds;
        break;

      case "furnish":
        // Highlight selected furniture/items
        idsToHighlight = selection.selectedIds;
        break;

      default:
        // Pure Viewer mode: Highlight based on the "deepest" selection
        if (selection.selectedIds.length > 0)
          idsToHighlight = selection.selectedIds;
        else if (selection.levelId) idsToHighlight = [selection.levelId];
        else if (selection.buildingId) idsToHighlight = [selection.buildingId];
    }

    // 2. Sync with the imperative outliner arrays (mutate in place to keep references)
    outliner.selectedObjects.length = 0;
    for (const id of idsToHighlight) {
      const obj = sceneRegistry.nodes.get(id);
      if (obj) outliner.selectedObjects.push(obj);
    }

    outliner.hoveredObjects.length = 0;
    if (hoveredId) {
      const obj = sceneRegistry.nodes.get(hoveredId);
      if (obj) outliner.hoveredObjects.push(obj);
    }
  }, [phase, selection, hoveredId, outliner]);

  return null;
};
