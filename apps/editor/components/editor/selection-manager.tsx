import { emitter, sceneRegistry } from "@pascal-app/core";

import { useViewer } from "@pascal-app/viewer";
import { useEffect } from "react";
import useEditor from "@/store/use-editor";

const PHASE_CONFIG = {
  site: ["building"],
  structure: ["wall", "slab", "door", "window", "column", "stair"],
  furnish: ["item"], // furniture, decor, etc.
} as const;

type PhaseType = keyof typeof PHASE_CONFIG;

export const SelectionManager = () => {
  const phase = useEditor((s) => s.phase);
  const mode = useEditor((s) => s.mode);
  const { setSelection, selection } = useViewer();

  useEffect(() => {
    if (mode !== "select") return;

    const allowedTypes = PHASE_CONFIG[phase] || [];

    const onEnter = (event: any) => {
      // Only hover if the node type is allowed in this phase
      if (allowedTypes.includes(event.node.type)) {
        useViewer.getState().setHoveredId(event.node.id);
      }
    };

    const onLeave = () => useViewer.getState().setHoveredId(null);

    const onClick = (event: any) => {
      event.stopPropagation();
      const { id, type } = event.node;

      if (!allowedTypes.includes(type)) return;

      const isShift = event.nativeEvent?.shiftKey;

      if (isShift) {
        const isSelected = selection.selectedIds.includes(id);
        const nextIds = isSelected
          ? selection.selectedIds.filter((i) => i !== id)
          : [...selection.selectedIds, id];
        setSelection({ selectedIds: nextIds });
      } else {
        setSelection({ selectedIds: [id] });
      }
    };

    // BINDING: Loop through all allowed types for this phase
    allowedTypes.forEach((type) => {
      emitter.on(`${type}:enter`, onEnter);
      emitter.on(`${type}:leave`, onLeave);
      emitter.on(`${type}:click`, onClick);
    });

    const onGridClick = () => setSelection({ selectedIds: [] });
    emitter.on("grid:click", onGridClick);

    return () => {
      allowedTypes.forEach((type) => {
        emitter.off(`${type}:enter`, onEnter);
        emitter.off(`${type}:leave`, onLeave);
        emitter.off(`${type}:click`, onClick);
      });
      emitter.off("grid:click", onGridClick);
    };
  }, [phase, mode, selection.selectedIds, setSelection]);

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
