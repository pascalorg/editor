import { LevelNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Layers } from "lucide-react";
import { useState } from "react";
import { TreeNode, TreeNodeWrapper } from "./tree-node";

interface LevelTreeNodeProps {
  node: LevelNode;
  depth: number;
}

export function LevelTreeNode({ node, depth }: LevelTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const currentLevelId = useViewer((state) => state.currentLevelId);
  const setCurrentLevel = useViewer((state) => state.setCurrentLevelId);

  const handleClick = () => {
    setCurrentLevel(node.id);
  };

  const isSelected = currentLevelId === node.id;

  return (
    <TreeNodeWrapper
      icon={<Layers className="w-3.5 h-3.5" />}
      label={node.name || `Level ${node.level}`}
      depth={depth}
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
      isSelected={isSelected}
    >
      {node.children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </TreeNodeWrapper>
  );
}
