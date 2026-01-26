import { SlabNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { RectangleHorizontal } from "lucide-react";
import { TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface SlabTreeNodeProps {
  node: SlabNode;
  depth: number;
}

export function SlabTreeNode({ node, depth }: SlabTreeNodeProps) {
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id));
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

  const handleClick = () => {
    setSelection({ selectedIds: [node.id] });
  };

  const handleMouseEnter = () => {
    setHoveredId(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
  };

  // Calculate approximate area from polygon
  const area = calculatePolygonArea(node.polygon).toFixed(1);

  return (
    <TreeNodeWrapper
      icon={<RectangleHorizontal className="w-3.5 h-3.5" />}
      label={node.name || `Slab (${area}m²)`}
      depth={depth}
      hasChildren={false}
      expanded={false}
      onToggle={() => {}}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      isSelected={isSelected}
      isHovered={isHovered}
      actions={<TreeNodeActions node={node} />}
    />
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
