'use client'

import {
  containsPoint,
  emitter,
  type MultiPolygon,
  resolveCeilingHeight,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getSceneTheme, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { Pentagon, Square } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  type Camera,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
  Raycaster,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { markToolCancelConsumed } from '../../hooks/use-keyboard'
import { getRoomSelectionIndex } from '../../hooks/use-selected-room'
import { EDITOR_LAYER } from '../../lib/constants'
import {
  cancelOpeningDraft,
  openingDraftActive,
  useOpeningDraft,
} from '../../lib/floor-opening-draft'
import { clipFloorRegion, floorRegionRoomAt } from '../../lib/floor-region-geometry'
import {
  cancelFloorRegion,
  currentFloorRegionSnap,
  describeCeilingRegionRoom,
  describeFloorRegionRoom,
  dropFloorRegionDraft,
  type FloorRegionDraft,
  type FloorRegionRoom,
  finishFloorRegion,
  floorRegionDraftMessage,
  floorRegionDraftOutline,
  floorRegionEditable,
  floorRegionGesture,
  moveFloorRegion,
  pressFloorRegion,
  releaseFloorRegion,
  removeLastFloorRegionPoint,
  setFloorRegionHover,
  useFloorRegionDraft,
} from '../../lib/floor-region-session'
import { type FloorRegionPoint, snapFloorRegionPoint } from '../../lib/floor-region-snap'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { formatAreaLabel } from '../../lib/measurements'
import {
  cancelMezzanineDraft,
  mezzanineDraftActive,
  useMezzanineDraft,
} from '../../lib/mezzanine-draft'
import { usePaintRegionMode } from '../../lib/paint-region-mode'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import {
  cancelTerraceDraft,
  terraceDraftActive,
  toggleTerraceShape,
  useTerraceDraft,
} from '../../lib/terrace-draft'
import { isTypingTarget } from '../../lib/typing-target'
import useEditor from '../../store/use-editor'
import { useFloorplanRender } from '../editor-2d/floorplan-render-context'
import { usePaintTint } from '../tools/paint-region/use-paint-tint'
import { CursorSphere } from '../tools/shared/cursor-sphere'
import {
  DRAFT_LABEL_Y_OFFSET,
  DraftMeasurementLabel,
} from '../tools/shared/draft-measurement-label'
import { swallowNextClick } from './handles/use-handle-drag'
import { RoomFloorHighlight3D } from './room-floor-highlight'

// An outline on a room's floor, in 3D and on the plan: the paint tool's
// rectangle and polygon sub-modes ("Paint part of the floor"), and the armed
// "Add mezzanine" tool, which draws in its host room on the mezzanine's plane.
// The session (`floor-region-session`) owns the draft; this file turns
// pointers into plan points on a room's floor and draws the draft in the wall
// draft's colours.

const DRAFT_COLOR = '#818cf8'
const DRAFT_COLOR_LIGHT_PLAN = '#6366f1'
const INVALID_COLOR = '#ef4444'
/** How close (screen pixels) a click lands to the first point to close the polygon, in 3D and on the plan. */
const CLOSE_RADIUS_PX = 10
/** The 3D close radius (m) when the camera cannot say how big a pixel is. */
const CLOSE_RADIUS_3D_FALLBACK = 0.2
const PREVIEW_LIFT = 0.012

type FloorRegionMode = 'rectangle' | 'polygon'
type FloorRegionHit = { room: FloorRegionRoom; point: FloorRegionPoint }

function activeMode(): FloorRegionMode | null {
  if (!floorRegionEditable()) return null
  const opening = useOpeningDraft.getState()
  if (opening.host) return opening.shape
  const mezzanine = useMezzanineDraft.getState()
  if (mezzanine.host) return mezzanine.shape
  const terrace = useTerraceDraft.getState()
  if (terrace.host) return terrace.shape
  if (useEditor.getState().mode !== 'material-paint') return null
  const mode = usePaintRegionMode.getState().mode
  return mode === 'rectangle' || mode === 'polygon' ? mode : null
}

function useFloorRegionMode(): FloorRegionMode | null {
  const editorMode = useEditor((s) => s.mode)
  const regionMode = usePaintRegionMode((s) => s.mode)
  const mezzanine = useMezzanineDraft((s) => (s.host ? s.shape : null))
  const terrace = useTerraceDraft((s) => (s.host ? s.shape : null))
  const opening = useOpeningDraft((s) => (s.host ? s.shape : null))
  const readOnly = useScene((s) => s.readOnly)
  if (readOnly) return null
  if (opening) return opening
  if (mezzanine) return mezzanine
  if (terrace) return terrace
  if (editorMode !== 'material-paint') return null
  return regionMode === 'rectangle' || regionMode === 'polygon' ? regionMode : null
}

function useSceneIsDark() {
  return useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
}

// The mezzanine tool owns Escape, Backspace, Enter (and the terrace tool T) while
// armed, draft or not, so none of them reaches the selected room (Backspace
// would delete it).
function floorRegionKey(event: KeyboardEvent) {
  const draft = useFloorRegionDraft.getState().draft
  const terrace = terraceDraftActive()
  const opening = openingDraftActive()
  const mezzanine = mezzanineDraftActive() || terrace || opening
  if (!(draft || mezzanine) || event.defaultPrevented || isTypingTarget(event.target)) return
  if (event.key === 'Escape') {
    if (opening) cancelOpeningDraft()
    else if (terrace) cancelTerraceDraft()
    else if (mezzanine) cancelMezzanineDraft()
    else cancelFloorRegion()
  } else if (event.key === 'Backspace') {
    if (!(removeLastFloorRegionPoint() || mezzanine)) return
  } else if (event.key === 'Enter') {
    if (!(finishFloorRegion() || mezzanine)) return
  } else if (
    terrace &&
    (event.key === 't' || event.key === 'T') &&
    !(event.metaKey || event.ctrlKey || event.altKey)
  )
    toggleTerraceShape()
  else return
  event.preventDefault()
  event.stopPropagation()
}

// One keyboard listener per target however many surfaces bind to it (split
// view mounts the plan and the 3D controller together).
const keyboardOwners = new WeakMap<EventTarget, number>()
function acquireKeyboard(target: EventTarget) {
  const owners = keyboardOwners.get(target) ?? 0
  if (owners === 0) target.addEventListener('keydown', floorRegionKey as EventListener, true)
  keyboardOwners.set(target, owners + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (keyboardOwners.get(target) ?? 1) - 1
    keyboardOwners.set(target, left)
    if (left === 0) target.removeEventListener('keydown', floorRegionKey as EventListener, true)
  }
}

/**
 * Binds a surface to the floor region draft. `resolve` answers where the
 * pointer is on a room floor: while a draft is open, on that draft's floor;
 * otherwise the room under the pointer, or null when the floor is not what
 * the pointer is on (another agent's surface keeps the event).
 */
export function bindFloorRegionPointer(
  surface: EventTarget,
  resolve: (event: PointerEvent) => FloorRegionHit | null,
  closeRadius: () => number,
  keyboard: EventTarget = window,
) {
  let pressed: number | null = null
  const capture = surface as Element
  // Moves are coalesced to one update per animation frame; a press drops the
  // pending move and acts on its own position at once.
  let frame = 0
  let pending: PointerEvent | null = null
  const flush = () => {
    frame = 0
    const event = pending
    pending = null
    if (!(event && activeMode())) return
    const hit = resolve(event)
    const settings = currentFloorRegionSnap(event.altKey)
    const draft = useFloorRegionDraft.getState().draft
    // A refused box stays put until the next press; the marker shows meanwhile.
    if (draft && !(draft.kind === 'rectangle' && draft.refusal)) {
      setFloorRegionHover(null)
      if (hit) moveFloorRegion(hit.point, settings, closeRadius())
      return
    }
    setFloorRegionHover(
      hit
        ? {
            levelId: hit.room.levelId,
            elevation: hit.room.elevation,
            point: snapFloorRegionPoint(hit.point, settings, hit.room.targets).point,
            ...(hit.room.ceilingId ? { ceiling: true } : {}),
          }
        : null,
    )
  }
  const dropPending = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pending = null
  }
  const move = (event: PointerEvent) => {
    if (!activeMode()) return
    pending = event
    if (!frame) frame = requestAnimationFrame(flush) || 0
  }
  const down = (event: PointerEvent) => {
    const mode = activeMode()
    if (event.button !== 0 || !mode || useViewer.getState().cameraDragging) return
    const hit = resolve(event)
    if (!hit) return
    dropPending()
    event.preventDefault()
    event.stopPropagation()
    setFloorRegionHover(null)
    pressFloorRegion(mode, hit.room, hit.point, currentFloorRegionSnap(event.altKey), closeRadius())
    pressed = event.pointerId
    // A box dragged off the surface keeps following the pointer. The capture is
    // the gesture owner's: released on release, cancel or any lifecycle end.
    if ('setPointerCapture' in capture)
      floorRegionGesture()?.capturePointer(capture, event.pointerId)
  }
  const up = (event: PointerEvent) => {
    if (pressed !== event.pointerId) return
    pressed = null
    floorRegionGesture()?.releasePointer(event.pointerId)
    // The last move lands before the release, so the box ends where the pointer let go.
    if (frame) cancelAnimationFrame(frame)
    flush()
    event.preventDefault()
    event.stopPropagation()
    // The click the browser synthesizes from this release belongs to the draft:
    // it must not deselect what the commit just selected.
    swallowNextClick()
    useViewer.getState().setInputDragging(true)
    releaseFloorRegion(closeRadius())
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
  }
  // The system took the pointer (a touch turned into a scroll, a lost window):
  // a box ends uncommitted; a polygon keeps its placed points.
  const cancel = (event: PointerEvent) => {
    if (pressed !== event.pointerId) return
    pressed = null
    dropPending()
    floorRegionGesture()?.releasePointer(event.pointerId)
    if (useFloorRegionDraft.getState().draft?.kind === 'rectangle') dropFloorRegionDraft()
  }
  const leave = () => {
    const draft = useFloorRegionDraft.getState().draft
    if (!draft || (draft.kind === 'rectangle' && draft.refusal)) setFloorRegionHover(null)
  }
  const onMove = (event: Event) => move(event as PointerEvent)
  const onDown = (event: Event) => down(event as PointerEvent)
  surface.addEventListener('pointermove', onMove, true)
  surface.addEventListener('pointerdown', onDown, true)
  surface.addEventListener('pointerleave', leave)
  keyboard.addEventListener('pointerup', up as EventListener, true)
  keyboard.addEventListener('pointercancel', cancel as EventListener, true)
  const releaseKeyboard = acquireKeyboard(keyboard)
  return () => {
    dropPending()
    if (pressed !== null) floorRegionGesture()?.releasePointer(pressed)
    surface.removeEventListener('pointermove', onMove, true)
    surface.removeEventListener('pointerdown', onDown, true)
    surface.removeEventListener('pointerleave', leave)
    keyboard.removeEventListener('pointerup', up as EventListener, true)
    keyboard.removeEventListener('pointercancel', cancel as EventListener, true)
    releaseKeyboard()
  }
}

