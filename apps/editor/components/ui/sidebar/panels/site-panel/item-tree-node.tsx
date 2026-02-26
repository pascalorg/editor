import { type AnyNodeId, ItemNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState, useEffect } from "react";
import { InlineRenameInput } from "./inline-rename-input";
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
  const [isEditing, setIsEditing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const iconSrc = CATEGORY_ICONS[node.asset.category] || "/icons/couch.png";
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
      let current = nodes[id as AnyNodeId];
      while (current && current.parentId) {
        if (current.parentId === node.id) {
          isDescendant = true;
          break;
        }
        current = nodes[current.parentId as AnyNodeId];
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

  const defaultName = node.asset.name || "Item";
  const hasChildren = node.children && node.children.length > 0;

  return (
    <TreeNodeWrapper
      icon={<Image src={iconSrc} alt="" width={14} height={14} className="object-contain" />}
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
  );
}
