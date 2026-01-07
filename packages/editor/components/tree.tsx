'use client'

import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  type ComponentProps,
  createContext,
  forwardRef,
  type HTMLAttributes,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { cn } from '@/lib/utils'

// Split context to prevent selection changes from re-rendering all tree components
// Static config that rarely changes
type TreeConfigContextType = {
  showLines?: boolean
  showIcons?: boolean
  selectable?: boolean
  indent?: number
  animateExpand?: boolean
}

// Expansion store for fine-grained subscriptions
type ExpansionStoreType = {
  subscribe: (listener: () => void) => () => void
  getIsExpanded: (nodeId: string) => boolean
  toggleExpanded: (nodeId: string) => void
}

// Selection store for fine-grained subscriptions
type SelectionStoreType = {
  subscribe: (listener: () => void) => () => void
  getIsSelected: (nodeId: string) => boolean
  getSelectedIds: () => string[]
}

// Functions context - only stable references
type TreeActionsContextType = {
  toggleExpanded: (nodeId: string) => void
  expansionStore: ExpansionStoreType
}

type TreeSelectionContextType = {
  selectionStore: SelectionStoreType
  handleSelection: (nodeId: string, ctrlKey: boolean) => void
  multiSelect?: boolean
}

const TreeConfigContext = createContext<TreeConfigContextType | undefined>(undefined)
const TreeActionsContext = createContext<TreeActionsContextType | undefined>(undefined)
const TreeSelectionContext = createContext<TreeSelectionContextType | undefined>(undefined)

export const useTreeConfig = () => {
  const context = useContext(TreeConfigContext)
  if (!context) {
    throw new Error('Tree components must be used within a TreeProvider')
  }
  return context
}

export const useTreeActions = () => {
  const context = useContext(TreeActionsContext)
  if (!context) {
    throw new Error('Tree components must be used within a TreeProvider')
  }
  return context
}

export const useTreeSelection = () => {
  const context = useContext(TreeSelectionContext)
  if (!context) {
    throw new Error('Tree components must be used within a TreeProvider')
  }
  return context
}

// Fine-grained hook for subscribing to a specific node's expanded state
// Only re-renders when THIS node's expanded state changes
export const useIsExpanded = (nodeId: string) => {
  const { expansionStore } = useTreeActions()
  return useSyncExternalStore(
    expansionStore.subscribe,
    () => expansionStore.getIsExpanded(nodeId),
    () => expansionStore.getIsExpanded(nodeId),
  )
}

// Fine-grained hook for subscribing to a specific node's selected state
// Only re-renders when THIS node's selected state changes
export const useIsTreeSelected = (nodeId: string) => {
  const { selectionStore } = useTreeSelection()
  return useSyncExternalStore(
    selectionStore.subscribe,
    () => selectionStore.getIsSelected(nodeId),
    () => selectionStore.getIsSelected(nodeId),
  )
}

// Legacy hook for backwards compatibility
export const useTreeLayout = () => {
  const config = useTreeConfig()
  const actions = useTreeActions()
  return { ...config, ...actions }
}

export const useTree = () => {
  const config = useTreeConfig()
  const actions = useTreeActions()
  const selection = useTreeSelection()
  return { ...config, ...actions, ...selection }
}

type TreeNodeContextType = {
  nodeId: string
  level: number
  isLast: boolean
  parentPath: boolean[]
  isExpanded: boolean
}

const TreeNodeContext = createContext<TreeNodeContextType | undefined>(undefined)

const useTreeNode = () => {
  const context = useContext(TreeNodeContext)
  if (!context) {
    throw new Error('TreeNode components must be used within a TreeNode')
  }
  return context
}

export type TreeProviderProps = {
  children: ReactNode
  defaultExpandedIds?: string[]
  expandedIds?: string[]
  onExpandedChange?: (expandedIds: string[]) => void
  showLines?: boolean
  showIcons?: boolean
  selectable?: boolean
  multiSelect?: boolean
  selectedIds?: string[]
  onSelectionChange?: (selectedIds: string[]) => void
  indent?: number
  animateExpand?: boolean
  className?: string
}

