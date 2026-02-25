import { AnyNodeId, useScene } from "@pascal-app/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { BuildingTreeNode } from "./building-tree-node";
import { CeilingTreeNode } from "./ceiling-tree-node";
import { DoorTreeNode } from "./door-tree-node";
import { ItemTreeNode } from "./item-tree-node";
import { LevelTreeNode } from "./level-tree-node";
import { RoofTreeNode } from "./roof-tree-node";
import { SlabTreeNode } from "./slab-tree-node";
import { WallTreeNode } from "./wall-tree-node";
import { WindowTreeNode } from "./window-tree-node";
import { ZoneTreeNode } from "./zone-tree-node";

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
    case "ceiling":
      return <CeilingTreeNode node={node} depth={depth} />;
    case "level":
      return <LevelTreeNode node={node} depth={depth} />;
    case "slab":
      return <SlabTreeNode node={node} depth={depth} />;
    case "wall":
      return <WallTreeNode node={node} depth={depth} />;
    case "roof":
      return <RoofTreeNode node={node} depth={depth} />;
    case "item":
      return <ItemTreeNode node={node} depth={depth} />;
    case "door":
      return <DoorTreeNode node={node} depth={depth} />;
    case "window":
      return <WindowTreeNode node={node} depth={depth} />;
    case "zone":
      return <ZoneTreeNode node={node} depth={depth} />;
    default:
      return null;
  }
}

interface TreeNodeWrapperProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  isSelected?: boolean;
  isHovered?: boolean;
  isVisible?: boolean;
}

export const TreeNodeWrapper = forwardRef<HTMLDivElement, TreeNodeWrapperProps>(
  function TreeNodeWrapper(
    {
      icon,
      label,
      depth,
      hasChildren,
      expanded,
      onToggle,
      onClick,
      onDoubleClick,
      onMouseEnter,
      onMouseLeave,
      actions,
      children,
      isSelected,
      isHovered,
      isVisible = true,
    },
    ref
  ) {
    const rowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (isSelected && rowRef.current) {
        rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, [isSelected]);

    return (
      <div ref={ref}>
        <div
          ref={rowRef}
          className={cn(
            "flex items-center h-8 cursor-pointer group/row text-sm select-none border-b border-border/50 transition-all duration-200",
            isSelected
              ? "bg-accent/50 text-foreground"
              : isHovered
                ? "bg-accent/30 text-foreground"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
            !isVisible && "opacity-50"
          )}
          style={{ paddingLeft: depth * 12 + 12, paddingRight: 12 }}
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
            onDoubleClick={onDoubleClick}
          >
            <span className={cn(
              "w-4 h-4 flex items-center justify-center shrink-0 transition-all duration-200",
              !isSelected && "opacity-60 grayscale"
            )}>
              {icon}
            </span>
            <div className="flex-1 min-w-0 truncate">
              {label}
            </div>
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
);
