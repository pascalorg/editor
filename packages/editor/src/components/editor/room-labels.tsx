'use client'

import {
  type AnyNode,
  type AnyNodeId,
  area,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  polygonInteriorPoint,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type Group, Matrix4, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useRoomRecords } from '../../hooks/use-selected-room'
import { useZoneDisplayColor } from '../../hooks/use-zone-display-color'
import { getAreaUnitLabel, type LinearUnit, squareMetersToAreaUnit } from '../../lib/measurements'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import {
  clickZoneArea,
  hoverZoneArea,
  leaveZoneArea,
  zoneKindLabel,
} from '../../lib/room-zone-routing'
import { selectionModifiersFromEvent } from '../../lib/selection-routing'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'

const CONTEXT_TYPES = new Set(['site', 'building', 'level'])

export type RoomLabelVisibilityState = {
  phase: string
  mode: string
  scopeIdle: boolean
  room: unknown
  selectedTypes: readonly (string | undefined)[]
  zoneId: string | null
  focusedUnitId: string | null
  isCaptureMode: boolean
  isThumbnailCapture: boolean
}

/**
 * Room pills are the resting view of a level: inside the building, select tool
 * idle, and nothing picked but the site, building or level itself. Anything
 * selected, a unit being arranged, or a gesture in flight takes them away.
 */
export function roomLabelsVisible(state: RoomLabelVisibilityState): boolean {
  return (
    state.phase === 'building' &&
    state.mode === 'select' &&
    state.scopeIdle &&
    !state.room &&
    !state.zoneId &&
    !state.focusedUnitId &&
    !state.isCaptureMode &&
    !state.isThumbnailCapture &&
    state.selectedTypes.every((type) => type !== undefined && CONTEXT_TYPES.has(type))
  )
}

export function formatRoomArea(squareMeters: number, unit: LinearUnit): string {
  return `${squareMetersToAreaUnit(squareMeters, unit).toFixed(1)} ${getAreaUnitLabel(unit)}`
}

function useRoomLabelsVisible() {
  const [isThumbnailCapture, setThumbnailCapture] = useState(false)
  useEffect(() => {
    const hide = () => setThumbnailCapture(true)
    const restore = () => setThumbnailCapture(false)
    emitter.on('thumbnail:before-capture', hide)
    emitter.on('thumbnail:after-capture', restore)
    return () => {
      emitter.off('thumbnail:before-capture', hide)
      emitter.off('thumbnail:after-capture', restore)
    }
  }, [])
  const editor = useEditor(
    useShallow((s) => ({
      phase: s.phase,
      mode: s.mode,
      room: s.room,
      isCaptureMode: s.isCaptureMode,
    })),
  )
  const scopeIdle = useInteractionScope((s) => s.scope.kind === 'idle')
  const zoneId = useViewer((s) => s.selection.zoneId)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedTypes = useScene(
    useShallow((s) =>
      selectedIds.map((id) => (s.nodes[id as AnyNodeId] as AnyNode | undefined)?.type),
    ),
  )
  return roomLabelsVisible({
    ...editor,
    scopeIdle,
    zoneId,
    focusedUnitId,
    selectedTypes,
    isThumbnailCapture,
  })
}

type LabelRect = { left: number; top: number; right: number; bottom: number }
type ScreenLabel = { id: string; distance: number; rect: LabelRect }

/**
 * Which pills step aside so none overlap: nearest first, each pill that
 * overlaps one already kept is hidden. Returns the hidden ids.
 */
export function declutterLabels(labels: readonly ScreenLabel[], gap = 2): Set<string> {
  const kept: LabelRect[] = []
  const hidden = new Set<string>()
  for (const label of [...labels].sort((a, b) => a.distance - b.distance)) {
    const { rect } = label
    const overlaps = kept.some(
      (other) =>
        rect.left < other.right + gap &&
        other.left < rect.right + gap &&
        rect.top < other.bottom + gap &&
        other.top < rect.bottom + gap,
    )
    if (overlaps) hidden.add(label.id)
    else kept.push(rect)
  }
  return hidden
}

type LabelEntry = {
  zoneId: string
  polygon: [number, number][]
  holes: [number, number][][]
  area: number
}

// Mid-height of a default storey: above furniture, below the ceiling.
const LABEL_HEIGHT = DEFAULT_LEVEL_HEIGHT / 2
// The camera has to hold still this long before overlaps are re-read.
const DECLUTTER_REST_SECONDS = 0.12

const labelWorld = new Vector3()

