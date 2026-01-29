import { RoofNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Home } from "lucide-react";
import { TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface RoofTreeNodeProps {
  node: RoofNode;
  depth: number;
}

export function RoofTreeNode({ node, depth }: RoofTreeNodeProps) {
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

  // Calculate dimensions: length × total width (leftWidth + rightWidth)
  const totalWidth = node.leftWidth + node.rightWidth;
  const sizeLabel = `${node.length.toFixed(1)}×${totalWidth.toFixed(1)}m`;

  return (
    <TreeNodeWrapper
      icon={<Home className="w-3.5 h-3.5" />}
      label={node.name || `Roof (${sizeLabel})`}
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