/**
 * The draft's own lifetime lives with the gesture lifecycle owner (sub-mode,
 * mode, level or selection change, its room gone, its scope replaced, any
 * history command). Here: Escape (`tool:cancel`, consumed so the paint mode
 * stays), the hover marker on a level switch, and the surface unmounting.
 */
function useFloorRegionLifetime(mode: FloorRegionMode | null) {
  useEffect(() => {
    if (!mode) setFloorRegionHover(null)
  }, [mode])
  useEffect(() => {
    const stopViewer = useViewer.subscribe((state, previous) => {
      if (state.selection.levelId !== previous.selection.levelId) setFloorRegionHover(null)
    })
    const onToolCancel = () => {
      if (terraceDraftActive()) cancelTerraceDraft()
      else if (mezzanineDraftActive()) cancelMezzanineDraft()
      else if (useFloorRegionDraft.getState().draft) cancelFloorRegion()
      else return
      markToolCancelConsumed()
    }
    emitter.on('tool:cancel', onToolCancel)
    editingSurfaces++
    return () => {
      stopViewer()
      emitter.off('tool:cancel', onToolCancel)
      cancelFloorRegion()
      setFloorRegionHover(null)
      editingSurfaces--
      // Before its first press the mezzanine tool owns no draft, only its armed
      // state and scope; the last surface going away (capture mode, the editor
      // closing) must not leave them behind.
      if (editingSurfaces === 0 && mezzanineDraftActive()) cancelMezzanineDraft()
      if (editingSurfaces === 0 && terraceDraftActive()) cancelTerraceDraft()
    }
  }, [])
}

