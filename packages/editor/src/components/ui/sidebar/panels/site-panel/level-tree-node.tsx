import { LevelNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Layers } from "lucide-react";
import { useState } from "react";
import { InlineRenameInput } from "./inline-rename-input";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface LevelTreeNodeProps {
  node: LevelNode;
  depth: number;
  isLast?: boolean;
}

export function LevelTreeNode({ node, depth, isLast }: LevelTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const isSelected = useViewer((state) => state.selection.levelId === node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);

  const handleClick = () => {
    setSelection({ levelId: node.id });
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const defaultName = `Level ${node.level}`;

  return (
    <TreeNodeWrapper
      icon={<Layers className="w-3.5 h-3.5" />}
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
      isSelected={isSelected}
      isHovered={isHovered}
      isLast={isLast}
      actions={<TreeNodeActions node={node} />}
    >
      {node.children.map((childId, index) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} isLast={index === node.children.length - 1} />
      ))}
    </TreeNodeWrapper>
  );
}
