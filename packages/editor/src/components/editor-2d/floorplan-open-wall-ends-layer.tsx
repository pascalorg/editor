'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  findOpenWallEnds,
  type LevelNode,
  type OpenWallEnd,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Link2 } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  collapseMutualOpenWallEnds,
  joinOpenWallEnd,
  openWallEndKey,
  openWallEndLabel,
  openWallEndsSummary,
  visibleOpenWallEnds,
} from '../../lib/floorplan/open-wall-ends'
import { MEASUREMENT_DANGLING_COLOR } from '../../lib/measurements'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanRender } from './floorplan-render-context'
import { resolveFloorplanLabelAngle } from './renderers/floorplan-label-angle'

type Boundary = Extract<AnyNode, { type: 'wall' | 'separator' }>

const HOVER_RELEASE_MS = 250

function useLevelBoundaries(levelId: LevelNode['id'] | null): Boundary[] {
  return useScene(
    useShallow((state) => {
      const level = levelId ? state.nodes[levelId] : undefined
      if (level?.type !== 'level') return [] as Boundary[]
      return level.children
        .map((id) => state.nodes[id])
        .filter((node): node is Boundary => node?.type === 'wall' || node?.type === 'separator')
    }),
  )
}

function sceneScreenPoint(point: [number, number]): { left: number; top: number } | null {
  const scene = document.querySelector<SVGGElement>('[data-floorplan-scene]')
  const svg = scene?.ownerSVGElement
  const ctm = scene?.getScreenCTM()
  if (!(svg && ctm)) return null
  const screen = new DOMPoint(point[0], point[1]).matrixTransform(ctm)
  return { left: screen.x, top: screen.y }
}

/**
 * Shows where walls look joined but are not, so a room can't close: a red dot
 * on each open end, a dashed line to the wall it nearly meets with what is
 * wrong ("4 cm gap"), and the walls that bound no room dimmed. Hover or click a
 * dot for "Join walls", which applies core's join planner as one undo step.
 *
 * On while walls or rooms are being drawn (the wall tool's variants, Divide);
 * otherwise only when a wall that bounds no room has a near miss.
 */
export const FloorplanOpenWallEndsLayer = memo(function FloorplanOpenWallEndsLayer() {
  const visible = useEditor((state) => state.viewMode !== '3d')
  const suppressed = useInteractionScope(
    (state) =>
      state.scope.kind === 'moving' ||
      state.scope.kind === 'placing' ||
      state.scope.kind === 'reshaping' ||
      state.scope.kind === 'handle-drag',
  )
  return visible && !suppressed ? <ActiveOpenWallEndsLayer /> : null
})