/** The mounted 3D / 2D drawing surfaces; the mezzanine tool lives only while one is. */
let editingSurfaces = 0

/** The room whose clear floor holds `point` on `levelId`, as a draft room. */
export function resolveFloorRegionRoom(levelId: string, point: FloorRegionPoint) {
  const nodes = useScene.getState().nodes
  const record = floorRegionRoomAt(getRoomSelectionIndex(levelId).update(nodes), point, (room) =>
    roomFloorElevation(nodes, room.zoneId),
  )
  return record ? describeFloorRegionRoom(nodes, record) : null
}

// A cutaway hides walls without unregistering them, and an invisible wall must
// not answer a ray the user aimed at the floor behind it.
function visibleSurface(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent)
    if (!node.visible || node.userData.wallHidden === true) return false
  return true
}

/** Distance (level space) from `origin` to the nearest visible wall of the level along the ray. */
function nearestWallDistance(
  raycaster: Raycaster,
  level: Object3D,
  levelId: string,
  origin: Vector3,
) {
  const nodes = useScene.getState().nodes
  let nearest = Number.POSITIVE_INFINITY
  for (const id of sceneRegistry.byType.wall ?? []) {
    if (nodes[id as keyof typeof nodes]?.parentId !== levelId) continue
    const object = sceneRegistry.nodes.get(id)
    const hit = object
      ? raycaster
          .intersectObject(object, true)
          .find((candidate) => visibleSurface(candidate.object))
      : undefined
    if (!hit) continue
    nearest = Math.min(nearest, origin.distanceTo(level.worldToLocal(hit.point.clone())))
  }
  return nearest
}

