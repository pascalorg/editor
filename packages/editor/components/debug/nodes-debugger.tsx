'use client'

import { TreeViewIcon } from '@phosphor-icons/react'
import JsonView from '@uiw/react-json-view'
import { Bug, Database, Maximize2, Minimize2, TreeDeciduous } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'nodes-debugger-state'

interface DebuggerState {
  isOpen: boolean
  isMinimized: boolean
  position: { x: number; y: number }
  width: number
  height: number
  activeTab: 'scene' | 'index'
}

const DEFAULT_STATE: DebuggerState = {
  isOpen: false,
  isMinimized: false,
  position: { x: 100, y: 100 },
  width: 800,
  height: 600,
  activeTab: 'scene',
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

export function NodesDebugger() {
  const [state, setState] = useState<DebuggerState>(DEFAULT_STATE)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [pointerId, setPointerId] = useState<number | null>(null)
  const [isClient, setIsClient] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)

  // Get full scene from store
  const scene = useEditor((state) => state.scene)
  const graph = useEditor((state) => state.graph)
  const debug = useEditor((state) => state.debug)
  const setDebug = useEditor((state) => state.setDebug)

  // Load state from localStorage only on client
  useEffect(() => {
    setIsClient(true)
    setState(loadState())
  }, [])

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

  // Prepare view data
  const viewData = state.activeTab === 'scene' ? scene : Object.fromEntries(graph.index.byId)

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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <TreeViewIcon className="h-4 w-4" />
            <span className="font-semibold text-sm">Nodes Debugger</span>
          </div>

          {!state.isMinimized && (
            <div className="flex items-center rounded-md bg-muted p-0.5">
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs transition-colors',
                  state.activeTab === 'scene'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setState((prev) => ({ ...prev, activeTab: 'scene' }))}
                type="button"
              >
                <TreeDeciduous className="h-3 w-3" />
                Scene Tree
              </button>
              <button
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs transition-colors',
                  state.activeTab === 'index'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setState((prev) => ({ ...prev, activeTab: 'index' }))}
                type="button"
              >
                <Database className="h-3 w-3" />
                Node Index
              </button>
            </div>
          )}
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
        <div className="flex-1 overflow-auto bg-background p-4">
          <JsonView
            collapsed={2}
            displayDataTypes={false}
            shortenTextAfterLength={120}
            style={{
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
            }}
            value={viewData}
          />
        </div>
      )}
    </div>
  )
}
