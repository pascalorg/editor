import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type GuideNode,
  LevelNode,
  type ScanNode,
  type SiteNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  Camera,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pentagon,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './../../../../../components/ui/primitives/popover'
import { deleteLevelWithFallbackSelection } from './../../../../../lib/level-selection'
import { cn } from './../../../../../lib/utils'
import useEditor from './../../../../../store/use-editor'
import { useUploadStore } from '../../../../../store/use-upload'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, TreeNode } from './tree-node'
import { TreeNodeDragProvider } from './tree-node-drag'

// ============================================================================
// PROPERTY LINE SECTION
// ============================================================================

function calculatePerimeter(points: Array<[number, number]>): number {
  if (points.length < 2) return 0
  let perimeter = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    perimeter += Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
  }
  return perimeter
}

function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [currentX, currentY] = polygon[i]!
    const [nextX, nextY] = polygon[j]!
    area += currentX * nextY
    area -= nextX * currentY
  }
  return Math.abs(area) / 2
}

function useSiteNode(): SiteNode | null {
  const siteId = useScene((state) => {
    for (const id of state.rootNodeIds) {
      if (state.nodes[id]?.type === 'site') return id
    }
    return null
  })
  return useScene((state) =>
    siteId ? ((state.nodes[siteId] as SiteNode | undefined) ?? null) : null,
  )
}

