'use client'

import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Bot, Copy, Move, Power, Shield, Trash2, Wrench } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import type { NavigationQueuedTask, NavigationRobotModel } from '../../../store/use-navigation'
import useNavigation from '../../../store/use-navigation'
import navigationVisualsStore from '../../../store/use-navigation-visuals'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

const PANEL_BUTTON_CLASS =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45'

const ROBOT_MODEL_LABELS: Record<NavigationRobotModel, string> = {
  armored: 'Armored robot',
  pascal: 'Pascal robot',
}

type TaskDragState = {
  clientX: number
  clientY: number
  dragging: boolean
  dropIndex: number
  overPanel: boolean
  pointerId: number
  startClientX: number
  startClientY: number
  taskId: string
}

type TaskQueueRenderEntry =
  | {
      key: string
      task: NavigationQueuedTask
      type: 'task'
    }
  | {
      key: string
      type: 'placeholder'
    }

function isCopyTask(task: NavigationQueuedTask) {
  if (task.kind !== 'move') {
    return false
  }

  return Boolean(task.request.visualItemId && task.request.visualItemId !== task.request.itemId)
}

function getTaskMeta(task: NavigationQueuedTask) {
  if (task.kind === 'delete') {
    return {
      buttonClassName:
        'border-red-200/55 bg-red-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-red-100/80 hover:bg-red-400',
      icon: Trash2,
      label: 'Delete',
    }
  }

  if (task.kind === 'repair') {
    return {
      buttonClassName:
        'border-amber-100/70 bg-amber-400 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] hover:border-amber-50 hover:bg-amber-300',
      icon: Wrench,
      label: 'Repair',
    }
  }

  if (isCopyTask(task)) {
    return {
      buttonClassName:
        'border-green-100/70 bg-green-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-green-50 hover:bg-green-400',
      icon: Copy,
      label: 'Copy',
    }
  }

  return {
    buttonClassName:
      'border-sky-100/70 bg-sky-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-sky-50 hover:bg-sky-400',
    icon: Move,
    label: 'Move',
  }
}

function reorderTaskQueuePreview(
  taskQueue: NavigationQueuedTask[],
  taskId: string,
  dropIndex: number,
): NavigationQueuedTask[] {
  const sourceIndex = taskQueue.findIndex((task) => task.taskId === taskId)
  if (sourceIndex < 0) {
    return taskQueue
  }

  const draggedTask = taskQueue[sourceIndex]
  if (!draggedTask) {
    return taskQueue
  }

  const nextTaskQueue = taskQueue.filter((task) => task.taskId !== taskId)
  const normalizedDropIndex = Math.min(Math.max(dropIndex, 0), nextTaskQueue.length)
  nextTaskQueue.splice(normalizedDropIndex, 0, draggedTask)
  return nextTaskQueue
}

function getTaskQueueRenderEntries(taskQueue: NavigationQueuedTask[], dragState: TaskDragState | null) {
  if (!(dragState?.dragging)) {
    return taskQueue.map(
      (task): TaskQueueRenderEntry => ({
        key: task.taskId,
        task,
        type: 'task',
      }),
    )
  }

  const queueWithoutDraggedTask = taskQueue.filter((task) => task.taskId !== dragState.taskId)
  const normalizedDropIndex = Math.min(Math.max(dragState.dropIndex, 0), queueWithoutDraggedTask.length)
  const entries: TaskQueueRenderEntry[] = queueWithoutDraggedTask.map((task) => ({
    key: task.taskId,
    task,
    type: 'task',
  }))
  entries.splice(normalizedDropIndex, 0, {
    key: `placeholder-${dragState.taskId}-${normalizedDropIndex}`,
    type: 'placeholder',
  })
  return entries
}

function getTaskDropIndex(
  taskQueue: NavigationQueuedTask[],
  taskId: string,
  clientX: number,
  buttonRefs: Partial<Record<string, HTMLButtonElement | null>>,
) {
  const nextTaskQueue = taskQueue.filter((task) => task.taskId !== taskId)
  for (let taskIndex = 0; taskIndex < nextTaskQueue.length; taskIndex += 1) {
    const currentTask = nextTaskQueue[taskIndex]
    if (!currentTask) {
      continue
    }

    const button = buttonRefs[currentTask.taskId]
    if (!button) {
      continue
    }

    const bounds = button.getBoundingClientRect()
    if (clientX < bounds.left + bounds.width / 2) {
      return taskIndex
    }
  }

  return nextTaskQueue.length
}

