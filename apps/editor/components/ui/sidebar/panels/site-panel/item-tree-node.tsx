import { ItemNode } from "@pascal-app/core";
import { Box } from "lucide-react";
import { TreeNodeWrapper } from "./tree-node";

interface ItemTreeNodeProps {
  node: ItemNode;
  depth: number;
}

export function ItemTreeNode({ node, depth }: ItemTreeNodeProps) {
  const handleClick = () => {
    // Handle item selection
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
    />
  );
}