const PropertyLineSection = memo(function PropertyLineSection() {
  const siteNode = useSiteNode()
  const updateNode = useScene((state) => state.updateNode)
  const mode = useEditor((state) => state.mode)
  const setMode = useEditor((state) => state.setMode)

  if (!siteNode) return null

  const points = siteNode.polygon?.points ?? []
  const area = calculatePolygonArea(points)
  const perimeter = calculatePerimeter(points)
  const isEditing = mode === 'edit'

  const handleToggleEdit = () => {
    setMode(isEditing ? 'select' : 'edit')
  }

  const handlePointChange = (index: number, axis: 0 | 1, value: number) => {
    const newPoints = [...points.map((p) => [...p] as [number, number])]
    newPoints[index]![axis] = value
    updateNode(siteNode.id, {
      polygon: { type: 'polygon' as const, points: newPoints },
    })
  }

  const handleAddPoint = () => {
    const lastPoint = points[points.length - 1]
    const firstPoint = points[0]
    if (!(lastPoint && firstPoint)) return

    const newPoint: [number, number] = [
      (lastPoint[0] + firstPoint[0]) / 2,
      (lastPoint[1] + firstPoint[1]) / 2,
    ]
    const newPoints = [...points, newPoint]
    updateNode(siteNode.id, {
      polygon: { type: 'polygon' as const, points: newPoints },
    })
  }

  const handleDeletePoint = (index: number) => {
    if (points.length <= 3) return
    const newPoints = points.filter((_, i) => i !== index)
    updateNode(siteNode.id, {
      polygon: { type: 'polygon' as const, points: newPoints },
    })
  }

  return (
    <div className="relative border-border/50 border-b">
      {/* Vertical tree line */}
      <div className="absolute top-0 bottom-0 left-[21px] w-px bg-border/50" />

      {/* Header */}
      <div className="relative flex items-center justify-between py-2 pr-3 pl-10">
        {/* Horizontal branch line */}
        <div className="absolute top-1/2 left-[21px] h-px w-4 bg-border/50" />

        <div className="flex items-center gap-2">
          <Pentagon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Property Line</span>
        </div>
        <button
          className={cn(
            'flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors',
            isEditing
              ? 'bg-orange-500/20 text-orange-400'
              : 'text-muted-foreground hover:bg-accent',
          )}
          onClick={handleToggleEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Measurements */}
      <div className="relative flex gap-3 pr-3 pb-2 pl-10">
        <div className="text-muted-foreground text-xs">
          Area: <span className="text-foreground">{area.toFixed(1)} m²</span>
        </div>
        <div className="text-muted-foreground text-xs">
          Perimeter: <span className="text-foreground">{perimeter.toFixed(1)} m</span>
        </div>
      </div>

      {/* Vertex list (shown when editing) */}
      {isEditing && (
        <div className="relative pr-3 pb-2 pl-10">
          <div className="flex flex-col gap-1">
            {points.map((point, index) => (
              <div className="flex items-center gap-1.5 text-xs" key={index}>
                <span className="w-4 shrink-0 text-right text-muted-foreground">{index + 1}</span>
                <label className="shrink-0 text-muted-foreground">X</label>
                <input
                  className="w-16 rounded border border-border/50 bg-accent/50 px-1.5 py-0.5 text-foreground text-xs focus:border-primary focus:outline-none"
                  onChange={(e) =>
                    handlePointChange(index, 0, Number.parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  type="number"
                  value={point[0]}
                />
                <label className="shrink-0 text-muted-foreground">Z</label>
                <input
                  className="w-16 rounded border border-border/50 bg-accent/50 px-1.5 py-0.5 text-foreground text-xs focus:border-primary focus:outline-none"
                  onChange={(e) =>
                    handlePointChange(index, 1, Number.parseFloat(e.target.value) || 0)
                  }
                  step={0.5}
                  type="number"
                  value={point[1]}
                />
                <button
                  className={cn(
                    'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded',
                    points.length > 3
                      ? 'text-muted-foreground hover:bg-red-500/20 hover:text-red-400'
                      : 'cursor-not-allowed text-muted-foreground/30',
                  )}
                  disabled={points.length <= 3}
                  onClick={() => handleDeletePoint(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="mt-1.5 flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent/50 hover:text-foreground"
            onClick={handleAddPoint}
          >
            <Plus className="h-3 w-3" />
            Add point
          </button>
        </div>
      )}
    </div>
  )
})

// ============================================================================
// SITE PHASE VIEW - Property line + building buttons
// ============================================================================

const CameraPopover = memo(function CameraPopover({
  nodeId,
  hasCamera,
  open,
  onOpenChange,
  buttonClassName,
}: {
  nodeId: AnyNodeId
  hasCamera: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  buttonClassName?: string
}) {
  const updateNode = useScene((state) => state.updateNode)
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'relative flex h-6 w-6 cursor-pointer items-center justify-center rounded',
            buttonClassName,
          )}
          onClick={(e) => e.stopPropagation()}
          title="Camera snapshot"
        >
          <Camera className="h-3.5 w-3.5" />
          {hasCamera && (
            <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-1"
        onClick={(e) => e.stopPropagation()}
        side="right"
      >
        <div className="flex flex-col gap-0.5">
          {hasCamera && (
            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation()
                emitter.emit('camera-controls:view', { nodeId })
                onOpenChange(false)
              }}
            >
              <Camera className="h-3.5 w-3.5" />
              View snapshot
            </button>
          )}
          <button
            className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation()
              emitter.emit('camera-controls:capture', { nodeId })
              onOpenChange(false)
            }}
          >
            <Camera className="h-3.5 w-3.5" />
            {hasCamera ? 'Update snapshot' : 'Take snapshot'}
          </button>
          {hasCamera && (
            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-destructive hover:text-destructive-foreground"
              onClick={(e) => {
                e.stopPropagation()
                updateNode(nodeId, { camera: undefined })
                onOpenChange(false)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear snapshot
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})

const ReferenceItem = memo(function ReferenceItem({
  refNode,
  isLastRow,
  setSelectedReferenceId,
  handleDelete,
}: {
  refNode: ScanNode | GuideNode
  isLastRow: boolean
  setSelectedReferenceId: (id: string) => void
  handleDelete: (id: string, e: React.MouseEvent) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const handleSelect = () => {
    setSelectedReferenceId(refNode.id)
  }

  const handleDoubleClick = () => {
    focusTreeNode(refNode.id as AnyNodeId)
  }

  return (
    <div
      className="group/ref relative flex h-8 cursor-pointer select-none items-center border-border/50 border-b pr-2 text-xs transition-colors hover:bg-accent/30"
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className={cn(
          'pointer-events-none absolute z-10 w-px bg-border/50',
          isLastRow ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
        )}
        style={{ left: 45 }}
      />
      <div
        className="pointer-events-none absolute top-1/2 z-10 h-px bg-border/50"
        style={{ left: 45, width: 8 }}
      />

      <div className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-0 pl-[60px] text-muted-foreground group-hover/ref:text-foreground">
        {refNode.type === 'scan' ? (
          <img
            alt="Scan"
            className="h-3.5 w-3.5 shrink-0 object-contain opacity-70 transition-opacity group-hover/ref:opacity-100"
            src="/icons/mesh.png"
          />
        ) : (
          <img
            alt="Guide"
            className="h-3.5 w-3.5 shrink-0 object-contain opacity-70 transition-opacity group-hover/ref:opacity-100"
            src="/icons/floorplan.png"
          />
        )}
        <InlineRenameInput
          defaultName={refNode.type === 'scan' ? '3D Scan' : 'Guide Image'}
          isEditing={isEditing}
          nodeId={refNode.id as AnyNodeId}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      </div>

      <button
        className="z-20 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-black/5 hover:text-foreground group-hover/ref:opacity-100 dark:hover:bg-white/10"
        onClick={(e) => handleDelete(refNode.id, e)}
        title="Delete"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
})

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

interface LevelReferencesProps {
  levelId: string
  isLastLevel?: boolean
  projectId?: string
  onUploadAsset?: (projectId: string, levelId: string, file: File, type: 'scan' | 'guide') => void
  onDeleteAsset?: (projectId: string, url: string) => void
}

const LevelReferences = memo(function LevelReferences({
  levelId,
  isLastLevel,
  projectId,
  onUploadAsset,
  onDeleteAsset,
}: LevelReferencesProps) {
  const deleteNode = useScene((s) => s.deleteNode)
  const references = useScene(
    useShallow((s) =>
      Object.values(s.nodes).filter(
        (node): node is ScanNode | GuideNode =>
          (node.type === 'scan' || node.type === 'guide') && node.parentId === levelId,
      ),
    ),
  )
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const uploadState = useUploadStore((s) => s.uploads[levelId])
  const clearUpload = useUploadStore((s) => s.clearUpload)

  const uploading =
    uploadState?.status === 'preparing' ||
    uploadState?.status === 'uploading' ||
    uploadState?.status === 'confirming'
  const uploadingType = uploadState?.assetType ?? null
  const uploadError = uploadState?.error ?? null
  const progress = uploadState?.progress ?? 0

  const scanInputRef = useRef<HTMLInputElement>(null)

  const handleAddAsset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!projectId) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name)
      useUploadStore.getState().setError(levelId, 'No active project. Please open a project first.')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name)
      useUploadStore
        .getState()
        .setError(
          levelId,
          `File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 200 MB.`,
        )
      return
    }

    // Auto-detect type based on file extension/mime type
    const isScan =
      file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')
    const isImage = file.type.startsWith('image/')

    if (!(isScan || isImage)) {
      useUploadStore.getState().startUpload(levelId, 'scan', file.name)
      useUploadStore
        .getState()
        .setError(levelId, 'Invalid file type. Please upload a .glb/.gltf scan or an image.')
      return
    }

    const type = isScan ? 'scan' : 'guide'

    clearUpload(levelId)
    onUploadAsset?.(projectId, levelId, file, type)
  }

  const handleDelete = async (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const refNode = useScene.getState().nodes[nodeId as AnyNodeId] as
      | ScanNode
      | GuideNode
      | undefined

    if (
      projectId &&
      refNode?.url &&
      (refNode.url.startsWith('http://') || refNode.url.startsWith('https://'))
    ) {
      onDeleteAsset?.(projectId, refNode.url)
    }
    deleteNode(nodeId as AnyNodeId)
  }

  const rows = [
    { type: 'upload' as const },
    ...references.map((ref) => ({ type: 'ref' as const, data: ref })),
  ]

  return (
    <div className="relative flex flex-col">
      {!isLastLevel && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-border/50"
          style={{ left: 21 }}
        />
      )}

      {rows.map((row, i) => {
        const isLastRow = i === rows.length - 1

        if (row.type === 'upload') {
          return (
            <div className="group/ref relative border-border/50 border-b" key="upload">
              <div
                className={cn(
                  'pointer-events-none absolute z-10 w-px bg-border/50',
                  isLastRow ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
                )}
                style={{ left: 45 }}
              />
              <div
                className="pointer-events-none absolute top-1/2 z-10 h-px bg-border/50"
                style={{ left: 45, width: 8 }}
              />

              <button
                className="flex h-8 w-full cursor-pointer select-none items-center gap-2 py-0 pr-2 pl-[60px] text-left text-muted-foreground text-xs transition-colors hover:bg-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={uploading}
                onClick={() => scanInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {uploading ? `Uploading ${uploadingType}... ${progress}%` : 'Upload scan/floorplan'}
              </button>

              <input
                accept=".glb,.gltf,image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAddAsset}
                ref={scanInputRef}
                type="file"
              />
            </div>
          )
        }

        const ref = row.data as ScanNode | GuideNode
        return (
          <ReferenceItem
            handleDelete={handleDelete}
            isLastRow={isLastRow}
            key={ref.id}
            refNode={ref}
            setSelectedReferenceId={setSelectedReferenceId}
          />
        )
      })}

      {uploadError && (
        <div className="relative flex min-h-8 select-none items-center border-border/50 border-b bg-destructive/5 py-1 pr-2 pl-[60px] text-[10px] text-destructive">
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-border/50"
            style={{ left: 45 }}
          />
          {uploadError}
        </div>
      )}
    </div>
  )
})

const LevelItem = memo(function LevelItem({
  level,
  selectedLevelId,
  setSelection,
  updateNode,
  isLast,
  projectId,
  onUploadAsset,
  onDeleteAsset,
}: {
  level: LevelNode
  selectedLevelId: string | null
  setSelection: (selection: any) => void
  updateNode: (id: AnyNodeId, updates: Partial<AnyNode>) => void
  isLast?: boolean
  projectId?: string
  onUploadAsset?: (projectId: string, levelId: string, file: File, type: 'scan' | 'guide') => void
  onDeleteAsset?: (projectId: string, url: string) => void
}) {
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const isSelected = selectedLevelId === level.id
  const canDeleteLevel = level.level !== 0
  const [isExpanded, setIsExpanded] = useState(isSelected)

  useEffect(() => {
    setIsExpanded(isSelected)
  }, [isSelected])

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  const handleSelect = () => {
    setSelection({ levelId: level.id })
  }

  const handleDoubleClick = () => {
    focusTreeNode(level.id)
  }

  return (
    <div className="relative flex flex-col">
      <div
        className={cn(
          'group/level relative flex h-8 cursor-pointer select-none items-center border-border/50 border-b pr-2 transition-all duration-200',
          isSelected
            ? 'bg-accent/50 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
        )}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        ref={itemRef}
      >
        {/* Vertical tree line */}
        <div
          className={cn(
            'pointer-events-none absolute left-[21px] z-10 w-px bg-border/50',
            isLast && !isExpanded ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
          )}
        />
        {/* Horizontal branch line */}
        <div className="pointer-events-none absolute top-1/2 left-[21px] z-10 h-px w-[11px] bg-border/50" />
        <div
          className={cn(
            'pointer-events-none absolute top-[10px] left-[32px] z-10 h-[12px] w-4 transition-colors duration-200',
            isSelected ? 'bg-accent/50' : 'bg-background group-hover/level:bg-accent/30',
          )}
        />
        {/* Line down to children */}
        {isExpanded && (
          <div className="pointer-events-none absolute top-[16px] bottom-0 left-[45px] z-10 w-px bg-border/50" />
        )}

        <div className="relative z-20 flex h-8 items-center pr-1 pl-[28px]">
          <button
            className="z-20 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center bg-inherit"
            onClick={(e) => {
              e.stopPropagation()
              if (isSelected) {
                setIsExpanded(!isExpanded)
              } else {
                setSelection({ levelId: level.id })
              }
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 -rotate-90 text-muted-foreground" />
            )}
          </button>
        </div>

        <div className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-0 pl-0.5 text-sm">
          <img
            alt="Level"
            className={cn(
              'h-4 w-4 shrink-0 object-contain transition-all duration-200',
              !isSelected && 'opacity-60 grayscale',
            )}
            src="/icons/level.png"
          />
          <InlineRenameInput
            defaultName={`Level ${level.level}`}
            isEditing={isEditing}
            nodeId={level.id}
            onStartEditing={() => setIsEditing(true)}
            onStopEditing={() => setIsEditing(false)}
          />
        </div>
        {/* Camera snapshot button */}
        <Popover onOpenChange={setCameraPopoverOpen} open={cameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'relative mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-colors group-hover/level:opacity-100',
                selectedLevelId === level.id
                  ? 'hover:bg-black/5 dark:hover:bg-white/10'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="h-3.5 w-3.5" />
              {level.camera && (
                <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
            side="right"
          >
            <div className="flex flex-col gap-0.5">
              {level.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    emitter.emit('camera-controls:view', { nodeId: level.id })
                    setCameraPopoverOpen(false)
                  }}
                >
                  <Camera className="h-3.5 w-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  emitter.emit('camera-controls:capture', { nodeId: level.id })
                  setCameraPopoverOpen(false)
                }}
              >
                <Camera className="h-3.5 w-3.5" />
                {level.camera ? 'Update snapshot' : 'Take snapshot'}
              </button>
              {level.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNode(level.id, { camera: undefined })
                    setCameraPopoverOpen(false)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-colors group-hover/level:opacity-100',
                selectedLevelId === level.id
                  ? 'hover:bg-black/5 dark:hover:bg-white/10'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-40 p-1" side="right">
            <button
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors enabled:cursor-pointer enabled:hover:bg-accent enabled:hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canDeleteLevel}
              onClick={() => deleteLevelWithFallbackSelection(level.id)}
              title={canDeleteLevel ? 'Delete level' : 'The ground level cannot be deleted'}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </PopoverContent>
        </Popover>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          >
            <LevelReferences
              isLastLevel={isLast}
              levelId={level.id}
              onDeleteAsset={onDeleteAsset}
              onUploadAsset={onUploadAsset}
              projectId={projectId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

const LevelsSection = memo(function LevelsSection({
  projectId,
  onUploadAsset,
  onDeleteAsset,
}: {
  projectId?: string
  onUploadAsset?: (projectId: string, levelId: string, file: File, type: 'scan' | 'guide') => void
  onDeleteAsset?: (projectId: string, url: string) => void
} = {}) {
  const createNode = useScene((state) => state.createNode)
  const updateNode = useScene((state) => state.updateNode)
  const selectedBuildingId = useViewer((state) => state.selection.buildingId)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)

  const building = useScene((s) =>
    selectedBuildingId ? ((s.nodes[selectedBuildingId] as BuildingNode | undefined) ?? null) : null,
  )
  const levels = useScene(
    useShallow((s) => {
      if (!selectedBuildingId) return []
      const bldg = s.nodes[selectedBuildingId] as BuildingNode | undefined
      if (!bldg) return []
      return bldg.children
        .map((id) => s.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
    }),
  )

  if (!building) return null

  const handleAddLevel = () => {
    const newLevel = LevelNode.parse({
      level: levels.length,
      children: [],
      parentId: building.id,
    })
    createNode(newLevel, building.id)
    setSelection({ levelId: newLevel.id })
  }

  return (
    <div className="relative flex flex-col">
      {/* Level buttons */}
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          className="relative flex h-8 cursor-pointer select-none items-center gap-2 border-border/50 border-b py-0 pl-0 text-muted-foreground text-sm transition-all duration-200 hover:bg-accent/30 hover:text-foreground"
          onClick={handleAddLevel}
        >
          {/* Vertical tree line */}
          <div className="pointer-events-none absolute top-0 bottom-0 left-[21px] w-px bg-border/50" />
          {/* Horizontal branch line */}
          <div className="pointer-events-none absolute top-1/2 left-[21px] z-10 h-px w-[11px] bg-border/50" />

          <div className="relative z-10 flex items-center pr-1 pl-[38px]">
            <Plus className="h-3.5 w-3.5" />
          </div>
          <span className="truncate">Add level</span>
        </button>
        {levels.length === 0 && (
          <div className="relative flex h-8 select-none items-center border-border/50 border-b py-0 pr-2 pl-[38px] text-muted-foreground text-xs">
            {/* Vertical tree line */}
            <div className="pointer-events-none absolute top-0 bottom-1/2 left-[21px] w-px bg-border/50" />
            {/* Horizontal branch line */}
            <div className="pointer-events-none absolute top-1/2 left-[21px] h-px w-[11px] bg-border/50" />
            No levels yet
          </div>
        )}
        {[...levels].reverse().map((level, index) => (
          <LevelItem
            isLast={index === levels.length - 1}
            key={level.id}
            level={level}
            onDeleteAsset={onDeleteAsset}
            onUploadAsset={onUploadAsset}
            projectId={projectId}
            selectedLevelId={selectedLevelId}
            setSelection={setSelection}
            updateNode={updateNode}
          />
        ))}
      </div>
    </div>
  )
})

const LayerToggle = memo(function LayerToggle() {
  const structureLayer = useEditor((state) => state.structureLayer)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const phase = useEditor((state) => state.phase)
  const setPhase = useEditor((state) => state.setPhase)

  const activeTab =
    phase === 'structure' && structureLayer === 'elements'
      ? 'structure'
      : phase === 'furnish'
        ? 'furnish'
        : phase === 'structure' && structureLayer === 'zones'
          ? 'zones'
          : 'none'

  return (
    <div className="relative flex items-center gap-1 border-border/50 border-b bg-[#2C2C2E] p-1">
      <button
        className={cn(
          'relative flex flex-1 cursor-pointer flex-col items-center justify-center rounded-md py-2 font-medium text-[10px] transition-all duration-200',
          activeTab === 'structure'
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        )}
        onClick={() => {
          setPhase('structure')
          setStructureLayer('elements')
        }}
      >
        {activeTab === 'structure' && (
          <motion.div
            className="absolute inset-0 rounded-md bg-[#3e3e3e] shadow-sm ring-1 ring-border/50"
            layoutId="layerToggleActiveBg"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            alt="Structure"
            className={cn(
              'mb-1 h-6 w-6 transition-all',
              activeTab !== 'structure' && 'opacity-50 grayscale',
            )}
            src="/icons/room.png"
          />
          Structure
        </div>
        <div className="absolute right-1.5 bottom-1 z-10 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md">
          <span className="block font-medium font-mono text-[9px] text-muted-foreground/70 leading-none">
            B
          </span>
        </div>
      </button>

      <button
        className={cn(
          'relative flex flex-1 cursor-pointer flex-col items-center justify-center rounded-md py-2 font-medium text-[10px] transition-all duration-200',
          activeTab === 'furnish'
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        )}
        onClick={() => {
          setPhase('furnish')
        }}
      >
        {activeTab === 'furnish' && (
          <motion.div
            className="absolute inset-0 rounded-md bg-[#3e3e3e] shadow-sm ring-1 ring-border/50"
            layoutId="layerToggleActiveBg"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            alt="Furnish"
            className={cn(
              'mb-1 h-6 w-6 transition-all',
              activeTab !== 'furnish' && 'opacity-50 grayscale',
            )}
            src="/icons/couch.png"
          />
          Furnish
        </div>
        <div className="absolute right-1.5 bottom-1 z-10 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md">
          <span className="block font-medium font-mono text-[9px] text-muted-foreground/70 leading-none">
            F
          </span>
        </div>
      </button>

      <button
        className={cn(
          'relative flex flex-1 cursor-pointer flex-col items-center justify-center rounded-md py-2 font-medium text-[10px] transition-all duration-200',
          activeTab === 'zones'
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        )}
        onClick={() => {
          setPhase('structure')
          setStructureLayer('zones')
        }}
      >
        {activeTab === 'zones' && (
          <motion.div
            className="absolute inset-0 rounded-md bg-[#3e3e3e] shadow-sm ring-1 ring-border/50"
            layoutId="layerToggleActiveBg"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <img
            alt="Zones"
            className={cn(
              'mb-1 h-6 w-6 transition-all',
              activeTab !== 'zones' && 'opacity-50 grayscale',
            )}
            src="/icons/kitchen.png"
          />
          Zones
        </div>
        <div className="absolute right-1.5 bottom-1 z-10 rounded border border-border/40 bg-background/40 px-1 py-[2px] backdrop-blur-md">
          <span className="block font-medium font-mono text-[9px] text-muted-foreground/70 leading-none">
            Z
          </span>
        </div>
      </button>
    </div>
  )
})

const ZoneItem = memo(function ZoneItem({ zone, isLast }: { zone: ZoneNode; isLast?: boolean }) {
  const [isEditing, setIsEditing] = useState(false)
  const [cameraPopoverOpen, setCameraPopoverOpen] = useState(false)
  const deleteNode = useScene((state) => state.deleteNode)
  const updateNode = useScene((state) => state.updateNode)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const hoveredId = useViewer((state) => state.hoveredId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const setPhase = useEditor((state) => state.setPhase)
  const setMode = useEditor((state) => state.setMode)

  const isSelected = selectedZoneId === zone.id
  const isHovered = hoveredId === zone.id

  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  const area = calculatePolygonArea(zone.polygon).toFixed(1)
  const defaultName = `Zone (${area}m²)`

  const handleClick = () => {
    setSelection({ zoneId: zone.id })
    setPhase('structure')
    setMode('select')
  }

  const handleDoubleClick = () => {
    focusTreeNode(zone.id)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteNode(zone.id)
    if (isSelected) {
      setSelection({ zoneId: null })
    }
  }

  const handleColorChange = (color: string) => {
    updateNode(zone.id, { color })
  }

  return (
    <div
      className={cn(
        'group/row relative flex h-8 cursor-pointer select-none items-center border-border/50 border-b px-3 text-sm transition-all duration-200',
        isSelected
          ? 'bg-accent/50 text-foreground'
          : isHovered
            ? 'bg-accent/30 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHoveredId(zone.id)}
      onMouseLeave={() => setHoveredId(null)}
      ref={itemRef}
    >
      {/* Vertical tree line */}
      <div
        className={cn(
          'pointer-events-none absolute w-px bg-border/50',
          isLast ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
        )}
        style={{ left: 8 }}
      />
      {/* Horizontal branch line */}
      <div
        className="pointer-events-none absolute top-1/2 h-px bg-border/50"
        style={{ left: 8, width: 4 }}
      />

      <span className={cn('mr-2', !isSelected && 'opacity-40')}>
        <ColorDot color={zone.color} onChange={handleColorChange} />
      </span>
      <div className="min-w-0 flex-1 pr-1">
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          nodeId={zone.id}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      </div>
      <div className="flex items-center gap-0.5">
        {/* Camera snapshot button */}
        <Popover onOpenChange={setCameraPopoverOpen} open={cameraPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-black/5 hover:text-foreground group-hover/row:opacity-100 dark:hover:bg-white/10"
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="h-3 w-3" />
              {zone.camera && (
                <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
            side="right"
          >
            <div className="flex flex-col gap-0.5">
              {zone.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    emitter.emit('camera-controls:view', { nodeId: zone.id })
                    setCameraPopoverOpen(false)
                  }}
                >
                  <Camera className="h-3.5 w-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  emitter.emit('camera-controls:capture', { nodeId: zone.id })
                  setCameraPopoverOpen(false)
                }}
              >
                <Camera className="h-3.5 w-3.5" />
                {zone.camera ? 'Update snapshot' : 'Take snapshot'}
              </button>
              {zone.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNode(zone.id, { camera: undefined })
                    setCameraPopoverOpen(false)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <button
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-black/5 hover:text-foreground group-hover/row:opacity-100 dark:hover:bg-white/10"
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
})

const MultiSelectionBadge = memo(function MultiSelectionBadge() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)

  if (selectedIds.length <= 1) return null

  return (
    <div className="pointer-events-none sticky top-4 z-50 flex h-0 w-full justify-center overflow-visible">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-primary/20 bg-primary px-0.5 py-4 pl-2 font-medium text-primary-foreground text-xs shadow-black/10 shadow-lg backdrop-blur-md">
        <span>{selectedIds.length} objects selected</span>
        <button
          className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-primary-foreground/20"
          onClick={() => setSelection({ selectedIds: [] })}
          title="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
})

const ContentSection = memo(function ContentSection() {
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const structureLayer = useEditor((state) => state.structureLayer)
  const phase = useEditor((state) => state.phase)
  const setPhase = useEditor((state) => state.setPhase)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)

  const level = useScene((s) =>
    selectedLevelId ? ((s.nodes[selectedLevelId] as LevelNode | undefined) ?? null) : null,
  )
  const levelZones = useScene(
    useShallow((s) => {
      if (!selectedLevelId) return []
      return Object.values(s.nodes).filter(
        (node): node is ZoneNode => node.type === 'zone' && node.parentId === selectedLevelId,
      )
    }),
  )
  const elementChildren = useScene(
    useShallow((s) => {
      if (!selectedLevelId) return []
      const lvl = s.nodes[selectedLevelId] as LevelNode | undefined
      if (!lvl) return []
      return lvl.children.filter((childId) => s.nodes[childId]?.type !== 'zone')
    }),
  )

  if (!level) {
    return (
      <div className="px-3 py-4 text-muted-foreground text-sm">Select a level to view content</div>
    )
  }

  if (structureLayer === 'zones') {
    const handleAddZone = () => {
      setPhase('structure')
      setMode('build')
      setTool('zone')
    }

    if (levelZones.length === 0) {
      return (
        <div className="px-3 py-4 text-muted-foreground text-sm">
          No zones on this level.{' '}
          <button className="cursor-pointer text-primary hover:underline" onClick={handleAddZone}>
            Add one
          </button>
        </div>
      )
    }

    return (
      <div className="flex flex-col">
        {levelZones.map((zone, index) => (
          <ZoneItem isLast={index === levelZones.length - 1} key={zone.id} zone={zone} />
        ))}
      </div>
    )
  }

  if (elementChildren.length === 0) {
    return <div className="px-3 py-4 text-muted-foreground text-sm">No elements on this level</div>
  }
  return (
    <TreeNodeDragProvider>
      <div className="flex flex-col">
        {elementChildren.map((childId, index) => (
          <TreeNode
            depth={0}
            isLast={index === elementChildren.length - 1}
            key={childId}
            nodeId={childId}
          />
        ))}
      </div>
    </TreeNodeDragProvider>
  )
})

const BuildingItem = memo(function BuildingItem({
  building,
  isBuildingActive,
  buildingCameraOpen,
  setBuildingCameraOpen,
  projectId,
  onUploadAsset,
  onDeleteAsset,
}: {
  building: BuildingNode
  isBuildingActive: boolean
  buildingCameraOpen: string | null
  setBuildingCameraOpen: (id: string | null) => void
  projectId?: string
  onUploadAsset?: (projectId: string, levelId: string, file: File, type: 'scan' | 'guide') => void
  onDeleteAsset?: (projectId: string, url: string) => void
}) {
  const setSelection = useViewer((state) => state.setSelection)
  const phase = useEditor((state) => state.phase)
  const setPhase = useEditor((state) => state.setPhase)
  const updateNode = useScene((state) => state.updateNode)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isBuildingActive && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isBuildingActive])

  const handleSelect = () => {
    setSelection({ buildingId: building.id })
    if (phase === 'site') {
      setPhase('structure')
    }
  }

  const handleDoubleClick = () => {
    focusTreeNode(building.id)
  }

  return (
    <div
      className={cn('flex shrink-0 flex-col overflow-hidden', isBuildingActive && 'min-h-0 flex-1')}
    >
      <div
        className={cn(
          'group/building flex h-10 shrink-0 cursor-pointer items-center border-border/50 border-b pr-2 transition-all duration-200',
          isBuildingActive
            ? 'bg-accent/50 text-foreground'
            : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
        )}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        ref={itemRef}
      >
        <div className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-3">
          <img
            alt="Building"
            className={cn(
              'h-5 w-5 object-contain transition-all',
              !isBuildingActive && 'opacity-60 grayscale',
            )}
            src="/icons/building.png"
          />
          <span className="truncate font-medium text-sm">{building.name || 'Building'}</span>
        </div>
        <Popover
          onOpenChange={(open) => setBuildingCameraOpen(open ? building.id : null)}
          open={buildingCameraOpen === building.id}
        >
          <PopoverTrigger asChild>
            <button
              className={cn(
                'relative mr-1.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-colors group-hover/building:opacity-100',
                isBuildingActive
                  ? 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={(e) => e.stopPropagation()}
              title="Camera snapshot"
            >
              <Camera className="h-4 w-4" />
              {building.camera && (
                <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-1"
            onClick={(e) => e.stopPropagation()}
            side="right"
          >
            <div className="flex flex-col gap-0.5">
              {building.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    emitter.emit('camera-controls:view', { nodeId: building.id })
                    setBuildingCameraOpen(null)
                  }}
                >
                  <Camera className="h-3.5 w-3.5" />
                  View snapshot
                </button>
              )}
              <button
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  emitter.emit('camera-controls:capture', { nodeId: building.id })
                  setBuildingCameraOpen(null)
                }}
              >
                <Camera className="h-3.5 w-3.5" />
                {building.camera ? 'Update snapshot' : 'Take snapshot'}
              </button>
              {building.camera && (
                <button
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNode(building.id, { camera: undefined })
                    setBuildingCameraOpen(null)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear snapshot
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Tools and content for the active building */}
      <AnimatePresence initial={false}>
        {isBuildingActive && (
          <motion.div
            animate={{ opacity: 1, flex: '1 1 0%' }}
            className="flex w-full flex-col overflow-hidden"
            exit={{ opacity: 0, flex: '0 0 0px' }}
            initial={{ opacity: 0, flex: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <div className="flex shrink-0 flex-col">
                <LevelsSection
                  onDeleteAsset={onDeleteAsset}
                  onUploadAsset={onUploadAsset}
                  projectId={projectId}
                />
                <LayerToggle />
              </div>
              <div className="subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <MultiSelectionBadge />
                <ContentSection />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export interface SitePanelProps {
  projectId?: string
  onUploadAsset?: (projectId: string, levelId: string, file: File, type: 'scan' | 'guide') => void
  onDeleteAsset?: (projectId: string, url: string) => void
}

export function SitePanel({ projectId, onUploadAsset, onDeleteAsset }: SitePanelProps = {}) {
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const updateNode = useScene((state) => state.updateNode)
  const selectedBuildingId = useViewer((state) => state.selection.buildingId)
  const setSelection = useViewer((state) => state.setSelection)
  const phase = useEditor((state) => state.phase)
  const setPhase = useEditor((state) => state.setPhase)

  const [siteCameraOpen, setSiteCameraOpen] = useState(false)
  const [buildingCameraOpen, setBuildingCameraOpen] = useState<string | null>(null)

  const siteNode = useScene((s) =>
    rootNodeIds[0] ? ((s.nodes[rootNodeIds[0]] as SiteNode | undefined) ?? null) : null,
  )
  const buildings = useScene(
    useShallow((s) => {
      if (!siteNode) return []
      return siteNode.children
        .map((child) => {
          const id = typeof child === 'string' ? child : child.id
          return s.nodes[id] as BuildingNode | undefined
        })
        .filter((node): node is BuildingNode => node?.type === 'building')
    }),
  )

  return (
    <LayoutGroup>
      <div className="flex h-full flex-col">
        {/* Site Header */}
        {siteNode && (
          <motion.div
            className={cn(
              'flex shrink-0 cursor-pointer items-center justify-between border-border/50 border-b px-3 py-3 transition-colors',
              phase === 'site'
                ? 'bg-accent/50 text-foreground'
                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
            )}
            layout="position"
            onClick={() => setPhase('site')}
          >
            <div className="flex items-center gap-2">
              <img
                alt="Site"
                className={cn(
                  'h-5 w-5 object-contain transition-all',
                  phase !== 'site' && 'opacity-60 grayscale',
                )}
                src="/icons/site.png"
              />
              <span className="font-medium text-sm">{siteNode.name || 'Site'}</span>
            </div>
            <CameraPopover
              buttonClassName={cn(
                'transition-colors',
                phase === 'site' ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'hover:bg-accent',
              )}
              hasCamera={!!siteNode.camera}
              nodeId={siteNode.id as AnyNodeId}
              onOpenChange={setSiteCameraOpen}
              open={siteCameraOpen}
            />
          </motion.div>
        )}

        <motion.div
          className={cn('flex min-h-0 flex-1 flex-col', phase === 'site' && 'overflow-y-auto')}
          layout
        >
          {/* When phase is site, show property line immediately under site header */}
          <AnimatePresence initial={false}>
            {phase === 'site' && (
              <motion.div
                animate={{ height: 'auto', opacity: 1 }}
                className="shrink-0 overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                layout="position"
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              >
                <PropertyLineSection />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Buildings List */}
          {buildings.length === 0 ? (
            <motion.div className="px-3 py-4 text-muted-foreground text-sm" layout="position">
              No buildings yet
            </motion.div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {buildings.map((building) => {
                const isBuildingActive =
                  (phase === 'structure' || phase === 'furnish') &&
                  selectedBuildingId === building.id

                return (
                  <BuildingItem
                    building={building}
                    buildingCameraOpen={buildingCameraOpen}
                    isBuildingActive={isBuildingActive}
                    key={building.id}
                    onDeleteAsset={onDeleteAsset}
                    onUploadAsset={onUploadAsset}
                    projectId={projectId}
                    setBuildingCameraOpen={setBuildingCameraOpen}
                  />
                )
              })}
            </div>
          )}
        </motion.div>
      </div>
    </LayoutGroup>
  )
}
