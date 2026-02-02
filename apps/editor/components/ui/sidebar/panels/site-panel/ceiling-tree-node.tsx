import { CeilingNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState } from "react";
import { RenamePopover } from "./rename-popover";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface CeilingTreeNodeProps {
  node: CeilingNode;
  depth: number;
}

export function CeilingTreeNode({ node, depth }: CeilingTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id));
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

  const handleClick = () => {
    setSelection({ selectedIds: [node.id] });
  };

  const handleDoubleClick = () => {
    setRenameOpen(true);
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
    <RenamePopover
      node={node}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <TreeNodeWrapper
        icon={<Image src="/icons/ceiling.png" alt="" width={14} height={14} className="object-contain" />}
        label={node.name || defaultName}
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
    </RenamePopover>
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