export const TreeProvider = ({
  children,
  defaultExpandedIds = [],
  expandedIds: controlledExpandedIds,
  onExpandedChange,
  showLines = true,
  showIcons = true,
  selectable = true,
  multiSelect = false,
  selectedIds,
  onSelectionChange,
  indent = 20,
  animateExpand = true,
  className,
}: TreeProviderProps) => {
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(
    new Set(defaultExpandedIds),
  )

  const isExpandedControlled = controlledExpandedIds !== undefined && onExpandedChange !== undefined
  const isSelectionControlled = selectedIds !== undefined && onSelectionChange !== undefined

  // Fine-grained expansion subscription store
  // This allows individual TreeNodes to subscribe only to their own expanded state
  const expansionListenersRef = useRef(new Set<() => void>())
  const expandedIdsRef = useRef<Set<string>>(new Set(defaultExpandedIds))

  // Fine-grained selection subscription store
  const selectionListenersRef = useRef(new Set<() => void>())
  const selectedIdsRef = useRef<string[]>(selectedIds ?? [])

  // Update ref when controlled prop changes
  if (isExpandedControlled && controlledExpandedIds) {
    expandedIdsRef.current = new Set(controlledExpandedIds)
  }

  const subscribeToExpansion = useCallback((listener: () => void) => {
    expansionListenersRef.current.add(listener)
    return () => {
      expansionListenersRef.current.delete(listener)
    }
  }, [])

  const notifyExpansionListeners = useCallback(() => {
    for (const listener of expansionListenersRef.current) {
      listener()
    }
  }, [])

  const subscribeToSelection = useCallback((listener: () => void) => {
    selectionListenersRef.current.add(listener)
    return () => {
      selectionListenersRef.current.delete(listener)
    }
  }, [])

  const notifySelectionListeners = useCallback(() => {
    for (const listener of selectionListenersRef.current) {
      listener()
    }
  }, [])

  const toggleExpanded = useCallback(
    (nodeId: string) => {
      if (isExpandedControlled && onExpandedChange) {
        const newSet = new Set(expandedIdsRef.current)
        if (newSet.has(nodeId)) {
          newSet.delete(nodeId)
        } else {
          newSet.add(nodeId)
        }
        onExpandedChange(Array.from(newSet))
      } else {
        setInternalExpandedIds((prev) => {
          const newSet = new Set(prev)
          if (newSet.has(nodeId)) {
            newSet.delete(nodeId)
          } else {
            newSet.add(nodeId)
          }
          expandedIdsRef.current = newSet
          notifyExpansionListeners()
          return newSet
        })
      }
    },
    [isExpandedControlled, onExpandedChange, notifyExpansionListeners],
  )

  // Sync controlled expandedIds to ref and notify
  const prevControlledExpandedRef = useRef(controlledExpandedIds)
  if (isExpandedControlled && controlledExpandedIds !== prevControlledExpandedRef.current) {
    prevControlledExpandedRef.current = controlledExpandedIds
    expandedIdsRef.current = new Set(controlledExpandedIds)
    // Schedule notification for next tick to avoid render-during-render
    Promise.resolve().then(notifyExpansionListeners)
  }

  // Sync controlled selectedIds to ref and notify
  const prevControlledSelectedRef = useRef(selectedIds)
  if (isSelectionControlled && selectedIds !== prevControlledSelectedRef.current) {
    prevControlledSelectedRef.current = selectedIds
    selectedIdsRef.current = selectedIds
    // Schedule notification for next tick to avoid render-during-render
    Promise.resolve().then(notifySelectionListeners)
  }

  // Expansion store - stable object for fine-grained subscriptions
  const expansionStore = useMemo<ExpansionStoreType>(
    () => ({
      subscribe: subscribeToExpansion,
      getIsExpanded: (nodeId: string) => expandedIdsRef.current.has(nodeId),
      toggleExpanded,
    }),
    [subscribeToExpansion, toggleExpanded],
  )

  // Selection store - stable object for fine-grained subscriptions
  const selectionStore = useMemo<SelectionStoreType>(
    () => ({
      subscribe: subscribeToSelection,
      getIsSelected: (nodeId: string) => selectedIdsRef.current.includes(nodeId),
      getSelectedIds: () => selectedIdsRef.current,
    }),
    [subscribeToSelection],
  )

  const handleSelection = useCallback(
    (nodeId: string, ctrlKey = false) => {
      if (!selectable) {
        return
      }

      const currentSelectedIds = selectedIdsRef.current
      let newSelection: string[]

      if (multiSelect && ctrlKey) {
        newSelection = currentSelectedIds.includes(nodeId)
          ? currentSelectedIds.filter((id) => id !== nodeId)
          : [...currentSelectedIds, nodeId]
      } else {
        newSelection = currentSelectedIds.includes(nodeId) ? [] : [nodeId]
      }

      if (isSelectionControlled) {
        onSelectionChange?.(newSelection)
      } else {
        selectedIdsRef.current = newSelection
        notifySelectionListeners()
      }
    },
    [selectable, multiSelect, isSelectionControlled, onSelectionChange, notifySelectionListeners],
  )

  // Static config - rarely changes
  const configContextValue = useMemo(
    () => ({
      showLines,
      showIcons,
      selectable,
      indent,
      animateExpand,
    }),
    [showLines, showIcons, selectable, indent, animateExpand],
  )

  // Actions - stable references only (no expandedIds!)
  const actionsContextValue = useMemo(
    () => ({
      toggleExpanded,
      expansionStore,
    }),
    [toggleExpanded, expansionStore],
  )

  const selectionContextValue = useMemo(
    () => ({
      selectionStore,
      handleSelection,
      multiSelect,
    }),
    [selectionStore, handleSelection, multiSelect],
  )

  return (
    <TreeConfigContext.Provider value={configContextValue}>
      <TreeActionsContext.Provider value={actionsContextValue}>
        <TreeSelectionContext.Provider value={selectionContextValue}>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={cn('w-full', className)}
            initial={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </TreeSelectionContext.Provider>
      </TreeActionsContext.Provider>
    </TreeConfigContext.Provider>
  )
}

export type TreeViewProps = HTMLAttributes<HTMLDivElement>

export const TreeView = memo(function TreeView({
  className,
  children,
  ...props
}: TreeViewProps) {
  return (
    <div className={cn('p-2', className)} {...props}>
      {children}
    </div>
  )
})

export type TreeNodeProps = HTMLAttributes<HTMLDivElement> & {
  nodeId?: string
  level?: number
  isLast?: boolean
  parentPath?: boolean[]
  children?: ReactNode
}

export const TreeNode = memo(function TreeNode({
  nodeId: providedNodeId,
  level = 0,
  isLast = false,
  parentPath = [],
  children,
  className,
  onClick,
  ...props
}: TreeNodeProps) {
  const generatedId = useId()
  const nodeId = providedNodeId ?? generatedId
  // Use fine-grained subscription - only re-renders when THIS node's expanded state changes
  const isExpanded = useIsExpanded(nodeId)

  // Build the parent path - mark positions where the parent was the last child
  const currentPath = useMemo(() => {
    const path = level === 0 ? [] : [...parentPath]
    if (level > 0 && parentPath.length < level - 1) {
      // Fill in missing levels with false (not last)
      while (path.length < level - 1) {
        path.push(false)
      }
    }
    if (level > 0) {
      path[level - 1] = isLast
    }
    return path
  }, [level, parentPath, isLast])

  const contextValue = useMemo(
    () => ({
      nodeId,
      level,
      isLast,
      parentPath: currentPath,
      isExpanded,
    }),
    [nodeId, level, isLast, currentPath, isExpanded],
  )

  return (
    <TreeNodeContext.Provider value={contextValue}>
      <div className={cn('select-none', className)} {...props}>
        {children}
      </div>
    </TreeNodeContext.Provider>
  )
})

export type TreeNodeTriggerProps = ComponentProps<typeof motion.div>

// Inner component that subscribes to selection - only used when selectable is true
const TreeNodeTriggerWithSelection = memo(function TreeNodeTriggerWithSelection({
  children,
  className,
  onClick,
  nodeId,
  level,
  indent,
  ...props
}: TreeNodeTriggerProps & { nodeId: string; level: number; indent?: number }) {
  const { handleSelection } = useTreeSelection()
  // Use fine-grained subscription - only re-renders when THIS node's selection changes
  const isSelected = useIsTreeSelected(nodeId)

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleSelection(nodeId, e.ctrlKey || e.metaKey)
      onClick?.(e)
    },
    [handleSelection, nodeId, onClick],
  )

  const style = useMemo(() => ({ paddingLeft: level * (indent ?? 0) }), [level, indent])

  return (
    <motion.div
      className={cn(
        'group/item relative flex cursor-pointer items-center rounded-md py-1.5 pr-2 transition-all duration-200',
        'hover:bg-accent/50',
        isSelected && 'bg-accent/80',
        className,
      )}
      data-node-id={nodeId}
      onClick={handleClick}
      style={style}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
      {...props}
    >
      <TreeLines />
      {children as ReactNode}
    </motion.div>
  )
})

