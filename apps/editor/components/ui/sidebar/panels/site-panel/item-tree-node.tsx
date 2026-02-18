import { ItemNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState } from "react";
import { RenamePopover } from "./rename-popover";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

const CATEGORY_ICONS: Record<string, string> = {
  door: "/icons/door.png",
  window: "/icons/window.png",
  furniture: "/icons/couch.png",
  appliance: "/icons/appliance.png",
  kitchen: "/icons/kitchen.png",
  bathroom: "/icons/bathroom.png",
  outdoor: "/icons/tree.png",
};

interface ItemTreeNodeProps {
  node: ItemNode;
  depth: number;
}

export function ItemTreeNode({ node, depth }: ItemTreeNodeProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const iconSrc = CATEGORY_ICONS[node.asset.category] || "/icons/couch.png";
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

  const defaultName = node.asset.name || "Item";
  const hasChildren = node.children && node.children.length > 0;

  return (
    <RenamePopover
      node={node}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <TreeNodeWrapper
        icon={<Image src={iconSrc} alt="" width={14} height={14} className="object-contain" />}
        label={node.name || defaultName}
        depth={depth}
        hasChildren={hasChildren}
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
        {hasChildren && node.children.map((childId) => (
          <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
        ))}
      </TreeNodeWrapper>
    </RenamePopover>
  );
}
