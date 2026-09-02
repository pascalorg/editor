'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  DEFAULT_LEVEL_HEIGHT,
  getStoredLevelHeight,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ClipboardPaste, Copy, GripVertical, MoreVertical, Plus, Trash2 } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pasteSelectionAndPickUp } from '../editor/group-actions'
import {
  buildLevelDuplicateCreateOps,
  type LevelDuplicatePreset,
} from '../../lib/level-duplication'
import { getDefaultLevelName } from '@pascal-app/core'
import { deleteLevelWithFallbackSelection } from '../../lib/level-selection'
import { useTranslations } from '../../lib/i18n'
import { useLinearDisplay } from '../../lib/use-linear-display'
import { cn } from '../../lib/utils'
import { ActionButton } from './controls/action-button'
import { SliderControl } from './controls/slider-control'
import { LevelDuplicateDialog } from './level-duplicate-dialog'
import { localizedLevelName } from '../../lib/level-display'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './primitives/popover'

// ── Inline rename input for a level row ─────────────────────────────────────

function LevelInlineRename({
  level,
  isEditing,
  onStopEditing,
}: {
  level: LevelNode
  isEditing: boolean
  onStopEditing: () => void
}) {
  const updateNode = useScene((s) => s.updateNode)
  const t = useTranslations()
  const defaultName = getDefaultLevelName(level.level, t)
  const [value, setValue] = useState(level.name || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      setValue(level.name || '')
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [isEditing, level.name])

  const handleSave = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed !== level.name) {
      updateNode(level.id, { name: trimmed || undefined })
    }
    onStopEditing()
  }, [value, level.id, level.name, updateNode, onStopEditing])

  if (!isEditing) return null

  return (
    <input
      className="m-0 h-full w-full min-w-0 rounded-lg bg-transparent px-2.5 py-1.5 font-medium text-foreground text-xs outline-none ring-1 ring-primary/50"
      onBlur={handleSave}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleSave()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onStopEditing()
        }
      }}
      placeholder={defaultName}
      ref={inputRef}
      type="text"
      value={value}
    />
  )
}

// ── Level row with three-dot menu ───────────────────────────────────────────

