import { WallNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Square } from "lucide-react";
import { useState } from "react";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";

interface WallTreeNodeProps {
  node: WallNode;
  depth: number;
}

export function WallTreeNode({ node, depth }: WallTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id));
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);

  const handleClick = () => {
    setSelection({ selectedIds: [node.id] });
  };

  const wallLength = Math.sqrt(
    Math.pow(node.end[0] - node.start[0], 2) +
      Math.pow(node.end[1] - node.start[1], 2),
  ).toFixed(1);

  return (
    <TreeNodeWrapper
      icon={<Square className="w-3.5 h-3.5" />}
      label={node.name || `Wall (${wallLength}m/${node.height || 2.5}m)`}
      depth={depth}
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
      isSelected={isSelected}
      isHovered={isHovered}
      actions={<TreeNodeActions node={node} />}
    >
      {node.children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </TreeNodeWrapper>
  );
}
