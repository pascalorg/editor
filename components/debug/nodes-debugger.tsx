'use client'

import { CylinderIcon, TreeViewIcon } from '@phosphor-icons/react'
import { Bug, Building2, Copy, Eye, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
} from '@/components/tree'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useEditor } from '@/hooks/use-editor'
import { componentRegistry } from '@/lib/nodes/registry'
import type { AnyNode } from '@/lib/scenegraph/schema/index'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'nodes-debugger-state'

interface DebuggerState {
  isOpen: boolean
  isMinimized: boolean
  position: { x: number; y: number }
  width: number
  height: number
  expandedIds: string[]
}

const DEFAULT_STATE: DebuggerState = {
  isOpen: false,
  isMinimized: false,
  position: { x: 100, y: 100 },
  width: 800,
  height: 600,
  expandedIds: [],
}

function loadState(): DebuggerState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DebuggerState>
      return { ...DEFAULT_STATE, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_STATE
}

function saveState(state: DebuggerState) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

function getNodeIcon(node: AnyNode) {
  // Try to get icon from registry first
  const registered = componentRegistry.get(node.type)
  if (registered?.config.toolIcon) {
    return registered.config.toolIcon
  }

  // Fallback for unregistered types
  return Building2
}

function formatNodeLabel(node: AnyNode): string {
  if ('name' in node && node.name) return node.name
  return `${node.type} (${node.id.slice(0, 8)}...)`
}

