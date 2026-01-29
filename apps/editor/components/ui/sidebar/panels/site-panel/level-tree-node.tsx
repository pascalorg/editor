import { LevelNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Layers } from "lucide-react";
import { useState } from "react";
import { RenamePopover } from "./rename-popover";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface LevelTreeNodeProps {
  node: LevelNode;
  depth: number;
}

export function LevelTreeNode({ node, depth }: LevelTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const isSelected = useViewer((state) => state.selection.levelId === node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);

  const handleClick = () => {
    setSelection({ levelId: node.id });
  };

  const handleDoubleClick = () => {
    setRenameOpen(true);
  };

  const defaultName = `Level ${node.level}`;

  return (
    <RenamePopover
      node={node}
      open={renameOpen}
      onOpenChange={setRenameOpen}
      defaultName={defaultName}
    >
      <TreeNodeWrapper
        icon={<Layers className="w-3.5 h-3.5" />}
        label={node.name || defaultName}
        depth={depth}
        hasChildren={node.children.length > 0}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        isSelected={isSelected}
        isHovered={isHovered}
        actions={<TreeNodeActions node={node} />}
      >
        {node.children.map((childId) => (
          <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
        ))}
      </TreeNodeWrapper>
    </RenamePopover>
  );
}