export function NavigationPanel() {
  const {
    setEditingHole,
    setFloorplanSelectionTool,
    setMode,
    setSelectedReferenceId,
    setTool,
  } = useEditor(
    useShallow((state) => ({
      setEditingHole: state.setEditingHole,
      setFloorplanSelectionTool: state.setFloorplanSelectionTool,
      setMode: state.setMode,
      setSelectedReferenceId: state.setSelectedReferenceId,
      setTool: state.setTool,
    })),
  )
  const {
    activeTaskId,
    itemMoveControllers,
    moveQueuedTask,
    removeQueuedTask,
    robotModel,
    robotMode,
    setActiveTask,
    setRobotModel,
    setRobotMode,
    taskQueue,
  } = useNavigation(
    useShallow((state) => ({
      activeTaskId: state.activeTaskId,
      itemMoveControllers: state.itemMoveControllers,
      moveQueuedTask: state.moveQueuedTask,
      removeQueuedTask: state.removeQueuedTask,
      robotModel: state.robotModel,
      robotMode: state.robotMode,
      setActiveTask: state.setActiveTask,
      setRobotModel: state.setRobotModel,
      setRobotMode: state.setRobotMode,
      taskQueue: state.taskQueue,
    })),
  )
  const setSelection = useViewer((state) => state.setSelection)
  const [dragState, setDragState] = useState<TaskDragState | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
  const dragStateRef = useRef<TaskDragState | null>(null)

  const clearViewerSelectionState = () => {
    const viewerState = useViewer.getState()
    viewerState.setHoveredId(null)
    viewerState.setPreviewSelectedIds([])
    viewerState.setSelection({ selectedIds: [], zoneId: null })
    viewerState.outliner.selectedObjects.length = 0
    viewerState.outliner.hoveredObjects.length = 0
  }

  const handleRobotOff = () => {
    emitter.emit('tool:cancel')
    clearViewerSelectionState()
    setEditingHole(null)
    setFloorplanSelectionTool('click')
    setMode('select')
    setSelectedReferenceId(null)
    setSelection({ selectedIds: [], zoneId: null })
    setTool(null)
    setRobotMode(null)
  }

  const handleRemoveTask = (task: NavigationQueuedTask) => {
    if (task.kind === 'move') {
      itemMoveControllers[task.request.itemId]?.cancel()
    } else if (task.kind === 'delete') {
      navigationVisualsStore.getState().clearItemDelete(task.request.itemId)
    }

    removeQueuedTask(task.taskId)
  }

  const taskQueueRenderEntries = useMemo(
    () => getTaskQueueRenderEntries(taskQueue, dragState),
    [dragState, taskQueue],
  )
  const draggedTask = useMemo(
    () => taskQueue.find((task) => task.taskId === dragState?.taskId) ?? null,
    [dragState?.taskId, taskQueue],
  )
  const draggedTaskMeta = useMemo(
    () => (draggedTask ? getTaskMeta(draggedTask) : null),
    [draggedTask],
  )
  const DraggedTaskIcon = draggedTaskMeta?.icon ?? null
  const dragLayerBounds = rootRef.current?.getBoundingClientRect() ?? null

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  useEffect(() => {
    if (!dragState) {
      return
    }

    if (!taskQueue.some((task) => task.taskId === dragState.taskId)) {
      setDragState(null)
    }
  }, [dragState, taskQueue])

  useEffect(() => {
    if (!dragState) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current
      if (!currentDragState || event.pointerId !== currentDragState.pointerId) {
        return
      }

      event.preventDefault()
      const panelBounds = panelRef.current?.getBoundingClientRect() ?? null
      const overPanel = panelBounds
        ? event.clientX >= panelBounds.left &&
          event.clientX <= panelBounds.right &&
          event.clientY >= panelBounds.top &&
          event.clientY <= panelBounds.bottom
        : false
      const dragging =
        currentDragState.dragging ||
        Math.hypot(
          event.clientX - currentDragState.startClientX,
          event.clientY - currentDragState.startClientY,
        ) > 6
      const dropIndex =
        dragging && overPanel
          ? getTaskDropIndex(taskQueue, currentDragState.taskId, event.clientX, buttonRefs.current)
          : currentDragState.dropIndex
      setDragState((currentState) =>
        currentState && currentState.pointerId === event.pointerId
          ? {
              ...currentState,
              clientX: event.clientX,
              clientY: event.clientY,
              dragging,
              dropIndex,
              overPanel,
            }
          : currentState,
      )
    }

    const handlePointerEnd = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current
      if (!currentDragState || event.pointerId !== currentDragState.pointerId) {
        return
      }

      const currentTask = taskQueue.find((task) => task.taskId === currentDragState.taskId) ?? null
      if (!currentTask) {
        setDragState(null)
        return
      }

      if (!currentDragState.dragging) {
        setActiveTask(currentDragState.taskId)
        setDragState(null)
        return
      }

      if (!currentDragState.overPanel) {
        handleRemoveTask(currentTask)
        setDragState(null)
        return
      }

      const previewQueue = reorderTaskQueuePreview(
        taskQueue,
        currentDragState.taskId,
        currentDragState.dropIndex,
      )
      const nextTaskIndex = previewQueue.findIndex((task) => task.taskId === currentDragState.taskId)
      if (nextTaskIndex >= 0) {
        moveQueuedTask(currentDragState.taskId, nextTaskIndex)
      }
      setDragState(null)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [dragState, handleRemoveTask, moveQueuedTask, setActiveTask, taskQueue])

  const handleTaskPointerDown =
    (task: NavigationQueuedTask, taskIndex: number) =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      setDragState({
        clientX: event.clientX,
        clientY: event.clientY,
        dragging: false,
        dropIndex: taskIndex,
        overPanel: true,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        taskId: task.taskId,
      })
    }

  if (!robotMode) {
    return null
  }

  const robotTooltip =
    robotMode === 'normal' ? 'Turn robot off (manual mode).' : 'Turn robot off (task mode).'
  const nextRobotModel = robotModel === 'pascal' ? 'armored' : 'pascal'
  const RobotModelIcon = robotModel === 'pascal' ? Bot : Shield
  const modelTooltip = `${ROBOT_MODEL_LABELS[robotModel]}. Switch to ${ROBOT_MODEL_LABELS[nextRobotModel]}.`

  return (
    <div data-testid="navigation-panel" ref={rootRef}>
      <div className="pointer-events-auto fixed top-1/2 right-4 z-40 -translate-y-1/2">
        <div className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-sidebar/92 p-2 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.9)] backdrop-blur-xl">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Turn robot off"
                aria-pressed={true}
                className={cn(
                  PANEL_BUTTON_CLASS,
                  'border-red-400/50 bg-red-500/15 text-red-200 hover:border-red-300 hover:bg-red-500/20 hover:text-red-100',
                )}
                data-testid="navigation-toggle"
                onClick={handleRobotOff}
                type="button"
              >
                <Power className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{robotTooltip}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`Switch to ${ROBOT_MODEL_LABELS[nextRobotModel]}`}
                className={cn(
                  PANEL_BUTTON_CLASS,
                  robotModel === 'armored' &&
                    'border-cyan-300/50 bg-cyan-500/15 text-cyan-100 hover:border-cyan-200 hover:bg-cyan-500/20 hover:text-white',
                )}
                data-testid="navigation-robot-model-toggle"
                onClick={() => setRobotModel(nextRobotModel)}
                type="button"
              >
                <RobotModelIcon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{modelTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {robotMode === 'task' && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 sm:bottom-24">
          <div
            className="pointer-events-auto inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 overflow-x-auto rounded-[1.75rem] border border-border/50 bg-sidebar/92 px-3 py-2 shadow-[0_28px_80px_-42px_rgba(15,23,42,0.95)] backdrop-blur-xl"
            data-testid="navigation-task-queue"
            ref={panelRef}
          >
            {taskQueue.length === 0 ? (
              <div className="px-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/70">
                Ghost Queue
              </div>
            ) : (
              taskQueueRenderEntries.map((entry, taskIndex) => {
                if (entry.type === 'placeholder') {
                  return (
                    <div
                      className="h-12 w-12 flex-shrink-0 rounded-2xl border border-dashed border-white/25 bg-white/6"
                      data-testid="navigation-task-placeholder"
                      key={entry.key}
                    />
                  )
                }

                const task = entry.task
                const { buttonClassName, icon: IconComponent, label } = getTaskMeta(task)
                const active = task.taskId === activeTaskId
                const taskQueueIndex = taskQueue.findIndex((queuedTask) => queuedTask.taskId === task.taskId)
                return (
                  <div className="relative flex-shrink-0" key={task.taskId}>
                    <button
                      aria-label={label}
                      className={cn(
                        'group flex h-12 w-12 touch-none items-center justify-center rounded-2xl border transition-transform hover:-translate-y-0.5',
                        buttonClassName,
                        active && 'border-white/70 ring-2 ring-white/25',
                      )}
                      data-testid={`navigation-task-${task.kind}`}
                      onPointerDown={handleTaskPointerDown(
                        task,
                        taskQueueIndex >= 0 ? taskQueueIndex : taskIndex,
                      )}
                      ref={(node) => {
                        buttonRefs.current[task.taskId] = node
                      }}
                      title={label}
                      type="button"
                    >
                      <IconComponent className="h-5 w-5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {dragState?.dragging && draggedTask && draggedTaskMeta && DraggedTaskIcon && (
        <div
          className="pointer-events-none fixed z-50"
          data-testid="navigation-task-drag-preview"
          style={{
            left: dragState.clientX - (dragLayerBounds?.left ?? 0),
            top: dragState.clientY - (dragLayerBounds?.top ?? 0),
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="rounded-2xl shadow-[0_24px_56px_-26px_rgba(15,23,42,0.92)]">
            <button
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl border opacity-100',
                draggedTaskMeta.buttonClassName,
                !dragState.overPanel && 'scale-95 saturate-75',
              )}
              tabIndex={-1}
              type="button"
            >
              <DraggedTaskIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