function NodeTreeItem({ node, level, isLast }: { node: AnyNode; level: number; isLast: boolean }) {
  const Icon = getNodeIcon(node)
  const children = 'children' in node && Array.isArray(node.children) ? node.children : []
  const hasChildren = children.length > 0

  return (
    <TreeNode isLast={isLast} level={level} nodeId={node.id}>
      <TreeNodeTrigger>
        <TreeExpander hasChildren={hasChildren} />
        <TreeIcon hasChildren={hasChildren} icon={<Icon className="h-4 w-4" />} />
        <TreeLabel>{formatNodeLabel(node)}</TreeLabel>
        <div className="ml-auto flex items-center gap-1">
          {'visible' in node && node.visible === false && (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
          {'opacity' in node && node.opacity !== undefined && node.opacity !== 100 && (
            <span className="text-muted-foreground text-xs">{node.opacity}%</span>
          )}
        </div>
      </TreeNodeTrigger>
      <TreeNodeContent hasChildren={hasChildren}>
        {children.map((child: AnyNode, index: number) => (
          <NodeTreeItem
            isLast={index === children.length - 1}
            key={child.id}
            level={level + 1}
            node={child}
          />
        ))}
      </TreeNodeContent>
    </TreeNode>
  )
}

function NodeDetailsPanel({ nodeId }: { nodeId: string | null }) {
  const node = useEditor((state) => (nodeId ? state.nodeIndex.get(nodeId) : undefined))
  const { toggleNodeVisibility, setNodeOpacity } = useEditor()

  const [copied, setCopied] = useState(false)

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a node to view details
      </div>
    )
  }

  const handleToggleVisibility = () => {
    toggleNodeVisibility(node.id)
  }

  const handleOpacityChange = (value: number[]) => {
    const opacity = value[0]
    setNodeOpacity(node.id, opacity)
  }

  const handleCopyId = () => {
    navigator.clipboard.writeText(node.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(node, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canToggleVisibility = 'visible' in node
  const canChangeOpacity = 'opacity' in node

  const parentId = (node as any).parent

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b p-4">
        <h3 className="font-semibold text-lg">{formatNodeLabel(node)}</h3>
        <p className="mt-1 text-muted-foreground text-sm">Type: {node.type}</p>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* Key Fields */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Key Fields</h4>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">ID:</span>{' '}
              <code className="text-xs">{node.id}</code>
            </div>
            {parentId && (
              <div>
                <span className="text-muted-foreground">Parent:</span>{' '}
                <code className="text-xs">{parentId}</code>
              </div>
            )}
            {'position' in node && Array.isArray(node.position) && (
              <div>
                <span className="text-muted-foreground">Position:</span>{' '}
                <code className="text-xs">
                  [{node.position[0]}, {node.position[1]}]
                </code>
              </div>
            )}
            {'rotation' in node && typeof node.rotation === 'number' && (
              <div>
                <span className="text-muted-foreground">Rotation:</span>{' '}
                <code className="text-xs">{node.rotation.toFixed(2)} rad</code>
              </div>
            )}
            {'size' in node && Array.isArray(node.size) && (
              <div>
                <span className="text-muted-foreground">Size:</span>{' '}
                <code className="text-xs">
                  [{node.size[0]}, {node.size[1]}]
                </code>
              </div>
            )}
            {'visible' in node && typeof node.visible === 'boolean' && (
              <div>
                <span className="text-muted-foreground">Visible:</span>{' '}
                <code className="text-xs">{node.visible ? 'true' : 'false'}</code>
              </div>
            )}
            {'opacity' in node && typeof node.opacity === 'number' && (
              <div>
                <span className="text-muted-foreground">Opacity:</span>{' '}
                <code className="text-xs">{node.opacity}%</code>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Actions</h4>
          <div className="flex flex-col gap-2">
            {canToggleVisibility && (
              <Button onClick={handleToggleVisibility} size="sm" variant="outline">
                {'visible' in node && node.visible === false ? (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Show
                  </>
                ) : (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Hide
                  </>
                )}
              </Button>
            )}
            {canChangeOpacity && (
              <div className="space-y-2">
                <label className="text-muted-foreground text-xs">Opacity</label>
                <Slider
                  max={100}
                  min={0}
                  onValueChange={handleOpacityChange}
                  step={1}
                  value={[
                    'opacity' in node && typeof node.opacity === 'number' ? node.opacity : 100,
                  ]}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleCopyId} size="sm" variant="ghost">
                <Copy className="mr-2 h-4 w-4" />
                Copy ID
              </Button>
              <Button onClick={handleCopyJson} size="sm" variant="ghost">
                <Copy className="mr-2 h-4 w-4" />
                Copy JSON
              </Button>
            </div>
            {copied && <p className="text-green-600 text-xs dark:text-green-400">Copied!</p>}
          </div>
        </div>

        {/* Full JSON */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Full JSON</h4>
          <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">
            {JSON.stringify(node, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}

export function NodesDebugger() {
  const [state, setState] = useState<DebuggerState>(DEFAULT_STATE)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [pointerId, setPointerId] = useState<number | null>(null)
  const [isClient, setIsClient] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)

  const levels = useEditor((state) => {
    const building = state.scene.root.buildings?.[0]
    return building && 'children' in building && Array.isArray(building.children)
      ? building.children
      : []
  })
  const nodeIndex = useEditor((state) => state.nodeIndex)
  const debug = useEditor((state) => state.debug)
  const {
    setDebug,
    selectedElements,
    selectedImageIds,
    selectedScanIds,
    selectedFloorId,
    selectNode,
  } = useEditor()

  // Load state from localStorage only on client
  useEffect(() => {
    setIsClient(true)
    setState(loadState())
  }, [])

  const activeSelectedIds = useMemo(() => {
    if (selectedElements.length > 0) return selectedElements
    if (selectedImageIds.length > 0) return selectedImageIds
    if (selectedScanIds.length > 0) return selectedScanIds
    if (selectedFloorId) return [selectedFloorId]
    return []
  }, [selectedElements, selectedImageIds, selectedScanIds, selectedFloorId])

  const selectedNodeId = activeSelectedIds[0] ?? null

  const handleNodeSelect = (ids: string[]) => {
    const nodeId = ids[0]
    if (nodeId) {
      selectNode(nodeId)
    }
  }

  // Default expand all levels
  const defaultExpandedIds = useMemo(() => {
    // Collect all level IDs (levels are only at root, not nested)
    const levelIds = levels.map((level: AnyNode) => level.id)
    // Merge with persisted expandedIds
    return [...new Set([...levelIds, ...state.expandedIds])]
  }, [levels, state.expandedIds])

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        setState((prev) => ({ ...prev, isOpen: !prev.isOpen }))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleDragStart = (e: React.PointerEvent) => {
    // Don't start drag if clicking on a button
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    if (!dragRef.current) return
    const rect = dragRef.current.getBoundingClientRect()
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setIsDragging(true)
    setPointerId(e.pointerId)
    dragRef.current.setPointerCapture(e.pointerId)
  }

  const handleDrag = (e: React.PointerEvent) => {
    if (!(isDragging && dragRef.current)) return
    const rect = dragRef.current.getBoundingClientRect()
    const newX = e.clientX - dragOffset.x
    const newY = e.clientY - dragOffset.y
    setState((prev) => ({
      ...prev,
      position: {
        x: Math.max(0, Math.min(newX, window.innerWidth - rect.width)),
        y: Math.max(0, Math.min(newY, window.innerHeight - rect.height)),
      },
    }))
  }

  const handleDragEnd = (e?: React.PointerEvent) => {
    setIsDragging(false)
    if (dragRef.current && pointerId !== null) {
      try {
        dragRef.current.releasePointerCapture(pointerId)
      } catch {
        // Ignore errors if pointer capture was already released
      }
      setPointerId(null)
    }
  }

  // Don't render until client-side to avoid hydration mismatch
  if (!isClient) {
    return null
  }

  if (!state.isOpen) {
    return (
      <button
        className="fixed right-4 bottom-4 z-50 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm shadow-lg hover:bg-primary/90"
        onClick={() => setState((prev) => ({ ...prev, isOpen: true }))}
        type="button"
      >
        Nodes Debugger
      </button>
    )
  }

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
      onPointerCancel={(e) => handleDragEnd(e)}
      onPointerMove={handleDrag}
      onPointerUp={(e) => handleDragEnd(e)}
      ref={dragRef}
      style={{
        left: `${state.position.x}px`,
        top: `${state.position.y}px`,
        width: state.isMinimized ? 'auto' : `${state.width}px`,
        height: state.isMinimized ? '48px' : `${state.height}px`,
      }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex cursor-move items-center justify-between bg-muted/50 px-4 py-2',
          !state.isMinimized && 'border-b',
        )}
        onPointerDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <TreeViewIcon className="h-4 w-4" />
          <span className="font-semibold text-sm">Nodes Debugger</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label={debug ? 'Disable debug mode' : 'Enable debug mode'}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
              debug
                ? 'bg-orange-500/20 text-orange-600 hover:bg-orange-500/30 dark:text-orange-400'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
            onClick={(e) => {
              e.stopPropagation()
              setDebug(!debug)
            }}
            type="button"
          >
            <Bug className="h-3.5 w-3.5" />
            {debug ? 'Debug ON' : 'Debug OFF'}
          </button>
          <button
            aria-label={state.isMinimized ? 'Maximize' : 'Minimize'}
            className="rounded p-1 hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation()
              setState((prev) => {
                const willBeMinimized = !prev.isMinimized
                // When expanding (willBeMinimized = false), ensure position stays within viewport
                if (!willBeMinimized) {
                  return {
                    ...prev,
                    isMinimized: willBeMinimized,
                    position: {
                      x: Math.max(0, Math.min(prev.position.x, window.innerWidth - prev.width)),
                      y: Math.max(0, Math.min(prev.position.y, window.innerHeight - prev.height)),
                    },
                  }
                }
                return { ...prev, isMinimized: willBeMinimized }
              })
            }}
            type="button"
          >
            {state.isMinimized ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </button>
          <button
            aria-label="Close"
            className="rounded p-1 hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation()
              setState((prev) => ({ ...prev, isOpen: false }))
            }}
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      {!state.isMinimized && (
        <div className="flex overflow-hidden" style={{ flex: 1 }}>
          {/* Tree View */}
          <div className="w-1/2 overflow-auto border-r">
            <TreeProvider
              defaultExpandedIds={defaultExpandedIds}
              onExpandedChange={(ids) => setState((prev) => ({ ...prev, expandedIds: ids }))}
              onSelectionChange={handleNodeSelect}
              selectedIds={activeSelectedIds}
            >
              <TreeView>
                {levels.map((level: AnyNode, index: number) => (
                  <NodeTreeItem
                    isLast={index === levels.length - 1}
                    key={level.id}
                    level={0}
                    node={level}
                  />
                ))}
              </TreeView>
            </TreeProvider>
          </div>

          {/* Details Panel */}
          <div className="w-1/2">
            <NodeDetailsPanel nodeId={selectedNodeId} />
          </div>
        </div>
      )}
    </div>
  )
}
