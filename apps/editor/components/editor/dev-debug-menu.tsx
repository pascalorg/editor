'use client'

import { useViewer } from '@pascal-app/viewer'
import {
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  RotateCcw,
} from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Switch } from '@/components/ui/primitives/switch'
import { cn } from '@/lib/utils'
import useEditor from '@/store/use-editor'

const STORAGE_KEY = 'pascal-editor:dev-debug-menu-position'
const VIEWPORT_MARGIN = 16
const EDGE_DOCK_THRESHOLD = 40
const NOTCH_LENGTH = 84
const DEFAULT_MENU_SIZE = {
  width: 280,
  height: 212,
}

type Position = {
  x: number
  y: number
}

type DockSide = 'left' | 'right' | 'top' | 'bottom'

type StoredMenuState = {
  position: Position
  dockSide: DockSide | null
}

type ViewportSize = {
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const isDockSide = (value: unknown): value is DockSide =>
  value === 'left' || value === 'right' || value === 'top' || value === 'bottom'

const getDefaultPosition = (): Position => ({
  x: window.innerWidth - DEFAULT_MENU_SIZE.width - VIEWPORT_MARGIN,
  y: window.innerHeight - DEFAULT_MENU_SIZE.height - 104,
})

const readStoredState = (): StoredMenuState | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as
      | Partial<StoredMenuState>
      | (Partial<Position> & { position?: never; dockSide?: never })

    if ('x' in parsed || 'y' in parsed) {
      if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
        return null
      }

      return {
        position: {
          x: parsed.x,
          y: parsed.y,
        },
        dockSide: null,
      }
    }

    if (
      !parsed.position ||
      typeof parsed.position.x !== 'number' ||
      typeof parsed.position.y !== 'number'
    ) {
      return null
    }

    return {
      position: {
        x: parsed.position.x,
        y: parsed.position.y,
      },
      dockSide: parsed.dockSide && isDockSide(parsed.dockSide) ? parsed.dockSide : null,
    }
  } catch {
    return null
  }
}

