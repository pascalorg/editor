import { AnyNodeId, useScene } from "@pascal-app/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

export function handleTreeSelection(
  e: React.MouseEvent,
  nodeId: string,
  selectedIds: string[],
  setSelection: (s: any) => void
) {
  if (e.metaKey || e.ctrlKey) {
    if (selectedIds.includes(nodeId)) {
      setSelection({ selectedIds: selectedIds.filter((id) => id !== nodeId) });
    } else {
      setSelection({ selectedIds: [...selectedIds, nodeId] });
    }
    return true;
  }
  
  if (e.shiftKey && selectedIds.length > 0) {
    const lastSelectedId = selectedIds[selectedIds.length - 1];
    if (lastSelectedId) {
      const nodes = Array.from(document.querySelectorAll('[data-treenode-id]'));
      const nodeIds = nodes.map(n => n.getAttribute('data-treenode-id') as string);
      
      const startIndex = nodeIds.indexOf(lastSelectedId);
      const endIndex = nodeIds.indexOf(nodeId);
      
      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const range = nodeIds.slice(start, end + 1);
        
        // We can keep the previous selections that were outside the range if we want, 
        // but standard file system shift-click replaces the selection with the range.
        setSelection({ selectedIds: range });
        return true;
      }
    }
    // Fallback: if range selection fails (e.g. node not visible in tree), just add to selection
    if (!selectedIds.includes(nodeId)) {
      setSelection({ selectedIds: [...selectedIds, nodeId] });
      return true;
    }
  }

  setSelection({ selectedIds: [nodeId] });
  return false;
}
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
  isLast?: boolean;
}

export function TreeNode({ nodeId, depth = 0, isLast }: TreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId]);

  if (!node) return null;

  switch (node.type) {
    case "building":
      return <BuildingTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "ceiling":
      return <CeilingTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "level":
      return <LevelTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "slab":
      return <SlabTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "wall":
      return <WallTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "roof":
      return <RoofTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "item":
      return <ItemTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "door":
      return <DoorTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "window":
      return <WindowTreeNode node={node as any} depth={depth} isLast={isLast} />;
    case "zone":
      return <ZoneTreeNode node={node as any} depth={depth} isLast={isLast} />;
    default:
      return null;
  }
}

interface TreeNodeWrapperProps {
  nodeId?: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  isSelected?: boolean;
  isHovered?: boolean;
  isVisible?: boolean;
  isLast?: boolean;
}

export const TreeNodeWrapper = forwardRef<HTMLDivElement, TreeNodeWrapperProps>(
    function TreeNodeWrapper(
      {
        nodeId,
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
        isLast,
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
        <div ref={ref} data-treenode-id={nodeId}>
          <div
            ref={rowRef}
            className={cn(
              "relative flex items-center h-8 cursor-pointer group/row text-sm select-none border-b border-r border-border/50 border-r-transparent transition-all duration-200",
              isSelected
                ? "bg-accent/50 text-foreground border-r-white border-r-3"
                : isHovered
                  ? "bg-accent/30 text-foreground"
                  : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
              !isVisible && "opacity-50"
            )}
            style={{ paddingLeft: depth * 12 + 12, paddingRight: 12 }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            {/* Vertical tree line */}
            <div
              className={cn(
                "absolute w-px bg-border/50 pointer-events-none",
                isLast ? "top-0 bottom-1/2" : "top-0 bottom-0"
              )}
              style={{ left: (depth - 1) * 12 + 20 }}
            />
            {/* Horizontal branch line */}
            <div
              className="absolute top-1/2 h-px bg-border/50 pointer-events-none"
              style={{ left: (depth - 1) * 12 + 20, width: 4 }}
            />
            {/* Line down to children */}
            {hasChildren && expanded && (
              <div
                className="absolute top-1/2 bottom-0 w-px bg-border/50 pointer-events-none"
                style={{ left: depth * 12 + 20 }}
              />
            )}

            <button
              className="w-4 h-4 flex items-center justify-center shrink-0 z-10 bg-inherit"
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
        <AnimatePresence initial={false}>
          {expanded && children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="overflow-hidden"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
);
