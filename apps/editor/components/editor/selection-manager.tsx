import { emitter, sceneRegistry } from "@pascal-app/core";

import { useViewer } from "@pascal-app/viewer";
import { useEffect } from "react";
import useEditor from "@/store/use-editor";

const SELECTION_STRATEGIES = {
  site: {
    types: ["building"],
    handleSelect: (node: any, isShift: boolean) => {
      useViewer.getState().setSelection({ buildingId: node.id });
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ buildingId: null });
    },
    isValid: (node: any) => node.type === "building",
  },

  structure: {
    types: ["wall", "item"],
    handleSelect: (node: any, isShift: boolean) => {
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
    isValid: (node: any) => {
      if (node.type === "wall") return true;
      if (node.type === "item") {
        return node.category === "door" || node.category === "window";
      }
      return false;
    },
  },

  furnish: {
    types: ["item"],
    handleSelect: (node: any, isShift: boolean) => {
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
    isValid: (node: any) => {
      return (
        node.type === "item" &&
        node.category !== "door" &&
        node.category !== "window"
      );
    },
  },
};

export const SelectionManager = () => {
  const phase = useEditor((s) => s.phase);
  const mode = useEditor((s) => s.mode);

  useEffect(() => {
    if (mode !== "select") return;

    const strategy = SELECTION_STRATEGIES[phase];
    if (!strategy) return;

    const onEnter = (event: any) => {
      if (strategy.isValid(event.node)) {
        useViewer.setState({ hoveredId: event.node.id });
      }
    };

    const onLeave = () => useViewer.setState({ hoveredId: null });

    const onClick = (event: any) => {
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
  }, [phase, mode]);

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