const UP = new Vector3(0, 1, 0)

/**
 * The 3D pointer on a room floor. With a draft open (or the mezzanine tool
 * armed), the ray meets that room's plane whatever stands in front of it.
 * Otherwise it meets each room's floor plane (at its own elevation); the
 * nearest landing inside a room's clear floor wins, unless a visible wall of
 * the level is nearer along the ray — then the wall's paint gesture owns the
 * press.
 */
function resolveFloorRegion3D(
  event: PointerEvent,
  element: HTMLElement,
  camera: Camera,
): FloorRegionHit | null {
  const draft = useFloorRegionDraft.getState().draft
  const fixed =
    draft?.room ??
    useOpeningDraft.getState().host ??
    useMezzanineDraft.getState().host ??
    useTerraceDraft.getState().host
  const levelId = fixed?.levelId ?? useViewer.getState().selection.levelId
  const level = levelId ? sceneRegistry.nodes.get(levelId) : null
  if (!(levelId && level)) return null
  level.updateWorldMatrix(true, false)
  const bounds = element.getBoundingClientRect()
  const raycaster = new Raycaster()
  raycaster.setFromCamera(
    new Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    ),
    camera,
  )
  setSurfaceRaycastLayers(raycaster.layers)
  const ray = raycaster.ray.clone().applyMatrix4(new Matrix4().copy(level.matrixWorld).invert())
  const onFloor = (elevation: number) =>
    ray.intersectPlane(new Plane(UP, -elevation), new Vector3())
  if (fixed) {
    const hit = onFloor(fixed.elevation)
    return hit ? { room: fixed, point: [hit.x, hit.z] } : null
  }
  const nodes = useScene.getState().nodes
  let best: {
    room: () => FloorRegionRoom
    point: FloorRegionPoint
    distance: number
  } | null = null
  for (const record of getRoomSelectionIndex(levelId).update(nodes)) {
    const hit = onFloor(roomFloorElevation(nodes, record.zoneId))
    if (!hit) continue
    const point: FloorRegionPoint = [hit.x, hit.z]
    if (!containsPoint(record.clearPolygon, point)) continue
    const distance = ray.origin.distanceTo(hit)
    if (!best || distance < best.distance)
      best = { room: () => describeFloorRegionRoom(nodes, record), point, distance }
  }
  // Painting also draws on a ceiling seen from below: its underside, where it draws.
  if (useEditor.getState().mode === 'material-paint' && ray.direction.y > 1e-6)
    for (const id of sceneRegistry.byType.ceiling ?? []) {
      const ceiling = nodes[id as keyof typeof nodes]
      if (ceiling?.type !== 'ceiling' || ceiling.parentId !== levelId) continue
      const object = sceneRegistry.nodes.get(id)
      if (!(object && visibleSurface(object))) continue
      const hit = onFloor(resolveCeilingHeight(ceiling, nodes) - 0.01)
      if (!hit) continue
      const point: FloorRegionPoint = [hit.x, hit.z]
      if (!containsPoint([{ outer: ceiling.polygon, holes: ceiling.holes }], point)) continue
      const distance = ray.origin.distanceTo(hit)
      if (!best || distance < best.distance)
        best = { room: () => describeCeilingRegionRoom(nodes, ceiling), point, distance }
    }
  if (!best || nearestWallDistance(raycaster, level, levelId, ray.origin) < best.distance)
    return null
  return { room: best.room(), point: best.point }
}