// Inner component that doesn't subscribe to selection - used when selectable is false
const TreeNodeTriggerNoSelection = memo(function TreeNodeTriggerNoSelection({
  children,
  className,
  onClick,
  nodeId,
  level,
  indent,
  ...props
}: TreeNodeTriggerProps & { nodeId: string; level: number; indent?: number }) {
  const style = useMemo(() => ({ paddingLeft: level * (indent ?? 0) }), [level, indent])

  return (
    <motion.div
      className={cn(
        'group/item relative flex cursor-pointer items-center rounded-md py-1.5 pr-2 transition-all duration-200',
        'hover:bg-accent/50',
        className,
      )}
      data-node-id={nodeId}
      onClick={onClick}
      style={style}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
      {...props}
    >
      <TreeLines />
      {children as ReactNode}
    </motion.div>
  )
})

export const TreeNodeTrigger = memo(function TreeNodeTrigger({
  children,
  className,
  onClick,
  ...props
}: TreeNodeTriggerProps) {
  const { indent, selectable } = useTreeConfig()
  const { nodeId, level } = useTreeNode()

  // Use different components based on selectable to avoid unnecessary selection context subscriptions
  if (selectable) {
    return (
      <TreeNodeTriggerWithSelection
        className={className}
        indent={indent}
        level={level}
        nodeId={nodeId}
        onClick={onClick}
        {...props}
      >
        {children}
      </TreeNodeTriggerWithSelection>
    )
  }

  return (
    <TreeNodeTriggerNoSelection
      className={className}
      indent={indent}
      level={level}
      nodeId={nodeId}
      onClick={onClick}
      {...props}
    >
      {children}
    </TreeNodeTriggerNoSelection>
  )
})