const ActiveOpenWallEndsLayer = memo(function ActiveOpenWallEndsLayer() {
  const levelId = useViewer((state) => state.selection.levelId) as LevelNode['id'] | null
  const unit = useViewer((state) => state.unit)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const spaces = useEditor(
    useShallow((state) => Object.values(state.spaces).filter((space) => space.levelId === levelId)),
  )
  const isDividing = useInteractionScope((state) => state.scope.kind === 'room-divide')
  const dividingDraft = useInteractionScope(
    (state) => state.scope.kind === 'room-divide' && state.scope.points.length > 0,
  )
  const wallDrafting = useFloorplanDraftPreview(
    (state) =>
      state.wallDraftStart !== null ||
      state.wallRectangleDraftStart !== null ||
      state.wallPolygonDraftPoints.length > 0,
  )
  const renderContext = useFloorplanRender()
  const boundaries = useLevelBoundaries(levelId)

  const drafting = wallDrafting || dividingDraft
  const drawing = (mode === 'build' && tool === 'wall') || isDividing
  const roomWallIds = useMemo(() => {
    const ids = new Set<string>()
    for (const space of spaces) {
      for (const wallId of space.wallIds) ids.add(wallId)
    }
    return ids
  }, [spaces])
  const roomlessWallIds = useMemo(
    () =>
      boundaries
        .filter((node) => node.type === 'wall' && !roomWallIds.has(node.id))
        .map((node) => node.id),
    [boundaries, roomWallIds],
  )
  const hasWalls = boundaries.some((node) => node.type === 'wall')
  const shouldAnalyse = !!levelId && hasWalls && (drawing || roomlessWallIds.length > 0)
  // `boundaries` changes identity only when a wall or separator on this level
  // changes, so the room-graph pass runs once per wall edit, never per frame.
  const openEnds = useMemo(
    () =>
      shouldAnalyse && levelId
        ? findOpenWallEnds(Object.fromEntries(boundaries.map((node) => [node.id, node])), levelId)
        : [],
    [shouldAnalyse, levelId, boundaries],
  )
  const visibleEnds = useMemo(() => {
    const walls = new Map(boundaries.map((node) => [node.id as string, node]))
    return collapseMutualOpenWallEnds(
      visibleOpenWallEnds(openEnds, roomWallIds, drawing),
      (wallId) => {
        const wall = walls.get(wallId)
        return wall?.type === 'wall'
          ? [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
          : null
      },
    )
  }, [openEnds, roomWallIds, drawing, boundaries])

  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null)
  const [showCursor, setShowCursor] = useState(0)
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const keepHover = (key: string) => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current)
    releaseTimer.current = null
    setHoveredKey(key)
  }
  const releaseHover = () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current)
    releaseTimer.current = setTimeout(() => setHoveredKey(null), HOVER_RELEASE_MS)
  }
  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current)
    },
    [],
  )

  const shown = drawing || visibleEnds.length > 0
  const activeKey = pinnedKey ?? hoveredKey
  const activeEnd =
    shown && !drafting
      ? (visibleEnds.find((end) => openWallEndKey(end) === activeKey) ?? null)
      : null

  // A pinned pill closes on any press outside it or its dot.
  useEffect(() => {
    if (!pinnedKey) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-open-wall-end]')) return
      setPinnedKey(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [pinnedKey])

  useEffect(() => {
    if (!activeEnd) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (releaseTimer.current) clearTimeout(releaseTimer.current)
      releaseTimer.current = null
      setPinnedKey(null)
      setHoveredKey(null)
      setRefusal(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeEnd])

  if (!shown) return null

  const unitsPerPixel = Math.max(renderContext?.unitsPerPixel ?? 0.01, 1e-6)
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0
  const joinable = visibleEnds.filter((end) => end.candidate)
  const summary = openWallEndsSummary(joinable.length)
  const showNext = () => {
    const target = joinable[showCursor % joinable.length]
    if (!target) return
    setShowCursor((cursor) => cursor + 1)
    setPinnedKey(openWallEndKey(target))
    emitter.emit('camera-controls:focus', { nodeId: target.wallId as AnyNodeId })
  }

  return (
    <g data-open-wall-ends-layer="">
      {roomlessWallIds.length > 0 ? (
        <style>
          {`${roomlessWallIds
            .map(
              (id) =>
                `[data-floorplan-scene] .floorplan-registry-entry[data-node-id="${CSS.escape(id)}"]`,
            )
            .join(',')}{opacity:0.4}`}
        </style>
      ) : null}
      {visibleEnds.map((end) => {
        const key = openWallEndKey(end)
        return (
          <OpenWallEndMarker
            active={key === activeKey}
            end={end}
            interactive={!!end.candidate && !drafting}
            key={key}
            label={openWallEndLabel(end, unit)}
            onHoverEnd={releaseHover}
            onHoverStart={() => keepHover(key)}
            onPin={() => setPinnedKey((current) => (current === key ? null : key))}
            sceneRotationDeg={sceneRotationDeg}
            unitsPerPixel={unitsPerPixel}
          />
        )
      })}
      {activeEnd?.candidate ? (
        <JoinWallsPill
          end={activeEnd}
          onHoverEnd={releaseHover}
          onHoverStart={() => keepHover(openWallEndKey(activeEnd))}
          onJoin={() => {
            const key = openWallEndKey(activeEnd)
            const message = joinOpenWallEnd(activeEnd)
            setRefusal(message ? { key, message } : null)
            if (!message) {
              sfxEmitter.emit('sfx:structure-build')
              setPinnedKey(null)
              setHoveredKey(null)
            }
          }}
          refusal={refusal?.key === openWallEndKey(activeEnd) ? refusal.message : null}
        />
      ) : null}
      {summary ? <OpenWallEndsHint onShow={showNext} summary={summary} /> : null}
    </g>
  )
})

