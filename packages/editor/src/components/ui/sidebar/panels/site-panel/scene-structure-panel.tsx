import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import {
  Boxes,
  Building2,
  Cable,
  CircleDot,
  Database,
  Layers,
  Map,
  Package,
  Search,
} from 'lucide-react'
import {
  type ComponentType,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '../../../../../lib/utils'
import {
  buildSceneStructure,
  type SceneStructureItem,
  type SceneStructureMode,
  suggestSceneStructureMode,
} from '../../../../../lib/scene-structure'

const STRUCTURE_MODES: Array<{
  id: SceneStructureMode
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'spatial', label: 'Spatial', icon: Map },
  { id: 'system', label: 'System', icon: Cable },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'asset-source', label: 'Source', icon: Package },
  { id: 'elevation', label: 'Elevation', icon: Layers },
]

function modeLabel(mode: SceneStructureMode) {
  return STRUCTURE_MODES.find((item) => item.id === mode)?.label ?? mode
}

function focusNode(nodeId: string) {
  emitter.emit('camera-controls:focus', { nodeId: nodeId as AnyNodeId })
}

function selectStructureItem(item: SceneStructureItem, event: React.MouseEvent) {
  event.stopPropagation()
  const selectedIds = useViewer.getState().selection.selectedIds.map(String)
  const setSelection = useViewer.getState().setSelection
  if (event.metaKey || event.ctrlKey) {
    setSelection({
      selectedIds: selectedIds.includes(item.nodeId)
        ? selectedIds.filter((id) => id !== item.nodeId)
        : [...selectedIds, item.nodeId],
    })
    return
  }
  setSelection({ selectedIds: [item.nodeId] })
}

const StructureItemRow = memo(function StructureItemRow({ item }: { item: SceneStructureItem }) {
  const selected = useViewer((state) => state.selection.selectedIds.includes(item.nodeId))
  const hovered = useViewer((state) => state.hoveredId === item.nodeId)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const rowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!selected) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 border-border/40 border-b px-3 py-2 text-left text-xs transition-colors',
        selected
          ? 'bg-accent/60 text-foreground'
          : hovered
            ? 'bg-accent/30 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
      )}
      data-scene-structure-node-id={item.nodeId}
      data-scene-structure-selected={selected ? 'true' : undefined}
      onClick={(event) => selectStructureItem(item, event)}
      onDoubleClick={() => focusNode(item.nodeId)}
      onMouseEnter={() => setHoveredId(item.nodeId as AnyNodeId)}
      onMouseLeave={() => setHoveredId(null)}
      ref={rowRef}
      type="button"
    >
      <Boxes className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{item.label}</span>
        {item.detail && <span className="block truncate text-[11px] opacity-70">{item.detail}</span>}
      </span>
      {item.badge && (
        <span className="max-w-20 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] opacity-80">
          {item.badge}
        </span>
      )}
    </button>
  )
})

export const SceneStructurePanel = memo(function SceneStructurePanel({
  elevationContent,
}: {
  elevationContent?: ReactNode
}) {
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const suggestedMode = useMemo(() => suggestSceneStructureMode(nodes), [nodes])
  const [mode, setMode] = useState<SceneStructureMode | null>(null)
  const activeMode = mode ?? suggestedMode
  const tree = useMemo(
    () => buildSceneStructure({ nodes, rootNodeIds, mode: activeMode }),
    [activeMode, nodes, rootNodeIds],
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="scene-structure-panel">
      <div className="border-border/50 border-b bg-[#2C2C2E] p-1">
        <div className="mb-1 flex items-center gap-1">
          <button
            className={cn(
              'flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 text-[11px] transition-colors',
              mode === null
                ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
            )}
            data-testid="scene-structure-mode-auto"
            onClick={() => setMode(null)}
            type="button"
          >
            <CircleDot className="h-3.5 w-3.5" />
            <span className="truncate">Auto: {modeLabel(suggestedMode)}</span>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {STRUCTURE_MODES.map((item) => {
            const Icon = item.icon
            const selected = activeMode === item.id
            return (
              <button
                className={cn(
                  'flex h-8 items-center justify-center gap-1 rounded-md px-1 text-[11px] transition-colors',
                  selected
                    ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                )}
                data-testid={`scene-structure-mode-${item.id}`}
                key={item.id}
                onClick={() => setMode(item.id)}
                type="button"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-border/50 border-b px-3 py-2 text-muted-foreground text-xs">
        <span className="flex items-center gap-1">
          <Building2 className="h-3.5 w-3.5" />
          Scene Structure
        </span>
        <span data-testid="scene-structure-summary">
          {tree.summary.itemCount} objects / {tree.summary.groupCount} groups
        </span>
      </div>

      {activeMode === 'elevation' && elevationContent ? (
        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">{elevationContent}</div>
      ) : (
        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
          {tree.groups.length === 0 ? (
            <div className="px-3 py-5 text-muted-foreground text-sm">
              <Search className="mb-2 h-4 w-4 opacity-70" />
              <div className="font-medium text-foreground text-xs">
                No {modeLabel(activeMode)} objects
              </div>
              <div className="mt-1 text-xs">
                Switch structure mode or add objects with matching scene metadata.
              </div>
            </div>
          ) : (
            tree.groups.map((group) => (
              <div className="border-border/50 border-b" key={group.id}>
                <div className="flex items-center justify-between gap-2 bg-muted/20 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[13px] text-foreground">
                      {group.label}
                    </span>
                    {group.detail && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {group.detail}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {group.items.length}
                  </span>
                </div>
                <div>
                  {group.items.map((item) => (
                    <StructureItemRow item={item} key={`${group.id}:${item.id}`} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
})