export const TreeLines = memo(function TreeLines() {
  const { showLines, indent } = useTreeConfig()
  const { level, isLast, parentPath } = useTreeNode()

  if (!showLines || level === 0) {
    return null
  }

  return (
    <div className="pointer-events-none absolute top-0 bottom-0 left-0">
      {/* Render vertical lines for all parent levels */}
      {Array.from({ length: level }, (_, index) => {
        const shouldHideLine = parentPath[index] === true
        if (shouldHideLine && index === level - 1) {
          return null
        }

        return (
          <div
            className="absolute top-0 bottom-0 border-border/40 border-l"
            key={index.toString()}
            style={{
              left: index * (indent ?? 0) + 8,
              display: shouldHideLine ? 'none' : 'block',
            }}
          />
        )
      })}

      {/* Horizontal connector line */}
      <div
        className="absolute top-1/2 border-border/40 border-t"
        style={{
          left: (level - 1) * (indent ?? 0) + 8,
          width: (indent ?? 0) - 4,
          transform: 'translateY(-1px)',
        }}
      />

      {/* Vertical line to midpoint for last items */}
      {isLast && (
        <div
          className="absolute top-0 border-border/40 border-l"
          style={{
            left: (level - 1) * (indent ?? 0) + 8,
            height: '50%',
          }}
        />
      )}
    </div>
  )
})

