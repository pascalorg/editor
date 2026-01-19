import { WallNode, useScene } from "@pascal-app/core";
import { Square } from "lucide-react";
import { useState } from "react";
import { TreeNode, TreeNodeWrapper } from "./tree-node";

interface WallTreeNodeProps {
  node: WallNode;
  depth: number;
}

export function WallTreeNode({ node, depth }: WallTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    // Handle wall selection
    useScene.getState().markDirty(node.id);
  };

  const wallLength = Math.sqrt(
    Math.pow(node.end[0] - node.start[0], 2) +
      Math.pow(node.end[1] - node.start[1], 2)
  ).toFixed(1);

  return (
    <TreeNodeWrapper
      icon={<Square className="w-3.5 h-3.5" />}
      label={node.name || `Wall (${wallLength}m)`}
      depth={depth}
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
    >
      {node.children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </TreeNodeWrapper>
  );
}
