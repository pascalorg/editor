import { BuildingNode, LevelNode, useScene } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { TreeNode, TreeNodeWrapper } from "./tree-node";
import { TreeNodeActions } from "./tree-node-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";

interface BuildingTreeNodeProps {
  node: BuildingNode;
  depth: number;
}

export function BuildingTreeNode({ node, depth }: BuildingTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const createNode = useScene((state) => state.createNode);
  const isSelected = useViewer((state) => state.selection.buildingId === node.id);
  const isHovered = useViewer((state) => state.hoveredId === node.id);
  const setSelection = useViewer((state) => state.setSelection);

  const handleClick = () => {
    setSelection({ buildingId: node.id });
  };

  const handleAddLevel = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newLevel = LevelNode.parse({
      level: node.children.length,
      children: [],
      parentId: node.id,
    });
    createNode(newLevel, node.id);
  };

  return (
    <TreeNodeWrapper
      icon={<Building2 className="w-3.5 h-3.5" />}
      label={node.name || "Building"}
      depth={depth}
      hasChildren={node.children.length > 0}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onClick={handleClick}
      isSelected={isSelected}
      isHovered={isHovered}
      actions={
        <div className="flex items-center gap-0.5">
          <TreeNodeActions node={node} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-primary-foreground/20"
                onClick={handleAddLevel}
              >
                <Plus className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add new level</TooltipContent>
          </Tooltip>
        </div>
      }
    >
      {node.children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </TreeNodeWrapper>
  );
}