function LevelRow({
  level,
  isSelected,
  isDragging,
  dragHandleProps,
  dragHandleRef,
  onSelect,
  onDuplicate,
  onPaste,
  onRequestDelete,
}: {
  level: LevelNode
  isSelected: boolean
  isDragging?: boolean
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>
  dragHandleRef?: (element: HTMLButtonElement | null) => void
  onSelect: () => void
  onDuplicate: (preset?: LevelDuplicatePreset) => void
  onPaste?: () => void
  onRequestDelete: () => void
}) {
  const t = useTranslations()
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const updateNode = useScene((s) => s.updateNode)
  const { isImperial, toDisplay, displayUnit } = useLinearDisplay('m', 2)

  const storeyHeight = getStoredLevelHeight(level)
  // toFixed(2) + strip one trailing zero: "2.50" → "2.5", "2.75" stays.
  const storeyHeightLabel = `${toDisplay(storeyHeight).toFixed(2).replace(/0$/, '')} ${displayUnit}`
  // Same rule as the site panel and command palette: the ordinal-0 ground
  // floor is the vertical model's zero anchor and must never be deletable.
  const canDeleteLevel = level.level !== 0

  // Clean preset values per display system; imperial stores exact meters
  // for whole-foot storey heights.
  const heightPresets = isImperial
    ? [
        { label: '8 ft', height: 2.4384 },
        { label: '9 ft', height: 2.7432 },
        { label: '10 ft', height: 3.048 },
      ]
    : [
        { label: '2.5 m', height: 2.5 },
        { label: '3.0 m', height: 3.0 },
        { label: '3.5 m', height: 3.5 },
      ]

  return (
    <div className="group/level">
      {isEditing ? (
        <LevelInlineRename
          isEditing={isEditing}
          level={level}
          onStopEditing={() => setIsEditing(false)}
        />
      ) : (
        <div
          className={cn(
            'flex items-center rounded-lg transition-colors',
            isDragging && 'bg-white/10 text-foreground shadow-lg',
            isSelected
              ? 'bg-white/10 text-foreground'
              : 'text-muted-foreground/70 hover:bg-white/5 hover:text-muted-foreground',
          )}
        >
          <button
            {...dragHandleProps}
            aria-label={t('level.reorderName', { name: localizedLevelName(level, t) })}
            className={cn(
              'ml-0.5 flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/35 opacity-0 transition-colors hover:bg-white/5 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 group-hover/level:opacity-100',
              isDragging && 'cursor-grabbing opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation()
              dragHandleProps?.onClick?.(e)
            }}
            ref={dragHandleRef}
            title={t('level.dragToReorder')}
            type="button"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          <button
            className="flex min-w-0 flex-1 items-center justify-start py-1.5 pr-2 pl-1 font-medium text-xs"
            onClick={onSelect}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}
            title={localizedLevelName(level, t)}
            type="button"
          >
            <span className="truncate">{localizedLevelName(level, t)}</span>
          </button>

          {/* Storey height badge — opens the height popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="mr-0.5 shrink-0 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground/50 tabular-nums transition-colors hover:bg-white/5 hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                title={t('level.levelHeight')}
                type="button"
              >
                {storeyHeightLabel}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-56 p-2"
              onClick={(e) => e.stopPropagation()}
              side="right"
              sideOffset={8}
            >
              <SliderControl
                label={t('level.levelHeight')}
                max={20}
                min={1}
                onChange={(v) => updateNode(level.id, { height: v })}
                precision={3}
                step={0.1}
                unit="m"
                value={Math.round(storeyHeight * 1000) / 1000}
              />
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {heightPresets.map((preset) => (
                  <ActionButton
                    className="h-7 px-2"
                    key={preset.label}
                    label={preset.label}
                    onClick={() => updateNode(level.id, { height: preset.height })}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Vertical three-dot menu — inside the pill */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-all hover:text-foreground group-hover/level:opacity-100"
                onClick={(e) => e.stopPropagation()}
                type="button"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-1" side="right" sideOffset={8}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-white/10 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate()
                }}
                type="button"
              >
                <Copy className="h-3 w-3" />
                {t('level.duplicateLevel')}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-white/10 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  setDuplicateDialogOpen(true)
                }}
                type="button"
              >
                <Copy className="h-3 w-3" />
                {t('level.duplicateOptions')}
              </button>
              {onPaste && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-white/10 hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPaste()
                  }}
                  type="button"
                >
                  <ClipboardPaste className="h-3 w-3" />
                  {t('level.pasteCopied')}
                </button>
              )}
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground text-xs transition-colors enabled:hover:bg-white/10 enabled:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canDeleteLevel}
                onClick={(e) => {
                  e.stopPropagation()
                  onRequestDelete()
                }}
                title={canDeleteLevel ? t('level.deleteLevel') : t('level.cannotDeleteGround')}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
                {t('level.deleteLevel')}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      )}
      <LevelDuplicateDialog
        level={level}
        onConfirm={(preset) => {
          onDuplicate(preset)
          setDuplicateDialogOpen(false)
        }}
        onOpenChange={setDuplicateDialogOpen}
        open={duplicateDialogOpen}
      />
    </div>
  )
}

