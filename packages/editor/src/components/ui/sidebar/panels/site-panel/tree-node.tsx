import { type AnyNodeId, useScene } from '@pascal-app/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useRef } from 'react'
import { cn } from './../../../../../lib/utils'

export function handleTreeSelection(
  e: React.MouseEvent,
  nodeId: string,
  selectedIds: string[],
  setSelection: (s: any) => void,
) {
  if (e.metaKey || e.ctrlKey) {
    if (selectedIds.includes(nodeId)) {
      setSelection({ selectedIds: selectedIds.filter((id) => id !== nodeId) })
    } else {
      setSelection({ selectedIds: [...selectedIds, nodeId] })
    }
    return true
  }

  if (e.shiftKey && selectedIds.length > 0) {
    const lastSelectedId = selectedIds[selectedIds.length - 1]
    if (lastSelectedId) {
      const nodes = Array.from(document.querySelectorAll('[data-treenode-id]'))
      const nodeIds = nodes.map((n) => n.getAttribute('data-treenode-id') as string)

      const startIndex = nodeIds.indexOf(lastSelectedId)
      const endIndex = nodeIds.indexOf(nodeId)

      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex)
        const end = Math.max(startIndex, endIndex)
        const range = nodeIds.slice(start, end + 1)

        // We can keep the previous selections that were outside the range if we want,
        // but standard file system shift-click replaces the selection with the range.
        setSelection({ selectedIds: range })
        return true
      }
    }
    // Fallback: if range selection fails (e.g. node not visible in tree), just add to selection
    if (!selectedIds.includes(nodeId)) {
      setSelection({ selectedIds: [...selectedIds, nodeId] })
      return true
    }
  }

  setSelection({ selectedIds: [nodeId] })
  return false
}

import { BuildingTreeNode } from './building-tree-node'
import { CeilingTreeNode } from './ceiling-tree-node'
import { DoorTreeNode } from './door-tree-node'
import { ItemTreeNode } from './item-tree-node'
import { LevelTreeNode } from './level-tree-node'
import { RoofTreeNode } from './roof-tree-node'
import { SlabTreeNode } from './slab-tree-node'
import { WallTreeNode } from './wall-tree-node'
import { WindowTreeNode } from './window-tree-node'
import { ZoneTreeNode } from './zone-tree-node'

interface TreeNodeProps {
  nodeId: AnyNodeId
  depth?: number
  isLast?: boolean
}

export function TreeNode({ nodeId, depth = 0, isLast }: TreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId])

  if (!node) return null

  switch (node.type) {
    case 'building':
      return <BuildingTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'ceiling':
      return <CeilingTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'level':
      return <LevelTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'slab':
      return <SlabTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'wall':
      return <WallTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'roof':
      return <RoofTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'item':
      return <ItemTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'door':
      return <DoorTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'window':
      return <WindowTreeNode depth={depth} isLast={isLast} node={node as any} />
    case 'zone':
      return <ZoneTreeNode depth={depth} isLast={isLast} node={node as any} />
    default:
      return null
  }
}

interface TreeNodeWrapperProps {
  nodeId?: string
  icon: React.ReactNode
  label: React.ReactNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  actions?: React.ReactNode
  children?: React.ReactNode
  isSelected?: boolean
  isHovered?: boolean
  isVisible?: boolean
  isLast?: boolean
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
    ref,
  ) {
    const rowRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (isSelected && rowRef.current) {
        rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, [isSelected])

    return (
      <div data-treenode-id={nodeId} ref={ref}>
        <div
          className={cn(
            'group/row relative flex h-8 cursor-pointer select-none items-center border-border/50 border-r border-r-transparent border-b text-sm transition-all duration-200',
            isSelected
              ? 'border-r-3 border-r-white bg-accent/50 text-foreground'
              : isHovered
                ? 'bg-accent/30 text-foreground'
                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
            !isVisible && 'opacity-50',
          )}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          ref={rowRef}
          style={{ paddingLeft: depth * 12 + 12, paddingRight: 12 }}
        >
          {/* Vertical tree line */}
          <div
            className={cn(
              'pointer-events-none absolute w-px bg-border/50',
              isLast ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
            )}
            style={{ left: (depth - 1) * 12 + 20 }}
          />
          {/* Horizontal branch line */}
          <div
            className="pointer-events-none absolute top-1/2 h-px bg-border/50"
            style={{ left: (depth - 1) * 12 + 20, width: 4 }}
          />
          {/* Line down to children */}
          {hasChildren && expanded && (
            <div
              className="pointer-events-none absolute top-1/2 bottom-0 w-px bg-border/50"
              style={{ left: depth * 12 + 20 }}
            />
          )}

          <button
            className="z-10 flex h-4 w-4 shrink-0 items-center justify-center bg-inherit"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {hasChildren ? (
              expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )
            ) : null}
          </button>
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center transition-all duration-200',
                !isSelected && 'opacity-60 grayscale',
              )}
            >
              {icon}
            </span>
            <div
              className={cn(
                'min-w-0 flex-1 truncate',
                !isVisible && 'text-muted-foreground line-through',
              )}
            >
              {label}
            </div>
          </div>
          {actions && (
            <div
              className={cn(
                'pr-1 opacity-0 transition-opacity duration-200 group-hover/row:opacity-100',
                !isVisible && 'opacity-100',
              )}
            >
              {actions}
            </div>
          )}
        </div>
        <AnimatePresence initial={false}>
          {expanded && children && (
            <motion.div
              animate={{ height: 'auto', opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  },
)
