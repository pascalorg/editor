'use client'

import { Copy, Move, Trash2, Wrench } from 'lucide-react'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isNavigationItemMoveCopyOperation } from '../../lib/item-move-request'
import { cn } from '../../lib/utils'
import type { NavigationQueuedTask } from '../../store/use-navigation'
import useNavigation from '../../store/use-navigation'
import navigationVisualsStore from '../../store/use-navigation-visuals'

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

const TASK_QUEUE_LAYER_STYLE: CSSProperties = {
  bottom: '5.25rem',
  left: '50%',
  pointerEvents: 'none',
  position: 'absolute',
  transform: 'translateX(-50%)',
}

const TASK_QUEUE_ROOT_STYLE: CSSProperties = {
  inset: 0,
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 1000,
}

const TASK_QUEUE_PANEL_STYLE: CSSProperties = {
  backgroundColor: 'rgba(15, 23, 42, 0.92)',
  color: '#f8fafc',
}

function isCopyTask(task: NavigationQueuedTask) {
  if (task.kind !== 'move') {
    return false
  }

  return isNavigationItemMoveCopyOperation(task.request)
}

function getTaskMeta(task: NavigationQueuedTask) {
  if (task.kind === 'delete') {
    return {
      buttonClassName:
        'border-red-200/55 bg-red-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-red-100/80 hover:bg-red-400',
      buttonStyle: {
        backgroundColor: '#ef4444',
        borderColor: 'rgba(254, 202, 202, 0.72)',
        color: '#ffffff',
      } satisfies CSSProperties,
      icon: Trash2,
      label: 'Delete',
    }
  }

  if (task.kind === 'repair') {
    return {
      buttonClassName:
        'border-amber-100/70 bg-amber-400 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] hover:border-amber-50 hover:bg-amber-300',
      buttonStyle: {
        backgroundColor: '#fbbf24',
        borderColor: 'rgba(254, 243, 199, 0.82)',
        color: '#451a03',
      } satisfies CSSProperties,
      icon: Wrench,
      label: 'Repair',
    }
  }

  if (isCopyTask(task)) {
    return {
      buttonClassName:
        'border-green-100/70 bg-green-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-green-50 hover:bg-green-400',
      buttonStyle: {
        backgroundColor: '#22c55e',
        borderColor: 'rgba(220, 252, 231, 0.78)',
        color: '#ffffff',
      } satisfies CSSProperties,
      icon: Copy,
      label: 'Copy',
    }
  }

  return {
    buttonClassName:
      'border-sky-100/70 bg-sky-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-sky-50 hover:bg-sky-400',
    buttonStyle: {
      backgroundColor: '#0ea5e9',
      borderColor: 'rgba(224, 242, 254, 0.78)',
      color: '#ffffff',
    } satisfies CSSProperties,
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

export function NavigationTaskQueuePanel() {
  const {
    activeTaskId,
    itemMoveControllers,
    moveQueuedTask,
    removeQueuedTask,
    robotMode,
    setActiveTask,
    taskQueue,
  } = useNavigation(
    useShallow((state) => ({
      activeTaskId: state.activeTaskId,
      itemMoveControllers: state.itemMoveControllers,
      moveQueuedTask: state.moveQueuedTask,
      removeQueuedTask: state.removeQueuedTask,
      robotMode: state.robotMode,
      setActiveTask: state.setActiveTask,
      taskQueue: state.taskQueue,
    })),
  )
  const [dragState, setDragState] = useState<TaskDragState | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
  const dragStateRef = useRef<TaskDragState | null>(null)

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

  if (robotMode !== 'task') {
    return null
  }

  return (
    <div data-testid="navigation-task-queue-layer" ref={rootRef} style={TASK_QUEUE_ROOT_STYLE}>
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={TASK_QUEUE_LAYER_STYLE}>
        <div
          className="pointer-events-auto inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 overflow-x-auto rounded-[1.75rem] border border-border/70 bg-sidebar/95 px-3 py-2 shadow-[0_28px_80px_-42px_rgba(15,23,42,0.95)] backdrop-blur-xl"
          data-testid="navigation-task-queue"
          ref={panelRef}
          style={TASK_QUEUE_PANEL_STYLE}
        >
          {taskQueue.length === 0 ? (
            <div className="px-1 text-[11px] font-medium uppercase tracking-[0.22em] text-foreground/80">
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
              const { buttonClassName, buttonStyle, icon: IconComponent, label } = getTaskMeta(task)
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
                    onPointerDown={handleTaskPointerDown(task, taskQueueIndex >= 0 ? taskQueueIndex : taskIndex)}
                    ref={(node) => {
                      buttonRefs.current[task.taskId] = node
                    }}
                    style={buttonStyle}
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

      {dragState?.dragging && draggedTask && draggedTaskMeta && DraggedTaskIcon && (
        <div
          className="pointer-events-none absolute z-50"
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
              style={draggedTaskMeta.buttonStyle}
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