function ringPairs(ring: readonly FloorRegionPoint[], closed: boolean, y: number) {
  const out: number[] = []
  const count = closed ? ring.length : ring.length - 1
  for (let i = 0; i < count; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    out.push(a[0], y, a[1], b[0], y, b[1])
  }
  return out
}

function fillPositions(pieces: MultiPolygon, y: number) {
  const out: number[] = []
  for (const { outer, holes } of pieces) {
    const contour = outer.map(([x, z]) => new Vector2(x, z))
    const holeRings = holes.map((hole) => hole.map(([x, z]) => new Vector2(x, z)))
    const all = [...contour, ...holeRings.flat()]
    for (const triangle of ShapeUtils.triangulateShape(contour, holeRings))
      for (const index of triangle) out.push(all[index]!.x, y, all[index]!.y)
  }
  return out
}

function geometryOf(positions: number[]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

const noRaycast = () => {}

/** What the draft shows: its outline, the clipped pieces, the label and its colour. */
function useDraftView(draft: FloorRegionDraft | null) {
  const unit = useViewer((s) => s.unit)
  return useMemo(() => {
    if (!draft) return null
    const outline = floorRegionDraftOutline(draft)
    const clip = outline.length >= 3 ? clipFloorRegion(outline, draft.room.clear) : null
    const message = floorRegionDraftMessage(draft)
    const xs = outline.map((point) => point[0])
    const zs = outline.map((point) => point[1])
    const anchor: FloorRegionPoint | null = outline.length
      ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
      : null
    return {
      outline,
      closed: draft.kind === 'rectangle' || outline.length >= 3,
      clip,
      message,
      label: message ?? (clip ? formatAreaLabel(clip.area, unit) : null),
      anchor: message && draft.kind === 'polygon' ? (draft.cursor ?? anchor) : anchor,
      points: draft.kind === 'polygon' ? draft.points : [],
      cursor: draft.kind === 'polygon' ? draft.cursor : draft.end,
      fill: draft.room.purpose?.fill ?? null,
    }
  }, [draft, unit])
}

function FloorRegionPreview3D({ mode }: { mode: FloorRegionMode }) {
  const draft = useFloorRegionDraft((s) => s.draft)
  const hover = useFloorRegionDraft((s) => s.hover)
  const mezzanineHost = useMezzanineDraft((s) => s.host)
  const openingHost = useOpeningDraft((s) => s.host)
  const host = openingHost ?? mezzanineHost
  const view = useDraftView(draft)
  const isDark = useSceneIsDark()
  const tint = usePaintTint(DRAFT_COLOR)
  const color = view?.fill ?? tint
  const levelId = draft?.room.levelId ?? hover?.levelId ?? host?.levelId ?? null
  const elevation = draft?.room.elevation ?? hover?.elevation ?? host?.elevation ?? 0
  // A ceiling's outline hangs just under it, a floor's just over it.
  const onCeiling = !!(draft?.room.ceilingId ?? hover?.ceiling)
  const lift = elevation + (onCeiling ? -PREVIEW_LIFT : PREVIEW_LIFT)
  const root = useRef<Group>(null)
  const materials = useMemo(
    () => ({
      fill: new MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        opacity: 0.3,
        side: DoubleSide,
        transparent: true,
      }),
      line: new LineBasicNodeMaterial({ depthTest: false, depthWrite: false }),
    }),
    [],
  )
  useEffect(
    () => () => {
      materials.fill.dispose()
      materials.line.dispose()
    },
    [materials],
  )
  const invalid = !!view?.message
  useEffect(() => {
    materials.fill.color.set(color)
    materials.line.color.set(invalid ? INVALID_COLOR : DRAFT_COLOR)
  }, [materials, color, invalid])
  const geometry = useMemo(
    () =>
      view
        ? {
            fill: view.clip ? geometryOf(fillPositions(view.clip.pieces, lift)) : null,
            line: geometryOf(ringPairs(view.outline, view.closed, lift)),
          }
        : null,
    [view, lift],
  )
  useEffect(
    () => () => {
      geometry?.fill?.dispose()
      geometry?.line.dispose()
    },
    [geometry],
  )
  useFrame(() => {
    const level = levelId ? sceneRegistry.nodes.get(levelId) : null
    if (!root.current) return
    root.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      root.current.matrix.copy(level.matrixWorld)
    }
  })
  if (!levelId) return null
  const Icon = mode === 'polygon' ? Pentagon : Square
  const cursor = view?.cursor ?? (draft ? null : (hover?.point ?? null))
  return (
    <group matrixAutoUpdate={false} ref={root}>
      {/* Where a mezzanine can go: the host's clear floor on the mezzanine's
          plane, drawn over its walls like Divide's room, under the draft. */}
      {host && (
        <RoomFloorHighlight3D
          elevation={host.elevation}
          levelId={host.levelId}
          renderOrder={98}
          zoneId={host.zoneId}
        />
      )}
      {geometry?.fill && (
        <mesh
          geometry={geometry.fill}
          layers={EDITOR_LAYER}
          material={materials.fill}
          raycast={noRaycast}
          renderOrder={100}
        />
      )}
      {geometry && (
        <lineSegments
          geometry={geometry.line}
          layers={EDITOR_LAYER}
          material={materials.line}
          raycast={noRaycast}
          renderOrder={101}
        />
      )}
      {view?.points.map((point, index) => (
        <CursorSphere
          color={DRAFT_COLOR}
          height={0}
          key={index}
          position={[point[0], elevation, point[1]]}
          showTooltip={false}
        />
      ))}
      {cursor && (
        <CursorSphere
          color={invalid ? INVALID_COLOR : DRAFT_COLOR}
          height={0}
          position={[cursor[0], elevation, cursor[1]]}
          tooltipContent={<Icon className="h-5 w-5 text-white" />}
        />
      )}
      {view?.label && view.anchor && (
        <DraftMeasurementLabel
          color={invalid ? INVALID_COLOR : isDark ? '#ffffff' : '#111111'}
          label={view.label}
          position={[view.anchor[0], elevation + DRAFT_LABEL_Y_OFFSET, view.anchor[1]]}
          shadowColor={isDark ? '#111111' : '#ffffff'}
        />
      )}
    </group>
  )
}