function SortableLevelRow({
  level,
  isSelected,
  onSelect,
  onDuplicate,
  onPaste,
  onRequestDelete,
}: {
  level: LevelNode
  isSelected: boolean
  onSelect: () => void
  onDuplicate: (preset?: LevelDuplicatePreset) => void
  onPaste?: () => void
  onRequestDelete: () => void
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: level.id })

  const style: CSSProperties = {
    opacity: isDragging ? 0.86 : undefined,
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <LevelRow
        dragHandleProps={{ ...attributes, ...listeners }}
        dragHandleRef={setActivatorNodeRef}
        isDragging={isDragging}
        isSelected={isSelected}
        level={level}
        onDuplicate={onDuplicate}
        onPaste={onPaste}
        onRequestDelete={onRequestDelete}
        onSelect={onSelect}
      />
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function FloatingLevelSelector() {
  const t = useTranslations()
  const selectedBuildingId = useViewer((s) => s.selection.buildingId)
  const levelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)
  const createNode = useScene((s) => s.createNode)
  const createNodes = useScene((s) => s.createNodes)
  const updateNodes = useScene((s) => s.updateNodes)

  const [deletingLevel, setDeletingLevel] = useState<LevelNode | null>(null)
  const [draggingLevelId, setDraggingLevelId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const resolvedBuildingId = useScene((state) => {
    if (selectedBuildingId) return selectedBuildingId
    const first = Object.values(state.nodes).find((n) => n?.type === 'building') as
      | BuildingNode
      | undefined
    return first?.id ?? null
  })

  const levels = useScene(
    useShallow((state) => {
      if (!resolvedBuildingId) return [] as LevelNode[]
      const building = state.nodes[resolvedBuildingId]
      if (!building || building.type !== 'building') return [] as LevelNode[]
      return (building as BuildingNode).children
        .map((id) => state.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )

  const handleAddAbove = useCallback(() => {
    if (!resolvedBuildingId) return
    const maxLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) : -1
    const newLevel = LevelNode.parse({
      level: maxLevel + 1,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
      parentId: resolvedBuildingId,
    })
    createNode(newLevel, resolvedBuildingId)
    setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
  }, [resolvedBuildingId, levels, createNode, setSelection])

  const handleAddBelow = useCallback(() => {
    if (!resolvedBuildingId) return
    const minLevel = levels.length > 0 ? Math.min(...levels.map((l) => l.level)) : 1
    const newLevel = LevelNode.parse({
      level: minLevel - 1,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
      parentId: resolvedBuildingId,
    })
    createNode(newLevel, resolvedBuildingId)
    setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
  }, [resolvedBuildingId, levels, createNode, setSelection])

  const handleInsertBetween = useCallback(
    (lowerIndex: number) => {
      if (!resolvedBuildingId) return
      const lower = levels[lowerIndex]
      if (!lower) return

      const newLevelNumber = lower.level + 1
      const toShift = levels.filter((l) => l.level >= newLevelNumber)
      if (toShift.length > 0) {
        updateNodes(
          toShift.map((l) => ({
            id: l.id as AnyNodeId,
            data: { level: l.level + 1 } as Partial<AnyNode>,
          })),
        )
      }

      const newLevel = LevelNode.parse({
        level: newLevelNumber,
        height: DEFAULT_LEVEL_HEIGHT,
        children: [],
        parentId: resolvedBuildingId,
      })
      createNode(newLevel, resolvedBuildingId)
      setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
    },
    [resolvedBuildingId, levels, createNode, updateNodes, setSelection],
  )

  const handleConfirmDelete = useCallback(() => {
    if (!deletingLevel) return
    deleteLevelWithFallbackSelection(deletingLevel.id)
    setDeletingLevel(null)
  }, [deletingLevel])

  const handleDuplicateLevel = useCallback(
    (level: LevelNode, preset: LevelDuplicatePreset = 'everything') => {
      const { createOps, newLevelId, shiftedLevels } = buildLevelDuplicateCreateOps({
        nodes: useScene.getState().nodes,
        level,
        levels,
        preset,
      })

      if (shiftedLevels.length > 0) {
        updateNodes(
          shiftedLevels.map((shiftedLevel) => ({
            id: shiftedLevel.id as AnyNodeId,
            data: { level: shiftedLevel.level } as Partial<AnyNode>,
          })),
        )
      }
      createNodes(createOps)

      setSelection({
        buildingId: resolvedBuildingId ?? undefined,
        levelId: newLevelId as LevelNode['id'],
      })
    },
    [createNodes, levels, resolvedBuildingId, setSelection, updateNodes],
  )

  const handlePasteToLevel = useCallback((level: LevelNode) => {
    void pasteSelectionAndPickUp(level.id)
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingLevelId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingLevelId(null)

      const { active, over } = event
      if (!over || active.id === over.id) return

      const visualLevels = [...levels].reverse()
      const oldIndex = visualLevels.findIndex((level) => level.id === active.id)
      const newIndex = visualLevels.findIndex((level) => level.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reorderedVisualLevels = arrayMove(visualLevels, oldIndex, newIndex)
      const levelNumbersDescending = levels.map((level) => level.level).sort((a, b) => b - a)

      const updates = reorderedVisualLevels
        .map((level, index) => ({
          id: level.id as AnyNodeId,
          nextLevel: levelNumbersDescending[index],
          data: { level: levelNumbersDescending[index] } as Partial<AnyNode>,
        }))
        .filter(({ id, nextLevel }) => {
          const currentLevel = levels.find((level) => level.id === id)
          return currentLevel?.level !== nextLevel
        })
        .map(({ id, data }) => ({ id, data }))

      if (updates.length > 0) {
        updateNodes(updates)
      }
    },
    [levels, updateNodes],
  )

  const handleDragCancel = useCallback(() => {
    setDraggingLevelId(null)
  }, [])

  if (levels.length === 0) return null

  const reversedLevels = [...levels].reverse()
  const sortableLevelIds = reversedLevels.map((level) => level.id)

  const addButtonClass =
    'absolute left-1/2 z-10 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-border/80 bg-neutral-800 text-muted-foreground/60 shadow-md transition-colors hover:bg-neutral-700 hover:text-foreground'

  return (
    <>
      <div className="pointer-events-auto absolute top-14 left-3 z-20">
        <div className="relative">
          {/* Floating + at top edge */}
          {!draggingLevelId && (
            <button
              className={cn(addButtonClass, 'top-0 -translate-y-1/2')}
              // A stable hook for host-app onboarding to point at. Static, and
              // read only from outside: nothing here depends on it.
              data-guide-target="level-add"
              onClick={handleAddAbove}
              title={t('level.addLevelAbove')}
              type="button"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          )}

          {/* Floating + at bottom edge */}
          {!draggingLevelId && (
            <button
              className={cn(addButtonClass, 'bottom-0 translate-y-1/2')}
              onClick={handleAddBelow}
              title={t('level.addLevelBelow')}
              type="button"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          )}

          {/* Level list */}
          <DndContext
            collisionDetection={closestCenter}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext items={sortableLevelIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-background/90 p-1 shadow-2xl backdrop-blur-md">
                {reversedLevels.map((level, i) => {
                  const isSelected = level.id === levelId
                  const sortedIndex = levels.indexOf(level)
                  const showGapBelow = i < reversedLevels.length - 1

                  return (
                    <div
                      className="relative"
                      // A stable hook for host-app onboarding to point at, on
                      // the ground floor only — the one level a guide can name
                      // without knowing the building. Static, and read only
                      // from outside: nothing here depends on it.
                      data-guide-target={level.level === 0 ? 'level-ground' : undefined}
                      key={level.id}
                    >
                      <SortableLevelRow
                        isSelected={isSelected}
                        level={level}
                        onDuplicate={(preset) => handleDuplicateLevel(level, preset)}
                        onPaste={() => handlePasteToLevel(level)}
                        onRequestDelete={() => setDeletingLevel(level)}
                        onSelect={() =>
                          setSelection(
                            resolvedBuildingId
                              ? { buildingId: resolvedBuildingId, levelId: level.id }
                              : { levelId: level.id },
                          )
                        }
                      />

                      {showGapBelow && !draggingLevelId && (
                        <button
                          className={cn(addButtonClass, 'bottom-0 translate-y-1/2')}
                          onClick={() => handleInsertBetween(sortedIndex - 1)}
                          title={t('level.insertLevelHere')}
                          type="button"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog onOpenChange={(open) => !open && setDeletingLevel(null)} open={!!deletingLevel}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('level.deleteLevelTitle')}</DialogTitle>
            <DialogDescription>
              {t('level.confirmDelete', { name: deletingLevel ? localizedLevelName(deletingLevel, t) : '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
              onClick={() => setDeletingLevel(null)}
              type="button"
            >
              {t('common.cancel')}
            </button>
            <button
              className="rounded-full bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
              onClick={handleConfirmDelete}
              type="button"
            >
              {t('common.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