/** The pills of one level: every detected room, and every drawn zone that bounds none. */
function useRoomLabelEntries(levelId: string | null): LabelEntry[] {
  const rooms = useRoomRecords(levelId)
  const zones = useScene(
    useShallow((s) =>
      levelId
        ? Object.values(s.nodes).filter(
            (node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId,
          )
        : [],
    ),
  )
  return useMemo(() => {
    const roomIds = new Set(rooms.map((room) => room.zoneId))
    return [
      ...rooms.map((room) => ({
        zoneId: room.zoneId,
        polygon: room.polygon,
        holes: room.holes,
        area: room.area,
      })),
      ...zones
        .filter((zone) => !roomIds.has(zone.id) && zone.polygon.length >= 3)
        .map((zone) => ({
          zoneId: zone.id,
          polygon: zone.polygon,
          holes: zone.holes ?? [],
          area: area([{ outer: zone.polygon, holes: zone.holes ?? [] }]),
        })),
    ]
  }, [rooms, zones])
}

export function applyDeclutter(elements: Iterable<HTMLElement>, labels: ScreenLabel[]) {
  const hidden = declutterLabels(labels)
  for (const element of elements) {
    const isHidden = hidden.has(element.dataset.roomLabel ?? '')
    element.style.opacity = isHidden ? '0' : ''
    element.style.pointerEvents = isHidden ? 'none' : ''
  }
}

/**
 * One room's pill: its colour, its name, its area in the active unit. Hover and
 * click take the same rule as the zone's area in the plan (`hoverZoneArea`,
 * `clickZoneArea`); only the pill itself takes the pointer.
 */
function RoomPill({
  entry,
  view,
  elements,
}: {
  entry: LabelEntry
  view: '2d' | '3d'
  elements?: Map<string, HTMLDivElement>
}) {
  const zone = useScene((s) => s.nodes[entry.zoneId as AnyNodeId] as ZoneNode | undefined)
  const color = useZoneDisplayColor(entry.zoneId)
  const unit = useViewer((s) => s.unit)
  // A pill that disappears under the cursor (its click selected something)
  // fires no leave: end the hover it set.
  useEffect(() => () => leaveZoneArea(entry.zoneId), [entry.zoneId])
  if (!zone || zone.visible === false) return null
  const hover = (event: ReactPointerEvent) =>
    hoverZoneArea(entry.zoneId, selectionModifiersFromEvent(event))
  return (
    <div
      className="pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-neutral-950/75 px-2.5 py-1 text-white text-xs shadow-sm backdrop-blur-sm transition-[opacity,background-color] hover:bg-neutral-950/90"
      data-room-label={entry.zoneId}
      data-room-label-view={view}
      onClick={(event) => {
        event.stopPropagation()
        clickZoneArea(entry.zoneId, selectionModifiersFromEvent(event))
      }}
      onPointerDown={(event) => event.stopPropagation()}
      // Move as well as enter: leaving the canvas for the pill ends the canvas
      // hover after the pill's enter has run.
      onPointerEnter={hover}
      onPointerLeave={() => leaveZoneArea(entry.zoneId)}
      onPointerMove={hover}
      ref={(element) => {
        if (element) elements?.set(entry.zoneId, element)
        else elements?.delete(entry.zoneId)
      }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium">{zone.name?.trim() || zoneKindLabel(zone)}</span>
      <span className="font-mono text-white/60 tabular-nums">
        {formatRoomArea(entry.area, unit)}
      </span>
    </div>
  )
}

/** Light name-and-area pills over each room and drawn zone of the active level. */
export function RoomLabels3D() {
  const levelId = useViewer((s) => s.selection.levelId)
  const sceneShown = useEditor((s) => s.viewMode !== '2d')
  const visible = useRoomLabelsVisible() && sceneShown
  const unit = useViewer((s) => s.unit)
  const entries = useRoomLabelEntries(visible ? levelId : null)
  const ref = useRef<Group>(null)
  const anchors = useRef(new Map<string, Vector3>())
  const elements = useRef(new Map<string, HTMLDivElement>())
  const lastCamera = useRef(new Matrix4())
  const lastProjection = useRef(new Matrix4())
  const lastLevel = useRef(new Matrix4())
  const lastSize = useRef('')
  const changedAt = useRef<number | null>(Number.NEGATIVE_INFINITY)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new set of pills re-reads overlaps.
  useEffect(() => {
    changedAt.current = Number.NEGATIVE_INFINITY
  }, [entries, unit])

  useFrame(({ camera, clock, size }) => {
    if (!(ref.current && levelId)) return
    const level = sceneRegistry.nodes.get(levelId)
    ref.current.visible = !!level
    if (!level) return
    level.updateWorldMatrix(true, false)
    ref.current.matrix.copy(level.matrixWorld)

    // Overlaps are a screen-space read: once per camera rest, not per frame.
    const now = clock.elapsedTime
    const sizeKey = `${size.width},${size.height}`
    if (
      !lastCamera.current.equals(camera.matrixWorld) ||
      !lastProjection.current.equals(camera.projectionMatrix) ||
      !lastLevel.current.equals(level.matrixWorld) ||
      lastSize.current !== sizeKey
    ) {
      lastCamera.current.copy(camera.matrixWorld)
      lastProjection.current.copy(camera.projectionMatrix)
      lastLevel.current.copy(level.matrixWorld)
      lastSize.current = sizeKey
      changedAt.current = now
      return
    }
    if (changedAt.current === null || now - changedAt.current < DECLUTTER_REST_SECONDS) return
    changedAt.current = null
    const pills = [...elements.current.values()]
    const labels: ScreenLabel[] = []
    for (const element of pills) {
      const id = element.dataset.roomLabel
      const anchor = id ? anchors.current.get(id) : undefined
      if (!(id && anchor)) continue
      labelWorld.copy(anchor).applyMatrix4(level.matrixWorld)
      labels.push({
        id,
        distance: labelWorld.distanceTo(camera.position),
        rect: element.getBoundingClientRect(),
      })
    }
    applyDeclutter(pills, labels)
  })

  if (!(visible && levelId) || entries.length === 0) return null
  return (
    <group matrixAutoUpdate={false} ref={ref}>
      {entries.map((entry) => (
        <RoomLabel3D
          anchors={anchors.current}
          elements={elements.current}
          entry={entry}
          key={entry.zoneId}
        />
      ))}
    </group>
  )
}

function RoomLabel3D({
  entry,
  anchors,
  elements,
}: {
  entry: LabelEntry
  anchors: Map<string, Vector3>
  elements: Map<string, HTMLDivElement>
}) {
  const floorY = useScene((s) => roomFloorElevation(s.nodes, entry.zoneId))
  const position = useMemo(() => {
    const [x, z] = polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes })
    return new Vector3(x, floorY + LABEL_HEIGHT, z)
  }, [entry.polygon, entry.holes, floorY])
  useEffect(() => {
    anchors.set(entry.zoneId, position)
    return () => {
      if (anchors.get(entry.zoneId) === position) anchors.delete(entry.zoneId)
    }
  }, [anchors, entry.zoneId, position])
  return (
    // The wrapper lets the canvas keep everything but the pill itself.
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
      <RoomPill elements={elements} entry={entry} view="3d" />
    </Html>
  )
}