/**
 * The 3D close radius: CLOSE_RADIUS_PX at the polygon's first point's depth,
 * so closing feels the same zoomed in or out.
 */
export function floorRegionCloseRadius3D(
  camera: Camera,
  viewportHeight: number,
  pointWorld: Vector3 | null,
): number {
  if (!(pointWorld && viewportHeight > 0)) return CLOSE_RADIUS_3D_FALLBACK
  let perPixel: number
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera
    perPixel = (ortho.top - ortho.bottom) / ortho.zoom / viewportHeight
  } else {
    const perspective = camera as PerspectiveCamera
    const distance = perspective.getWorldPosition(new Vector3()).distanceTo(pointWorld)
    perPixel = (2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) / viewportHeight
  }
  return Number.isFinite(perPixel) && perPixel > 0
    ? CLOSE_RADIUS_PX * perPixel
    : CLOSE_RADIUS_3D_FALLBACK
}

function firstPointWorld(): Vector3 | null {
  const draft = useFloorRegionDraft.getState().draft
  const first = draft?.kind === 'polygon' ? draft.points[0] : undefined
  const level = draft ? sceneRegistry.nodes.get(draft.room.levelId) : undefined
  if (!(draft && first && level)) return null
  level.updateWorldMatrix(true, false)
  return level.localToWorld(new Vector3(first[0], draft.room.elevation, first[1]))
}

