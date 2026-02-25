import { WallNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import Image from "next/image";
import { useState } from "react";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface WallTreeNodeProps {
  node: WallNode;
  depth: number;
}

export function WallTreeNode({ node, depth }: WallTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id));
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);
  const setHoveredId = useViewer((state) => state.setHoveredId);

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

  const wallLength = Math.sqrt(
    Math.pow(node.end[0] - node.start[0], 2) +
      Math.pow(node.end[1] - node.start[1], 2),
  ).toFixed(1);

  const defaultName = `Wall (${wallLength}m/${node.height || 2.5}m)`;

  return (
    <TreeNodeWrapper
      icon={<Image src="/icons/wall.png" alt="" width={14} height={14} className="object-contain" />}
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
