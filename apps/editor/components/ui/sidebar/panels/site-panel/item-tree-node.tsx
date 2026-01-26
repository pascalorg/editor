import { ItemNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Box } from "lucide-react";
import { TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface ItemTreeNodeProps {
  node: ItemNode;
  depth: number;
}

export function ItemTreeNode({ node, depth }: ItemTreeNodeProps) {
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

  return (
    <TreeNodeWrapper
      icon={<Box className="w-3.5 h-3.5" />}
      label={node.name || node.asset.name || "Item"}
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