export function FloorRegionControls3D() {
  const mode = useFloorRegionMode()
  const { gl, camera } = useThree()
  useFloorRegionLifetime(mode)
  useEffect(() => {
    if (!mode) return
    return bindFloorRegionPointer(
      gl.domElement,
      (event) =>
        event.target === gl.domElement ? resolveFloorRegion3D(event, gl.domElement, camera) : null,
      () =>
        floorRegionCloseRadius3D(
          camera,
          gl.domElement.getBoundingClientRect().height,
          firstPointWorld(),
        ),
    )
  }, [gl, camera, mode])
  return mode ? <FloorRegionPreview3D mode={mode} /> : null
}

/**
 * The plan pointer on a room floor of `levelId` (the draft's floor while one
 * is open, the host room while the mezzanine tool is armed).
 */
export function resolveFloorRegionPlanPoint(
  levelId: string | null,
  clientX: number,
  clientY: number,
): FloorRegionHit | null {
  const point = clientToPlan(clientX, clientY)
  if (!(point && levelId)) return null
  const plan: FloorRegionPoint = [point[0], point[1]]
  const fixed =
    useFloorRegionDraft.getState().draft?.room ??
    useOpeningDraft.getState().host ??
    useMezzanineDraft.getState().host ??
    useTerraceDraft.getState().host
  if (fixed) return fixed.levelId === levelId ? { room: fixed, point: plan } : null
  const room = resolveFloorRegionRoom(levelId, plan)
  return room ? { room, point: plan } : null
}

const MARKER_GLOW_PX = 10
const MARKER_CORE_PX = 3

function PlanMarker({ at, color, upp }: { at: FloorRegionPoint; color: string; upp: number }) {
  return (
    <>
      <circle cx={at[0]} cy={at[1]} fill={color} fillOpacity={0.25} r={MARKER_GLOW_PX * upp} />
      <circle cx={at[0]} cy={at[1]} fill={color} fillOpacity={0.9} r={MARKER_CORE_PX * upp} />
    </>
  )
}

function ringsPath(pieces: MultiPolygon) {
  return pieces
    .flatMap(({ outer, holes }) => [outer, ...holes])
    .map((ring) => `M ${ring.map((point) => point.join(' ')).join(' L ')} Z`)
    .join(' ')
}