/**
 * The same pills over the 2D plan: screen-positioned from the plan's transform,
 * re-placed only when the plan pans or zooms, decluttered once it rests
 * (bigger rooms keep theirs), and clipped to the plan's pane.
 */
export function RoomLabels2D({ levelId }: { levelId: string | null }) {
  const planShown = useEditor((s) => s.viewMode !== '3d')
  const visible = useRoomLabelsVisible() && planShown
  const entries = useRoomLabelEntries(visible ? levelId : null)
  const unit = useViewer((s) => s.unit)
  const ref = useRef<SVGGElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(new Map<string, HTMLDivElement>())
  const elementsRef = useRef(new Map<string, HTMLDivElement>())
  const anchors = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.zoneId,
          polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes }),
        ]),
      ),
    [entries],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing units resizes the pills.
  useEffect(() => {
    if (!visible || entries.length === 0) return
    let raf = 0
    let lastKey = ''
    let changedAt: number | null = Number.NEGATIVE_INFINITY
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const group = ref.current
      const svg = group?.ownerSVGElement
      const ctm = group?.getScreenCTM()
      if (!(svg && ctm)) return
      const pane = svg.getBoundingClientRect()
      const key = `${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f},${pane.left},${pane.top},${pane.width},${pane.height}`
      if (key !== lastKey) {
        lastKey = key
        changedAt = now
        if (paneRef.current) {
          Object.assign(paneRef.current.style, {
            left: `${pane.left}px`,
            top: `${pane.top}px`,
            width: `${pane.width}px`,
            height: `${pane.height}px`,
          })
        }
        const point = svg.createSVGPoint()
        for (const [id, element] of nodesRef.current) {
          const anchor = anchors.get(id)
          if (!anchor) continue
          point.x = anchor[0]
          point.y = anchor[1]
          const screen = point.matrixTransform(ctm)
          const inside =
            screen.x >= pane.left &&
            screen.x <= pane.right &&
            screen.y >= pane.top &&
            screen.y <= pane.bottom
          element.style.left = `${screen.x - pane.left}px`
          element.style.top = `${screen.y - pane.top}px`
          element.style.display = inside ? '' : 'none'
        }
        return
      }
      if (changedAt === null || now - changedAt < DECLUTTER_REST_SECONDS * 1000) return
      changedAt = null
      const elements = [...elementsRef.current.values()]
      const areas = new Map(entries.map((entry) => [entry.zoneId, entry.area]))
      applyDeclutter(
        elements,
        elements.flatMap((element) => {
          const id = element.dataset.roomLabel
          if (!id || element.parentElement?.style.display === 'none') return []
          return [{ id, distance: -(areas.get(id) ?? 0), rect: element.getBoundingClientRect() }]
        }),
      )
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, entries, anchors, unit])

  return (
    <g ref={ref}>
      {visible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed z-10 overflow-hidden" ref={paneRef}>
            {entries.map((entry) => (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                key={entry.zoneId}
                ref={(element) => {
                  if (element) nodesRef.current.set(entry.zoneId, element)
                  else nodesRef.current.delete(entry.zoneId)
                }}
                style={{ display: 'none' }}
              >
                <RoomPill elements={elementsRef.current} entry={entry} view="2d" />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </g>
  )
}
