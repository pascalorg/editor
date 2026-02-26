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

type SelectableNodeType = "wall" | "item" | "building" | "zone" | 'slab' | 'ceiling' | 'roof' | 'window' | 'door';

interface SelectionStrategy {
  types: SelectableNodeType[];
  handleSelect: (node: AnyNode, isShift: boolean) => void;
  handleDeselect: () => void;
  isValid: (node: AnyNode) => boolean;
}

export const resolveBuildingId = (levelId: string, nodes: Record<string, AnyNode>): string | null => {
  const level = nodes[levelId];
  if (!level) return null;
  if (level.parentId && nodes[level.parentId]?.type === "building") {
    return level.parentId;
  }
  return null;
};

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
    types: ["wall", "item", "zone", "slab", "ceiling", "roof", "window", "door"],
    handleSelect: (node, isShift) => {
      const { selection, setSelection } = useViewer.getState();
      const nodes = useScene.getState().nodes;
      const nodeLevelId = resolveLevelId(node, nodes);
      const buildingId = resolveBuildingId(nodeLevelId, nodes);

      const updates: any = {};
      if (nodeLevelId !== "default" && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId;
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId;
      }

      if (node.type === 'zone') {
        updates.zoneId = node.id;
        // Don't reset selectedIds in structure phase for zone, but if we changed level, it might reset them via hierarchy guard.
        // Wait, the hierarchy guard resets zoneId if levelId changes. That's fine since we provide zoneId.
        setSelection(updates);
      } else {
        const nextIds = isShift
          ? selection.selectedIds.includes(node.id)
            ? selection.selectedIds.filter((id) => id !== node.id)
            : [...selection.selectedIds, node.id]
          : [node.id];
        
        updates.selectedIds = nextIds;
        setSelection(updates);
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
        if (node.type === "window" || node.type === "door") return true;

        return false;
      }
    },
  },

  furnish: {
    types: ["item"],
    handleSelect: (node, isShift) => {
      const { selection, setSelection } = useViewer.getState();
      const nodes = useScene.getState().nodes;
      const nodeLevelId = resolveLevelId(node, nodes);
      const buildingId = resolveBuildingId(nodeLevelId, nodes);

      const updates: any = {};
      if (nodeLevelId !== "default" && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId;
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId;
      }

      const nextIds = isShift
        ? selection.selectedIds.includes(node.id)
          ? selection.selectedIds.filter((id) => id !== node.id)
          : [...selection.selectedIds, node.id]
        : [node.id];
      
      updates.selectedIds = nextIds;
      setSelection(updates);
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

    const onClick = (event: NodeEvent) => {
      const node = event.node;
      let currentPhase = useEditor.getState().phase;
      let targetPhase = currentPhase;

      // Auto-switch between structure and furnish phases when clicking elements on the same level
      if (currentPhase === "structure" || currentPhase === "furnish") {
        if (isNodeInCurrentLevel(node)) {
          if (
            node.type === "wall" || 
            node.type === "slab" || 
            node.type === "ceiling" || 
            node.type === "roof" || 
            node.type === "window" || 
            node.type === "door"
          ) {
            targetPhase = "structure";
          } else if (node.type === "item") {
            const item = node as ItemNode;
            if (item.asset.category === "door" || item.asset.category === "window") {
              targetPhase = "structure";
            } else {
              targetPhase = "furnish";
            }
          }
          
          if (targetPhase !== currentPhase) {
            useEditor.getState().setPhase(targetPhase);
            if (targetPhase === "structure" && useEditor.getState().structureLayer === "zones") {
              useEditor.getState().setStructureLayer("elements");
            }
            currentPhase = targetPhase;
          }
        }
      }

      const activeStrategy = SELECTION_STRATEGIES[currentPhase];
      if (activeStrategy && activeStrategy.isValid(node)) {
        event.stopPropagation();
        const isShift = event.nativeEvent?.shiftKey;
        activeStrategy.handleSelect(node, isShift ?? false);
      }
    };

    const allTypes = ["wall", "item", "building", "zone", "slab", "ceiling", "roof", "window", "door"];
    allTypes.forEach((type) => {
      emitter.on(`${type}:click` as any, onClick as any);
    });

    const onGridClick = () => {
      const activeStrategy = SELECTION_STRATEGIES[useEditor.getState().phase];
      if (activeStrategy) activeStrategy.handleDeselect();
    };
    emitter.on("grid:click", onGridClick);

    return () => {
      allTypes.forEach((type) => {
        emitter.off(`${type}:click` as any, onClick as any);
      });
      emitter.off("grid:click", onGridClick);
    };
  }, [mode, movingNode]);

  // Global double-click handler for auto-switching phases and cross-phase hover
  useEffect(() => {
    if (mode !== "select") return;
    if (movingNode) return;

    const onEnter = (event: NodeEvent) => {
      const node = event.node;
      const currentPhase = useEditor.getState().phase;

      // Ignore site/building if we are already inside a building
      if (node.type === "building" || node.type === "site") {
        if (currentPhase === "structure" || currentPhase === "furnish") {
          return;
        }
      }

      // Ignore zones unless specifically in zones layer
      if (node.type === "zone") {
        if (currentPhase !== "structure" || useEditor.getState().structureLayer !== "zones") {
          return;
        }
      }

      // Check level constraint for interior nodes
      if (currentPhase === "structure" || currentPhase === "furnish") {
        if (!isNodeInCurrentLevel(node)) return;
      }

      event.stopPropagation();
      useViewer.setState({ hoveredId: node.id });
    };

    const onLeave = (event: NodeEvent) => {
      if (useViewer.getState().hoveredId === event.node.id) {
        useViewer.setState({ hoveredId: null });
      }
    };

    const onDoubleClick = (event: NodeEvent) => {
      const node = event.node;
      const currentPhase = useEditor.getState().phase;
      
      let targetPhase: "site" | "structure" | "furnish" | null = null;

      if (node.type === "building" || node.type === "site") {
        if (currentPhase === "structure" || currentPhase === "furnish") {
          return; // Ignore building/site double clicks if we are already inside a building
        }
        if (node.type === "building") {
          targetPhase = "structure";
        }
      } else if (
        node.type === "wall" || 
        node.type === "slab" || 
        node.type === "ceiling" || 
        node.type === "roof" || 
        node.type === "window" || 
        node.type === "door"
      ) {
        targetPhase = "structure";
      } else if (node.type === "item") {
        const item = node as ItemNode;
        if (item.asset.category === "door" || item.asset.category === "window") {
          targetPhase = "structure";
        } else {
          targetPhase = "furnish";
        }
      }

      if (node.type === "zone") {
        return;
      }

      if (targetPhase && targetPhase !== useEditor.getState().phase) {
        event.stopPropagation();
        
        useEditor.getState().setPhase(targetPhase);
        
        if (targetPhase === "structure" && useEditor.getState().structureLayer === "zones") {
          useEditor.getState().setStructureLayer("elements");
        }

        const strategy = SELECTION_STRATEGIES[targetPhase];
        if (strategy) {
          const isShift = event.nativeEvent?.shiftKey;
          strategy.handleSelect(node, isShift ?? false);
        }
      }
    };

    const allTypes = ["wall", "item", "building", "slab", "ceiling", "roof", "window", "door", "zone", "site"];
    allTypes.forEach((type) => {
      emitter.on(`${type}:enter` as any, onEnter as any);
      emitter.on(`${type}:leave` as any, onLeave as any);
      emitter.on(`${type}:double-click` as any, onDoubleClick as any);
    });

    return () => {
      allTypes.forEach((type) => {
        emitter.off(`${type}:enter` as any, onEnter as any);
        emitter.off(`${type}:leave` as any, onLeave as any);
        emitter.off(`${type}:double-click` as any, onDoubleClick as any);
      });
    };
  }, [mode, movingNode]);

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