function FloorRegionPreview2D({ levelId }: { levelId: string | null }) {
  const context = useFloorplanRender()
  const draft = useFloorRegionDraft((s) => s.draft)
  const hover = useFloorRegionDraft((s) => s.hover)
  const view = useDraftView(draft && draft.room.levelId === levelId ? draft : null)
  const isDark = useSceneIsDark()
  const upp = context?.unitsPerPixel ?? 0.01
  const outline = isDark ? DRAFT_COLOR : DRAFT_COLOR_LIGHT_PLAN
  const tint = usePaintTint(outline)
  const fill = view?.fill ?? tint
  const mezzanineHost = useMezzanineDraft((s) => (s.host?.levelId === levelId ? s.host : null))
  const openingHost = useOpeningDraft((s) => (s.host?.levelId === levelId ? s.host : null))
  const host = openingHost ?? mezzanineHost
  const hostArea = host && (
    <path
      d={ringsPath(host.clear)}
      data-mezzanine-host
      fill={outline}
      fillOpacity={0.12}
      fillRule="evenodd"
      stroke={outline}
      strokeLinejoin="round"
      strokeWidth={2 * upp}
    />
  )
  if (!view) {
    if (draft || !(hostArea || (hover && hover.levelId === levelId))) return null
    return (
      <g data-floor-region-preview pointerEvents="none">
        {hostArea}
        {hover && hover.levelId === levelId && (
          <PlanMarker at={hover.point} color={outline} upp={upp} />
        )}
      </g>
    )
  }
  const stroke = view.message ? INVALID_COLOR : outline
  const path = `M ${view.outline.map((point) => point.join(' ')).join(' L ')}${view.closed ? ' Z' : ''}`
  return (
    <g data-floor-region-preview pointerEvents="none">
      {hostArea}
      {view.clip && (
        <path d={ringsPath(view.clip.pieces)} fill={fill} fillOpacity={0.3} fillRule="evenodd" />
      )}
      {view.outline.length > 1 && (
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2 * upp}
        />
      )}
      {view.points.map((point, index) => (
        <PlanMarker at={point} color={outline} key={index} upp={upp} />
      ))}
      {view.cursor && <PlanMarker at={view.cursor} color={stroke} upp={upp} />}
      {view.label && view.anchor && (
        <g
          transform={`translate(${view.anchor[0]} ${view.anchor[1]}) rotate(${-(context?.sceneRotationDeg ?? 0)}) scale(${upp})`}
        >
          <text
            dominantBaseline="middle"
            fill={view.message ? INVALID_COLOR : (context?.palette.measurementStroke ?? outline)}
            fontSize={12}
            fontWeight={600}
            paintOrder="stroke"
            stroke={isDark ? '#0f172a' : '#ffffff'}
            strokeLinejoin="round"
            strokeWidth={3}
            textAnchor="middle"
            y={view.message ? -16 : 0}
          >
            {view.label}
          </text>
        </g>
      )}
    </g>
  )
}

export function FloorRegionControls2D({ levelId }: { levelId: string | null }) {
  const mode = useFloorRegionMode()
  const context = useFloorplanRender()
  const ref = useRef<SVGGElement>(null)
  const upp = useRef(context?.unitsPerPixel ?? 0.01)
  upp.current = context?.unitsPerPixel ?? 0.01
  useFloorRegionLifetime(mode)
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement
    if (!(svg && mode)) return
    return bindFloorRegionPointer(
      svg,
      (event) => {
        if (!(event.target instanceof Element) || event.target.closest('foreignObject')) return null
        return resolveFloorRegionPlanPoint(levelId, event.clientX, event.clientY)
      },
      () => CLOSE_RADIUS_PX * upp.current,
    )
  }, [levelId, mode])
  return <g ref={ref}>{mode && <FloorRegionPreview2D levelId={levelId} />}</g>
}
