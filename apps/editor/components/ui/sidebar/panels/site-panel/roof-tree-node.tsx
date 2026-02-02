import { RoofNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState } from "react";
import { RenamePopover } from "./rename-popover";
import { TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface RoofTreeNodeProps {
  node: RoofNode;
  depth: number;
}

export function RoofTreeNode({ node, depth }: RoofTreeNodeProps) {
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

  // Calculate dimensions: length × total width (leftWidth + rightWidth)
  const totalWidth = node.leftWidth + node.rightWidth;
  const sizeLabel = `${node.length.toFixed(1)}×${totalWidth.toFixed(1)}m`;
  const defaultName = `Roof (${sizeLabel})`;

  return (
    <RenamePopover
      node={node}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <TreeNodeWrapper
        icon={<Image src="/icons/roof.png" alt="" width={14} height={14} className="object-contain" />}
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
        isVisible={node.visible !== false}
        actions={<TreeNodeActions node={node} />}
      />
    </RenamePopover>
  );
}