function OpenWallEndMarker({
  active,
  end,
  label,
  interactive,
  onHoverEnd,
  onHoverStart,
  onPin,
  sceneRotationDeg,
  unitsPerPixel: upp,
}: {
  active: boolean
  end: OpenWallEnd
  label: string | null
  interactive: boolean
  onHoverEnd: () => void
  onHoverStart: () => void
  onPin: () => void
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const [x, z] = end.point
  const candidate = end.candidate
  const labelAnchor = candidate
    ? [(x + candidate.point[0]) / 2, (z + candidate.point[1]) / 2]
    : [x, z]
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return (
    <g>
      {candidate ? (
        <>
          <line
            pointerEvents="none"
            stroke={MEASUREMENT_DANGLING_COLOR}
            strokeDasharray={`${4 * upp} ${3 * upp}`}
            strokeLinecap="round"
            strokeWidth={1.5 * upp}
            x1={x}
            x2={candidate.point[0]}
            y1={z}
            y2={candidate.point[1]}
          />
          <circle
            cx={candidate.point[0]}
            cy={candidate.point[1]}
            fill="none"
            pointerEvents="none"
            r={3.5 * upp}
            stroke={MEASUREMENT_DANGLING_COLOR}
            strokeWidth={1.5 * upp}
          />
        </>
      ) : null}
      <circle
        cx={x}
        cy={z}
        fill={MEASUREMENT_DANGLING_COLOR}
        pointerEvents="none"
        r={(active ? 6.5 : 5) * upp}
        stroke="#ffffff"
        strokeWidth={1.5 * upp}
      />
      {/* Hit target larger than the dot so it is easy to catch at any zoom. */}
      <circle
        aria-label={label ?? 'Wall end not joined'}
        cx={x}
        cy={z}
        data-open-wall-end=""
        fill="transparent"
        onClick={(event) => {
          event.stopPropagation()
          onPin()
        }}
        onPointerDown={stop}
        onPointerEnter={interactive ? onHoverStart : undefined}
        onPointerLeave={interactive ? onHoverEnd : undefined}
        onPointerUp={stop}
        pointerEvents={interactive ? 'all' : 'none'}
        r={11 * upp}
        role="button"
        style={{ cursor: 'pointer' }}
      />
      {label ? (
        <OpenWallEndLabel
          point={labelAnchor as [number, number]}
          sceneRotationDeg={sceneRotationDeg}
          text={label}
          unitsPerPixel={upp}
        />
      ) : null}
    </g>
  )
}

function OpenWallEndLabel({
  point,
  sceneRotationDeg,
  text,
  unitsPerPixel: upp,
}: {
  point: [number, number]
  sceneRotationDeg: number
  text: string
  unitsPerPixel: number
}) {
  const fontSize = 10 * upp
  const padX = 6 * upp
  const width = text.length * 5.6 * upp + padX * 2
  const height = fontSize + 6 * upp
  const angle = resolveFloorplanLabelAngle(0, sceneRotationDeg, true)
  return (
    <g
      pointerEvents="none"
      transform={`translate(${point[0]} ${point[1]}) rotate(${angle}) translate(0 ${-18 * upp})`}
    >
      <rect
        fill="#ffffff"
        height={height}
        opacity={0.94}
        rx={height / 2}
        stroke={MEASUREMENT_DANGLING_COLOR}
        strokeWidth={0.75 * upp}
        width={width}
        x={-width / 2}
        y={-height / 2}
      />
      <text
        dominantBaseline="middle"
        fill={MEASUREMENT_DANGLING_COLOR}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={fontSize}
        fontWeight="600"
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  )
}

function JoinWallsPill({
  end,
  onHoverEnd,
  onHoverStart,
  onJoin,
  refusal,
}: {
  end: OpenWallEnd
  onHoverEnd: () => void
  onHoverStart: () => void
  onJoin: () => void
  refusal: string | null
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Follows pan / zoom: the scene group's screen transform changes without a
  // React render, so track it per frame while the pill is up.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const next = sceneScreenPoint(end.point)
      setPosition((current) =>
        current && next && current.left === next.left && current.top === next.top ? current : next,
      )
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [end.point])

  if (!position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-30 flex w-max flex-col items-center"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 40px))',
      }}
    >
      <div
        className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-background/95 p-1 text-xs shadow-xl backdrop-blur-md"
        data-open-wall-end=""
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={onHoverStart}
        onPointerLeave={onHoverEnd}
        onPointerUp={(event) => event.stopPropagation()}
      >
        {refusal ? <span className="px-2 text-muted-foreground">{refusal}</span> : null}
        <button
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation()
            onJoin()
          }}
          type="button"
        >
          <Link2 className="h-3.5 w-3.5" />
          Join walls
        </button>
      </div>
    </div>,
    document.body,
  )
}

// The floor plan slides in and out without resizing, so its box is read per
// frame while the hint is up, like the pill's anchor.
function useFloorplanTopCenter(): { left: number; top: number } | null {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const svg = document.querySelector<SVGGElement>('[data-floorplan-scene]')?.ownerSVGElement
      const rect = svg?.getBoundingClientRect()
      const next =
        rect && rect.width > 0 ? { left: rect.left + rect.width / 2, top: rect.top } : null
      setAnchor((current) =>
        current && next && current.left === next.left && current.top === next.top ? current : next,
      )
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return anchor
}

/** "2 wall ends aren't joined — rooms can't close", with a Show that walks the ends one by one. */
function OpenWallEndsHint({ onShow, summary }: { onShow: () => void; summary: string }) {
  const anchor = useFloorplanTopCenter()
  if (!anchor) return null
  return createPortal(
    <div
      className="pointer-events-auto fixed z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-lg backdrop-blur-md"
      data-open-wall-end=""
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      style={{ left: anchor.left, top: anchor.top + 16 }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: MEASUREMENT_DANGLING_COLOR }}
      />
      <span className="text-foreground">{summary}</span>
      <button
        className="rounded-full px-3 py-1 font-medium text-foreground transition-colors hover:bg-accent"
        onClick={(event) => {
          event.stopPropagation()
          onShow()
        }}
        type="button"
      >
        Show
      </button>
    </div>,
    document.body,
  )
}
