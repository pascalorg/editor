import { CeilingNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState, useEffect } from "react";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface CeilingTreeNodeProps {
  node: CeilingNode;
  depth: number;
}

export function CeilingTreeNode({ node, depth }: CeilingTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const isSelected = selectedIds.includes(node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    const nodes = useScene.getState().nodes;
    let isDescendant = false;
    for (const id of selectedIds) {
      let current = nodes[id];
      while (current && current.parentId) {
        if (current.parentId === node.id) {
          isDescendant = true;
          break;
        }
        current = nodes[current.parentId];
      }
      if (isDescendant) break;
    }
    if (isDescendant) {
      setExpanded(true);
    }
  }, [selectedIds, node.id]);

  const handleClick = () => {
    setSelection({ selectedIds: [node.id] });
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleMouseEnter = () => {
    setHoveredId(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
  };

  // Calculate approximate area from polygon
  const area = calculatePolygonArea(node.polygon).toFixed(1);
  const defaultName = `Ceiling (${area}m²)`;

  return (
    <TreeNodeWrapper
      icon={<Image src="/icons/ceiling.png" alt="" width={14} height={14} className="object-contain" />}
      label={
        <InlineRenameInput
          node={node}
          isEditing={isEditing}
          onStopEditing={() => setIsEditing(false)}
          onStartEditing={() => setIsEditing(true)}
          defaultName={defaultName}
        />
      }
      depth={depth}
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      isSelected={isSelected}
      isHovered={isHovered}
      isVisible={node.visible !== false}
      actions={<TreeNodeActions node={node} />}
    >
      {node.children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </TreeNodeWrapper>
  );
}

/**
 * Calculate the area of a polygon using the shoelace formula
 */
function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0;

  let area = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i]![0] * polygon[j]![1];
    area -= polygon[j]![0] * polygon[i]![1];
  }

  return Math.abs(area) / 2;
}
