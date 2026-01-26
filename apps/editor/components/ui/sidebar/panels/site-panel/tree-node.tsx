import { AnyNodeId, useScene } from "@pascal-app/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuildingTreeNode } from "./building-tree-node";
import { LevelTreeNode } from "./level-tree-node";
import { WallTreeNode } from "./wall-tree-node";
import { ItemTreeNode } from "./item-tree-node";

interface TreeNodeProps {
  nodeId: AnyNodeId;
  depth?: number;
}

export function TreeNode({ nodeId, depth = 0 }: TreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId]);

  if (!node) return null;

  switch (node.type) {
    case "building":
      return <BuildingTreeNode node={node} depth={depth} />;
    case "level":
      return <LevelTreeNode node={node} depth={depth} />;
    case "wall":
      return <WallTreeNode node={node} depth={depth} />;
    case "item":
      return <ItemTreeNode node={node} depth={depth} />;
    default:
      return null;
  }
}

interface TreeNodeWrapperProps {
  icon: React.ReactNode;
  label: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  isSelected?: boolean;
  isHovered?: boolean;
}

export function TreeNodeWrapper({
  icon,
  label,
  depth,
  hasChildren,
  expanded,
  onToggle,
  onClick,
  onMouseEnter,
  onMouseLeave,
  actions,
  children,
  isSelected,
  isHovered,
}: TreeNodeWrapperProps) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center h-7 cursor-pointer group/row text-sm",
          isSelected
            ? "text-primary-foreground bg-primary/80 hover:bg-primary/90"
            : isHovered
              ? "bg-accent/70 text-foreground"
              : "text-muted-foreground hover:bg-accent/50"
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )
          ) : null}
        </button>
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0"
          onClick={onClick}
        >
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </div>
        {actions && (
          <div className="opacity-0 group-hover/row:opacity-100 pr-1">
            {actions}
          </div>
        )}
      </div>
      {expanded && children}
    </div>
  );
}
