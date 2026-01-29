import { ZoneNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useState } from "react";
import { RenamePopover } from "./rename-popover";
import { TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface ZoneTreeNodeProps {
  node: ZoneNode;
  depth: number;
}

export function ZoneTreeNode({ node, depth }: ZoneTreeNodeProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const isSelected = useViewer((state) => state.selection.zoneId === node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

  const handleClick = () => {
    setSelection({ zoneId: node.id });
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
  const defaultName = `Zone (${area}m²)`;

  return (
    <RenamePopover
      node={node}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <TreeNodeWrapper
        icon={
          <div
            className="w-3 h-3 rounded-sm border border-border/50"
            style={{ backgroundColor: node.color }}
          />
        }
        label={node.name || defaultName}
        depth={depth}
        hasChildren={false}
        expanded={false}
        onToggle={() => {}}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        isSelected={isSelected}
        isHovered={isHovered}
        actions={<TreeNodeActions node={node} />}
      />
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