export type TreeNodeContentProps = ComponentProps<typeof motion.div> & {
  hasChildren?: boolean
}

export const TreeNodeContent = memo(function TreeNodeContent({
  children,
  hasChildren = false,
  className,
  ...props
}: TreeNodeContentProps) {
  const { animateExpand } = useTreeConfig()
  const { isExpanded } = useTreeNode()

  return (
    <AnimatePresence>
      {hasChildren && isExpanded && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{
            duration: animateExpand ? 0.3 : 0,
            ease: 'easeInOut',
          }}
        >
          <motion.div
            animate={{ y: 0 }}
            className={className}
            exit={{ y: -10 }}
            initial={{ y: -10 }}
            transition={{
              duration: animateExpand ? 0.2 : 0,
              delay: animateExpand ? 0.1 : 0,
            }}
            {...props}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

export type TreeExpanderProps = ComponentProps<typeof motion.div> & {
  hasChildren?: boolean
}

export const TreeExpander = memo(function TreeExpander({
  hasChildren = false,
  className,
  onClick,
  ...props
}: TreeExpanderProps) {
  const { toggleExpanded } = useTreeActions()
  const { nodeId, isExpanded } = useTreeNode()

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      toggleExpanded(nodeId)
      onClick?.(e)
    },
    [toggleExpanded, nodeId, onClick],
  )

  if (!hasChildren) {
    return <div className="mr-1 h-4 w-4" />
  }

  return (
    <motion.div
      animate={{ rotate: isExpanded ? 90 : 0 }}
      className={cn('mr-1 flex h-4 w-4 cursor-pointer items-center justify-center', className)}
      onClick={handleClick}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      {...props}
    >
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </motion.div>
  )
})

export type TreeIconProps = ComponentProps<typeof motion.div> & {
  icon?: ReactNode
  hasChildren?: boolean
}

export const TreeIcon = memo(function TreeIcon({
  icon,
  hasChildren = false,
  className,
  ...props
}: TreeIconProps) {
  const { showIcons } = useTreeConfig()
  const { isExpanded } = useTreeNode()

  if (!showIcons) {
    return null
  }

  const defaultIcon = hasChildren ? (
    isExpanded ? (
      <FolderOpen className="h-4 w-4" />
    ) : (
      <Folder className="h-4 w-4" />
    )
  ) : (
    <File className="h-4 w-4" />
  )

  return (
    <motion.div
      className={cn(
        'mr-2 flex h-4 w-4 items-center justify-center text-muted-foreground',
        className,
      )}
      transition={{ duration: 0.15 }}
      whileHover={{ scale: 1.1 }}
      {...props}
    >
      {icon || defaultIcon}
    </motion.div>
  )
})

export type TreeLabelProps = HTMLAttributes<HTMLSpanElement>

export const TreeLabel = forwardRef<HTMLSpanElement, TreeLabelProps>(
  ({ className, ...props }, ref) => (
    <span className={cn('font flex-1 truncate text-sm', className)} ref={ref} {...props} />
  ),
)
TreeLabel.displayName = 'TreeLabel'