export function DevDebugMenu() {
  const allowUndergroundCamera = useEditor((state) => state.allowUndergroundCamera)
  const setAllowUndergroundCamera = useEditor((state) => state.setAllowUndergroundCamera)
  const debugColors = useViewer((state) => state.debugColors)
  const setDebugColors = useViewer((state) => state.setDebugColors)

  const menuRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{
    pointerId: number
    offsetX: number
    offsetY: number
  } | null>(null)

  const [position, setPosition] = useState<Position>({
    x: VIEWPORT_MARGIN,
    y: VIEWPORT_MARGIN,
  })
  const [dockSide, setDockSide] = useState<DockSide | null>(null)
  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
  })
  const [isDragging, setIsDragging] = useState(false)
  const [isReady, setIsReady] = useState(false)

  const clampPosition = useCallback((candidate: Position): Position => {
    const width = menuRef.current?.offsetWidth ?? DEFAULT_MENU_SIZE.width
    const height = menuRef.current?.offsetHeight ?? DEFAULT_MENU_SIZE.height
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)

    return {
      x: clamp(candidate.x, VIEWPORT_MARGIN, maxX),
      y: clamp(candidate.y, VIEWPORT_MARGIN, maxY),
    }
  }, [])

  const getDockSideForPosition = useCallback((candidate: Position): DockSide | null => {
    const width = menuRef.current?.offsetWidth ?? DEFAULT_MENU_SIZE.width
    const height = menuRef.current?.offsetHeight ?? DEFAULT_MENU_SIZE.height

    const distances: Record<DockSide, number> = {
      left: candidate.x,
      right: window.innerWidth - (candidate.x + width),
      top: candidate.y,
      bottom: window.innerHeight - (candidate.y + height),
    }

    let nearestSide: DockSide | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const side of Object.keys(distances) as DockSide[]) {
      if (distances[side] < nearestDistance) {
        nearestDistance = distances[side]
        nearestSide = side
      }
    }

    return nearestDistance <= EDGE_DOCK_THRESHOLD ? nearestSide : null
  }, [])

  const getPositionFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, offsetX: number, offsetY: number) =>
      clampPosition({
        x: event.clientX - offsetX,
        y: event.clientY - offsetY,
      }),
    [clampPosition],
  )

  const resetPosition = useCallback(() => {
    setDockSide(null)
    setPosition(clampPosition(getDefaultPosition()))
  }, [clampPosition])

  const restoreFromDock = useCallback(() => {
    setDockSide(null)
    setPosition((current) => clampPosition(current))
  }, [clampPosition])

  const handleDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return

    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }, [])

  const handleDragMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      event.preventDefault()
      setPosition(getPositionFromPointer(event, dragState.offsetX, dragState.offsetY))
    },
    [getPositionFromPointer],
  )

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      const nextPosition = getPositionFromPointer(event, dragState.offsetX, dragState.offsetY)

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      dragStateRef.current = null
      setPosition(nextPosition)
      // Releasing close to an edge stashes the panel as a compact restore notch.
      setDockSide(getDockSideForPosition(nextPosition))
      setIsDragging(false)
    },
    [getDockSideForPosition, getPositionFromPointer],
  )

  useEffect(() => {
    const nextViewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const storedState = readStoredState() ?? {
      position: getDefaultPosition(),
      dockSide: null,
    }

    setViewport(nextViewport)
    setPosition(clampPosition(storedState.position))
    setDockSide(storedState.dockSide)
    setIsReady(true)
  }, [clampPosition])

  useEffect(() => {
    if (!isReady) return

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        position,
        dockSide,
      } satisfies StoredMenuState),
    )
  }, [dockSide, isReady, position])

  useEffect(() => {
    if (!isReady) return

    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      })
      setPosition((current) => clampPosition(current))
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [clampPosition, isReady])

  if (process.env.NODE_ENV !== 'development' || !isReady) {
    return null
  }

  const notchIcon =
    dockSide === 'left'
      ? ChevronRight
      : dockSide === 'right'
        ? ChevronLeft
        : dockSide === 'top'
          ? ChevronDown
          : ChevronUp

  const notchStyle =
    dockSide === 'left'
      ? {
          left: 0,
          top: clamp(
            position.y + (DEFAULT_MENU_SIZE.height - NOTCH_LENGTH) / 2,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, viewport.height - NOTCH_LENGTH - VIEWPORT_MARGIN),
          ),
        }
      : dockSide === 'right'
        ? {
            right: 0,
            top: clamp(
              position.y + (DEFAULT_MENU_SIZE.height - NOTCH_LENGTH) / 2,
              VIEWPORT_MARGIN,
              Math.max(VIEWPORT_MARGIN, viewport.height - NOTCH_LENGTH - VIEWPORT_MARGIN),
            ),
          }
        : dockSide === 'top'
          ? {
              top: 0,
              left: clamp(
                position.x + (DEFAULT_MENU_SIZE.width - NOTCH_LENGTH) / 2,
                VIEWPORT_MARGIN,
                Math.max(VIEWPORT_MARGIN, viewport.width - NOTCH_LENGTH - VIEWPORT_MARGIN),
              ),
            }
          : dockSide === 'bottom'
            ? {
                bottom: 0,
                left: clamp(
                  position.x + (DEFAULT_MENU_SIZE.width - NOTCH_LENGTH) / 2,
                  VIEWPORT_MARGIN,
                  Math.max(VIEWPORT_MARGIN, viewport.width - NOTCH_LENGTH - VIEWPORT_MARGIN),
                ),
              }
            : undefined

  const NotchIcon = notchIcon

  if (dockSide && notchStyle) {
    return (
      <button
        aria-label={`Restore developer debug controls from the ${dockSide} edge`}
        className={cn(
          'pointer-events-auto fixed z-70 flex items-center justify-center border border-amber-500/25 bg-background/92 text-amber-300 shadow-2xl backdrop-blur-xl transition-all hover:bg-background hover:text-amber-200',
          dockSide === 'left' &&
            'h-[84px] w-7 rounded-r-2xl border-l-0 hover:translate-x-0.5 active:translate-x-1',
          dockSide === 'right' &&
            'h-[84px] w-7 rounded-l-2xl border-r-0 hover:-translate-x-0.5 active:-translate-x-1',
          dockSide === 'top' &&
            'h-7 w-[84px] rounded-b-2xl border-t-0 hover:translate-y-0.5 active:translate-y-1',
          dockSide === 'bottom' &&
            'h-7 w-[84px] rounded-t-2xl border-b-0 hover:-translate-y-0.5 active:-translate-y-1',
        )}
        onClick={restoreFromDock}
        style={notchStyle}
        type="button"
      >
        <span
          className={cn(
            'flex items-center justify-center gap-1',
            (dockSide === 'left' || dockSide === 'right') && 'flex-col',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
          <NotchIcon className="h-4 w-4" />
        </span>
      </button>
    )
  }

  return (
    <div
      className="pointer-events-auto fixed z-70 w-[280px] select-none rounded-2xl border border-amber-500/20 bg-background/92 text-foreground shadow-2xl backdrop-blur-xl"
      ref={menuRef}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5',
          isDragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerCancel={endDrag}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={endDrag}
        style={{ touchAction: 'none' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-300">
            <Bug className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">Developer Debug</div>
            <div className="text-[11px] text-muted-foreground">Local-only debug controls</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
            Dev
          </span>
          <GripVertical className="h-4 w-4 text-muted-foreground/70" />
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Allow underground orbit</div>
            <p className="text-xs leading-5 text-muted-foreground">
              Unlock the camera below the main ground plane so you can inspect underside geometry.
            </p>
          </div>
          <Switch
            aria-label="Allow underground orbit"
            checked={allowUndergroundCamera}
            onCheckedChange={setAllowUndergroundCamera}
          />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Debug colors</div>
            <p className="text-xs leading-5 text-muted-foreground">
              Show distinct colors per material group to help identify geometry surfaces.
            </p>
          </div>
          <Switch
            aria-label="Debug colors"
            checked={debugColors}
            onCheckedChange={setDebugColors}
          />
        </div>

        <div className="flex items-end justify-between gap-3 text-[11px] text-muted-foreground">
          <div className="space-y-0.5">
            <span className="block">
              {allowUndergroundCamera ? 'Debug orbit unlocked' : 'Standard orbit clamp active'}
            </span>
            <span className="block text-[10px] text-muted-foreground/75">
              Drag this panel to any edge to stash it.
            </span>
          </div>
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            onClick={resetPosition}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}
