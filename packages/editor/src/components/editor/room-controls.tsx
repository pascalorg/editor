'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_LEVEL_HEIGHT,
  deleteZone,
  emitter,
  type Point,
  type StructureNodes,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { getSceneTheme, setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { SquareSplitHorizontal } from 'lucide-react'
import Image from 'next/image'
import { type MouseEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type Camera,
  DoubleSide,
  type Group,
  Matrix4,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { markToolCancelConsumed } from '../../hooks/use-keyboard'
import { getRoomSelectionIndex } from '../../hooks/use-selected-room'
import { EDITOR_LAYER } from '../../lib/constants'
import { getFloatingMenuScale } from '../../lib/floating-menu-scale'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { formatLinearMeasurement } from '../../lib/measurements'
import { addMezzanineStairs } from '../../lib/mezzanine-stairs'
import {
  cancelRoomDivide,
  clickRoomDivide,
  finishRoomDivide,
  previewRoomDivide,
  removeLastRoomDividePoint,
  roomDivideContains,
  startRoomDivide,
} from '../../lib/room-divide-session'
import { roomFloorElevation, useRoomHandleDrag } from '../../lib/room-handle-drag'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import { requestRoomDeletion } from '../../lib/room-structure-commands'
import {
  type RoomTransformKind,
  rotateRoom,
  showRoomNotice,
  startRoomTransform,
  useRoomTransform,
} from '../../lib/room-transform-session'
import { isTypingTarget } from '../../lib/typing-target'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanRender } from '../editor-2d/floorplan-render-context'
import { CursorSphere } from '../tools/shared/cursor-sphere'
import {
  DRAFT_LABEL_Y_OFFSET,
  DraftMeasurementLabel,
} from '../tools/shared/draft-measurement-label'
import { ActionMenuButton } from './action-menu-button'
import { getMenuYOffset } from './floating-action-menu'
import { NodeActionMenu } from './node-action-menu'
import { RoomFloorHighlight3D } from './room-floor-highlight'
import { RoomHandleDragPreview3D, RoomHandles3D } from './room-handles'
import { RoomFloorHeightStepper, useRoomControls } from './room-handles-2d'
import { RoomTransformGhost2D, RoomTransformGhost3D } from './room-transform-ghost'

// The wall draft's colours: indigo while the draft is buildable, red when not.
const DRAFT_COLOR = '#818cf8'
const DRAFT_COLOR_LIGHT_PLAN = '#6366f1'
const INVALID_COLOR = '#ef4444'

type RoomDivideScope = Extract<
  ReturnType<typeof useInteractionScope.getState>['scope'],
  { kind: 'room-divide' }
>

function useSceneIsDark() {
  return useViewer((s) => getSceneTheme(s.sceneTheme).appearance === 'dark')
}

const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation()

/** What a room pick-up carries: its outline and wall footprints, and its floor height. */
export function roomTransformSource(room: RoomSelectionRecord) {
  const walls = room.boundaryWallIds.flatMap((id) => {
    const ring = room.context.wallFootprints.get(id)
    return ring ? [ring.map(([x, z]) => [x, z] as Point)] : []
  })
  return {
    zoneId: room.zoneId,
    levelId: room.key.levelId,
    outline: [room.polygon, ...room.holes].map((ring) => ring.map(([x, z]) => [x, z] as Point)),
    walls,
    floorY: roomFloorElevation(useScene.getState().nodes, room.zoneId),
  }
}

/**
 * A room's zone picked on its own (its label, the zones layer) moves and
 * duplicates as the room: the room pick-up with its real outline and walls,
 * never a zone-only drag whose preview is the zone's bounding box. False when
 * the zone bounds no room (a free-drawn zone keeps its own move).
 */
export function startZoneRoomTransform(node: AnyNode, kind: RoomTransformKind): boolean {
  if (node.type !== 'zone' || !node.parentId) return false
  const record = getRoomSelectionIndex(node.parentId)
    .update(useScene.getState().nodes)
    .find((room) => room.zoneId === node.id)
  if (!record) return false
  useEditor.getState().setStructureLayer('elements')
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  useEditor.getState().selectRoom(record.key)
  return startRoomTransform(kind, roomTransformSource(record))
}

/**
 * Why the room's trash is off, or undefined when it can be deleted: a room
 * inside walls other rooms share has nothing of its own to remove.
 */
export function roomDeleteBlockedReason(nodes: StructureNodes, zoneId: string) {
  if (nodes[zoneId]?.type !== 'zone') return undefined
  const plan = deleteZone(nodes, { zoneId, contents: 'keep' })
  return plan.payload.mode === 'blocked' ? plan.conflicts?.[0]?.message : undefined
}

/**
 * The selected room's action pill — the node action menu every selection
 * gets, in a wall pill's order: Move, Rotate left / right (the Curve slot), the room's own
 * contribution where a wall shows Split (Divide), Duplicate,
 * Delete.
 */
export function RoomActionMenu({ room }: { room: RoomSelectionRecord }) {
  const zoneId = room.zoneId
  const levelId = room.key.levelId
  const nodes = useScene((s) => s.nodes)
  const deleteBlocked = useMemo(() => roomDeleteBlockedReason(nodes, zoneId), [nodes, zoneId])
  const pickUp = (kind: 'move' | 'duplicate') => (event: MouseEvent) => {
    event.stopPropagation()
    startRoomTransform(kind, roomTransformSource(room))
  }
  // Alt-click slides a door or window the turn would cut through.
  const turn = (direction: 'left' | 'right') => (event: MouseEvent) => {
    event.stopPropagation()
    rotateRoom(room.key, direction, { force: event.altKey })
  }
  const notice = useRoomTransform((s) => (s.notice?.zoneId === zoneId ? s.notice.message : null))
  // A mezzanine moves, turns and copies inside its host (core refuses what
  // leaves it); it has no walls to divide, and it gets its own stairs.
  const mezzanine = !!room.mezzanine
  const addStairs = (placement: 'outside' | 'inside') => (event: MouseEvent) => {
    event.stopPropagation()
    const result = addMezzanineStairs(zoneId, placement)
    if (!result.ok) showRoomNotice({ zoneId, message: result.message })
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <NodeActionMenu
        deleteDisabledReason={deleteBlocked}
        deleteLabel={mezzanine ? 'Delete mezzanine' : 'Delete room'}
        onDelete={(event) => {
          event.stopPropagation()
          requestRoomDeletion(zoneId)
        }}
        onDuplicate={pickUp('duplicate')}
        onMove={pickUp('move')}
        onPointerDown={stopPointer}
        onPointerUp={stopPointer}
        onRotateLeft={turn('left')}
        onRotateRight={turn('right')}
      >
        {mezzanine &&
          (['outside', 'inside'] as const).map((placement) => (
            <ActionMenuButton
              key={placement}
              label={`Add stairs ${placement}`}
              onClick={addStairs(placement)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <Image
                  alt=""
                  className="h-4 w-4 object-contain"
                  height={16}
                  src="/icons/stairs.webp"
                  width={16}
                />
              </span>
            </ActionMenuButton>
          ))}
        {!mezzanine && (
          <ActionMenuButton
            label="Divide room"
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              startRoomDivide(zoneId, levelId)
            }}
          >
            <SquareSplitHorizontal className="h-4 w-4" />
          </ActionMenuButton>
        )}
      </NodeActionMenu>
      {notice && (
        <div
          className="pointer-events-none whitespace-nowrap rounded-full border border-destructive/40 bg-background/95 px-3 py-1 text-destructive text-xs shadow-md backdrop-blur-md"
          role="status"
        >
          {notice}
        </div>
      )}
    </div>
  )
}

/** Floats the pill above the room like `FloatingActionMenu` floats a node's. */
function RoomFloatingMenu({
  room,
  zone,
  height,
}: {
  room: RoomSelectionRecord
  zone: AnyNode
  height: number
}) {
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const anchor = useRef<Group>(null)
  const scale = useRef<HTMLDivElement>(null)
  const world = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    if (!(anchor.current && scale.current)) return
    anchor.current.getWorldPosition(world)
    scale.current.style.transform = `scale(${getFloatingMenuScale(camera, world)})`
  })
  if (zone.type !== 'zone' || !zone.seed || isFloorplanHovered) return null
  // A mezzanine's pill floats over its host's walls, not a storey above its own floor.
  const elevation = zone.floor?.support === 'open' ? 0.05 : (zone.floor?.elevation ?? 0.05)
  return (
    <group
      // Above the room's walls, as a wall's pill floats above the wall — clear
      // of the floor a second click drills into.
      position={[zone.seed[0], elevation + height + getMenuYOffset(zone), zone.seed[1]]}
      ref={anchor}
    >
      <Html center style={{ pointerEvents: 'auto', touchAction: 'none' }} zIndexRange={[25, 0]}>
        <div ref={scale} style={{ transformOrigin: 'center center' }}>
          <RoomActionMenu room={room} />
        </div>
      </Html>
    </group>
  )
}

/**
 * The 2D pill: above the room's footprint, like a slab's on the plan, with the
 * floor height stepper under it. Shown while the room is selected and the plan
 * is on screen — not only while it is hovered, so split view does not flicker.
 */
function RoomFloorplanMenu({
  room,
  plan,
}: {
  room: RoomSelectionRecord
  plan: RefObject<SVGGElement | null>
}) {
  const planShown = useEditor((s) => s.viewMode !== '3d')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const rings = room.geometry.clearPolygon
  useEffect(() => {
    if (!planShown) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const group = plan.current
      const svg = group?.ownerSVGElement
      const ctm = group?.getScreenCTM()
      if (!(svg && ctm)) return setPosition(null)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let top = Number.POSITIVE_INFINITY
      const point = svg.createSVGPoint()
      for (const { outer } of rings)
        for (const [x, y] of outer) {
          point.x = x
          point.y = y
          const screen = point.matrixTransform(ctm)
          minX = Math.min(minX, screen.x)
          maxX = Math.max(maxX, screen.x)
          top = Math.min(top, screen.y)
        }
      const next = Number.isFinite(top) ? { left: (minX + maxX) / 2, top } : null
      setPosition((prev) =>
        prev && next && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5
          ? prev
          : next,
      )
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [planShown, plan, rings])
  if (!(planShown && position) || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="pointer-events-none fixed z-30 flex w-max flex-col items-center"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 32px))',
      }}
    >
      <div className="flex flex-col items-center gap-1">
        <RoomActionMenu room={room} />
        <RoomFloorHeightStepper zoneId={room.zoneId} />
      </div>
    </div>,
    document.body,
  )
}

/**
 * Where a divide pointer landed. `boundaryId` is set when the pointer resolved
 * against a boundary's own surface rather than a free point on the floor.
 */
export type DividePointerTarget = { point: Point; boundaryId?: string }

/** Keys typed into a field never reach the Divide draft. */
export const isDivideTypingTarget = isTypingTarget

function divideKey(event: KeyboardEvent) {
  if (useInteractionScope.getState().scope.kind !== 'room-divide') return
  if (event.defaultPrevented || isDivideTypingTarget(event.target)) return
  if (event.key === 'Escape') cancelRoomDivide()
  else if (event.key === 'Backspace') removeLastRoomDividePoint()
  else if (event.key === 'Enter') finishRoomDivide()
  else return
  event.preventDefault()
  event.stopPropagation()
}

// One keyboard listener per target however many surfaces bind to it: split
// view mounts the 2D and 3D controls together, and each key must act once.
const keyboardOwners = new WeakMap<EventTarget, number>()
function acquireDivideKeyboard(target: EventTarget) {
  const owners = keyboardOwners.get(target) ?? 0
  if (owners === 0) target.addEventListener('keydown', divideKey as EventListener, true)
  keyboardOwners.set(target, owners + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (keyboardOwners.get(target) ?? 1) - 1
    keyboardOwners.set(target, left)
    if (left === 0) target.removeEventListener('keydown', divideKey as EventListener, true)
  }
}

export function bindDividePointer(
  surface: EventTarget,
  resolve: (event: PointerEvent) => DividePointerTarget | null,
  keyboard: EventTarget = window,
) {
  let pressed: number | null = null
  // Pointer moves are coalesced to one preview per animation frame; a press
  // drops the pending move and previews its own position at once.
  let frame = 0
  let pending: PointerEvent | null = null
  const flush = () => {
    frame = 0
    const event = pending
    pending = null
    if (!event || useInteractionScope.getState().scope.kind !== 'room-divide') return
    const target = resolve(event)
    if (target) previewRoomDivide(target.point, target.boundaryId)
  }
  const dropPending = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pending = null
  }
  const move = (event: PointerEvent) => {
    if (useInteractionScope.getState().scope.kind !== 'room-divide') return
    pending = event
    if (!frame) frame = requestAnimationFrame(flush) || 0
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || useInteractionScope.getState().scope.kind !== 'room-divide') return
    const target = resolve(event)
    if (!target) return
    dropPending()
    event.preventDefault()
    event.stopPropagation()
    previewRoomDivide(target.point, target.boundaryId)
    pressed = event.pointerId
  }
  const up = (event: PointerEvent) => {
    if (pressed !== event.pointerId) return
    pressed = null
    dropPending()
    event.preventDefault()
    event.stopPropagation()
    useViewer.getState().setInputDragging(true)
    clickRoomDivide()
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
  }
  const onMove = (event: Event) => move(event as PointerEvent)
  const onDown = (event: Event) => down(event as PointerEvent)
  surface.addEventListener('pointermove', onMove, true)
  surface.addEventListener('pointerdown', onDown, true)
  keyboard.addEventListener('pointerup', up as EventListener, true)
  const releaseKeyboard = acquireDivideKeyboard(keyboard)
  return () => {
    dropPending()
    surface.removeEventListener('pointermove', onMove, true)
    surface.removeEventListener('pointerdown', onDown, true)
    keyboard.removeEventListener('pointerup', up as EventListener, true)
    releaseKeyboard()
  }
}

/**
 * Escape (`tool:cancel`) ends the draft and is consumed, so the tool stays;
 * the surface unmounting ends it too. Everything else — leaving the structure
 * select tool or the room, another level, a selection change, a boundary
 * change under it, any history command — is the gesture lifecycle owner's
 * (`startRoomDivide`).
 */
export function useDivideLifetime() {
  useEffect(() => {
    const onToolCancel = () => {
      if (useInteractionScope.getState().scope.kind !== 'room-divide') return
      cancelRoomDivide()
      markToolCancelConsumed()
    }
    emitter.on('tool:cancel', onToolCancel)
    return () => {
      emitter.off('tool:cancel', onToolCancel)
      cancelRoomDivide()
    }
  }, [])
}

/**
 * Where a Divide pointer lands in 3D: the ray (level space) meets the room's
 * floor plane. Walls never answer — the room's floor is drawn on top of them
 * for the session, so a point behind a near wall is placed where the user
 * sees it; the session snaps onto the room's edges within its capture.
 */
export function divideFloorPoint(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  elevation: number,
): Point | null {
  if (Math.abs(direction[1]) < 1e-9) return null
  const t = (elevation - origin[1]) / direction[1]
  if (!(t > 0) || !Number.isFinite(t)) return null
  return [origin[0] + direction[0] * t, origin[2] + direction[2] * t]
}

/** The live segment: from the last placed point to the pointer's point. */
function liveSegment(scope: RoomDivideScope): [Point, Point] | null {
  const from = scope.points.at(-1)
  return from && scope.end ? [from, scope.end] : null
}

/** What the draft label reads: the live segment's length, or why it cannot be built. */
function useDivideLabel(scope: RoomDivideScope) {
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  if (!scope.valid) return scope.message ?? null
  const live = liveSegment(scope)
  if (!live) return null
  const length = Math.hypot(live[1][0] - live[0][0], live[1][1] - live[0][1])
  return length > 0.01 ? formatLinearMeasurement(length, unit, metricNotation) : null
}

function labelPoint(scope: RoomDivideScope): Point | null {
  const live = liveSegment(scope)
  if (!scope.valid) return scope.end
  return live ? [(live[0][0] + live[1][0]) / 2, (live[0][1] + live[1][1]) / 2] : null
}

// The draft draws over the room's floor highlight (998 / 999), which draws
// over every wall, so the line and its points stay readable wherever they are.
const DRAFT_RENDER_ORDER = 1000
const noRaycast = () => {}
/** The line's and a point's size on screen, however far the camera is. */
const STRIP_WIDTH_PX = 3
const VERTEX_RADIUS_PX = 7
const STRIP_MIN_WIDTH = 0.06
const VERTEX_MIN_RADIUS = 0.16

const scratch = new Vector3()
const cameraScratch = new Vector3()

/** World metres one screen pixel spans at `object`'s origin. */
function metresPerPixel(object: Object3D, camera: Camera, viewportHeight: number) {
  if (viewportHeight <= 0) return 0
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera
    return (ortho.top - ortho.bottom) / ortho.zoom / viewportHeight
  }
  const perspective = camera as PerspectiveCamera
  const distance = perspective
    .getWorldPosition(cameraScratch)
    .distanceTo(object.getWorldPosition(scratch))
  return (2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) / viewportHeight
}

function DraftStrip({
  from,
  to,
  color,
  elevation,
}: {
  from: Point
  to: Point
  color: string
  elevation: number
}) {
  const ref = useRef<Mesh>(null)
  useFrame(({ camera, size }) => {
    const mesh = ref.current
    if (!mesh) return
    mesh.scale.z = Math.max(
      STRIP_MIN_WIDTH,
      STRIP_WIDTH_PX * metresPerPixel(mesh, camera, size.height),
    )
  })
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (length < 0.01) return null
  return (
    <mesh
      layers={EDITOR_LAYER}
      position={[(from[0] + to[0]) / 2, elevation + 0.01, (from[1] + to[1]) / 2]}
      raycast={noRaycast}
      ref={ref}
      renderOrder={DRAFT_RENDER_ORDER}
      rotation={[0, -Math.atan2(to[1] - from[1], to[0] - from[0]), 0]}
      scale-z={STRIP_MIN_WIDTH}
    >
      <boxGeometry args={[length, 0.02, 1]} />
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        opacity={0.95}
        side={DoubleSide}
        transparent
      />
    </mesh>
  )
}

/** A placed point: a solid dot in a soft ring, flat on the floor, over the highlight. */
function DraftVertex({ at, color, elevation }: { at: Point; color: string; elevation: number }) {
  const ref = useRef<Group>(null)
  useFrame(({ camera, size }) => {
    const group = ref.current
    if (!group) return
    const radius = Math.max(
      VERTEX_MIN_RADIUS,
      VERTEX_RADIUS_PX * metresPerPixel(group, camera, size.height),
    )
    group.scale.setScalar(radius)
  })
  return (
    <group
      position={[at[0], elevation + 0.012, at[1]]}
      ref={ref}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={VERTEX_MIN_RADIUS}
    >
      <mesh layers={EDITOR_LAYER} raycast={noRaycast} renderOrder={DRAFT_RENDER_ORDER}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={0.3}
          transparent
        />
      </mesh>
      <mesh layers={EDITOR_LAYER} raycast={noRaycast} renderOrder={DRAFT_RENDER_ORDER + 1}>
        <circleGeometry args={[0.45, 32]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={0.95}
          transparent
        />
      </mesh>
    </group>
  )
}

/** A pointer off the room reads grey (not the red of a refused cut). */
const OUTSIDE_COLOR = '#94a3b8'

/** Whether the live point sits off the room: not on its edge, not inside it. */
export function divideEndOutside(scope: RoomDivideScope): boolean {
  if (!scope.end || scope.endKind === 'edge' || scope.endKind === 'close') return false
  if (scope.endKind === 'start' && scope.endBoundaryId) return false
  return !roomDivideContains(scope.end)
}

/** The divide draft in 3D, drawn like a wall draft: cursor beam, strips, length. */
function RoomDividePreview3D({
  scope,
  elevation,
  height,
}: {
  scope: RoomDivideScope
  elevation: number
  height: number
}) {
  const isDark = useSceneIsDark()
  const label = useDivideLabel(scope)
  const liveColor = scope.valid ? DRAFT_COLOR : INVALID_COLOR
  const outside = divideEndOutside(scope)
  const live = liveSegment(scope)
  const at = labelPoint(scope)
  const { points, end } = scope
  return (
    <group>
      {points.map((point, index) => (
        <DraftVertex at={point} color={DRAFT_COLOR} elevation={elevation} key={index} />
      ))}
      {points.slice(1).map((point, index) => (
        <DraftStrip
          color={DRAFT_COLOR}
          elevation={elevation}
          from={points[index]!}
          key={index}
          to={point}
        />
      ))}
      {live && <DraftStrip color={liveColor} elevation={elevation} from={live[0]} to={live[1]} />}
      {end && (
        <CursorSphere
          color={outside ? OUTSIDE_COLOR : liveColor}
          height={height}
          position={[end[0], elevation, end[1]]}
          tooltipContent={<SquareSplitHorizontal className="h-5 w-5 text-white" />}
        />
      )}
      {label && at && (
        <DraftMeasurementLabel
          color={scope.valid ? (isDark ? '#ffffff' : '#111111') : INVALID_COLOR}
          label={label}
          position={[at[0], elevation + DRAFT_LABEL_Y_OFFSET + (scope.valid ? 0 : 0.2), at[1]]}
          shadowColor={isDark ? '#111111' : '#ffffff'}
        />
      )}
    </group>
  )
}

export function RoomControls3D() {
  const room = useRoomControls()
  const scope = useInteractionScope((s) => s.scope)
  const active = scope.kind === 'room-divide' ? scope : null
  const handleDrag = useRoomHandleDrag((s) => s.drag)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const levelId = active?.levelId ?? room?.key.levelId ?? handleDrag?.levelId
  const zoneId = active?.nodeId ?? room?.zoneId
  const zone = useScene((s) => (zoneId ? s.nodes[zoneId as AnyNodeId] : undefined))
  const levelHeight = useScene((s) => {
    const level = levelId ? s.nodes[levelId as AnyNodeId] : undefined
    return level?.type === 'level' ? (level.height ?? DEFAULT_LEVEL_HEIGHT) : DEFAULT_LEVEL_HEIGHT
  })
  const elevation = zone?.type === 'zone' ? (zone.floor?.elevation ?? 0.05) : 0.05
  const root = useRef<Group>(null)
  const { gl, camera, invalidate } = useThree()
  useDivideLifetime()
  useEffect(
    () =>
      bindDividePointer(gl.domElement, (event) => {
        const current = useInteractionScope.getState().scope
        if (current.kind !== 'room-divide' || event.target !== gl.domElement) return null
        const level = sceneRegistry.nodes.get(current.levelId)
        if (!level) return null
        level.updateWorldMatrix(true, false)
        const inverse = new Matrix4().copy(level.matrixWorld).invert()
        const bounds = gl.domElement.getBoundingClientRect()
        const raycaster = new Raycaster()
        raycaster.setFromCamera(
          new Vector2(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            1 - ((event.clientY - bounds.top) / bounds.height) * 2,
          ),
          camera,
        )
        setSurfaceRaycastLayers(raycaster.layers)
        const ray = raycaster.ray.clone().applyMatrix4(inverse)
        const point = divideFloorPoint(
          [ray.origin.x, ray.origin.y, ray.origin.z],
          [ray.direction.x, ray.direction.y, ray.direction.z],
          elevation,
        )
        return point ? { point } : null
      }),
    [gl, camera, elevation],
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
  return (
    <>
      <group matrixAutoUpdate={false} ref={root}>
        {typeof document !== 'undefined' && room && zone && (
          <RoomFloatingMenu height={levelHeight} room={room} zone={zone} />
        )}
        {room && !isFloorplanHovered && <RoomHandles3D room={room} />}
        <RoomHandleDragPreview3D />
        {active && (
          <RoomFloorHighlight3D
            elevation={elevation}
            levelId={active.levelId}
            zoneId={active.nodeId}
          />
        )}
        {active && (
          <RoomDividePreview3D elevation={elevation} height={levelHeight} scope={active} />
        )}
      </group>
      <RoomTransformGhost3D />
    </>
  )
}

export function resolveRoomDividePlanPoint(
  clientX: number,
  clientY: number,
): DividePointerTarget | null {
  const point = clientToPlan(clientX, clientY)
  return point ? { point: [point[0], point[1]] } : null
}

// The plan's draft cursor marker: a soft glow under a solid core, in pixels.
const MARKER_GLOW_PX = 10
const MARKER_CORE_PX = 3

function PlanMarker({ at, color, upp }: { at: Point; color: string; upp: number }) {
  return (
    <>
      <circle cx={at[0]} cy={at[1]} fill={color} fillOpacity={0.25} r={MARKER_GLOW_PX * upp} />
      <circle cx={at[0]} cy={at[1]} fill={color} fillOpacity={0.9} r={MARKER_CORE_PX * upp} />
    </>
  )
}

/** The divide draft on the plan, drawn like the plan's wall draft. */
function RoomDividePreview2D({ scope }: { scope: RoomDivideScope }) {
  const context = useFloorplanRender()
  const isDark = useSceneIsDark()
  const label = useDivideLabel(scope)
  const upp = context?.unitsPerPixel ?? 0.01
  const draft = isDark ? DRAFT_COLOR : DRAFT_COLOR_LIGHT_PLAN
  const liveColor = scope.valid ? draft : INVALID_COLOR
  const live = liveSegment(scope)
  const at = labelPoint(scope)
  const { points, end } = scope
  return (
    <g data-room-divide-preview pointerEvents="none">
      {points.length > 1 && (
        <polyline
          fill="none"
          points={points.map((point) => point.join(',')).join(' ')}
          stroke={draft}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2 * upp}
        />
      )}
      {live && (
        <line
          stroke={liveColor}
          strokeLinecap="round"
          strokeWidth={2 * upp}
          x1={live[0][0]}
          x2={live[1][0]}
          y1={live[0][1]}
          y2={live[1][1]}
        />
      )}
      {points.map((point, index) => (
        <PlanMarker at={point} color={draft} key={index} upp={upp} />
      ))}
      {end && <PlanMarker at={end} color={liveColor} upp={upp} />}
      {label && at && (
        <g
          transform={`translate(${at[0]} ${at[1]}) rotate(${-(context?.sceneRotationDeg ?? 0)}) scale(${upp})`}
        >
          <text
            dominantBaseline="middle"
            fill={scope.valid ? (context?.palette.measurementStroke ?? draft) : INVALID_COLOR}
            fontSize={12}
            fontWeight={600}
            paintOrder="stroke"
            stroke={isDark ? '#0f172a' : '#ffffff'}
            strokeLinejoin="round"
            strokeWidth={3}
            textAnchor="middle"
            y={-16}
          >
            {label}
          </text>
        </g>
      )}
    </g>
  )
}

export function RoomControls2D({ levelId }: { levelId: string | null }) {
  const room = useRoomControls()
  const scope = useInteractionScope((s) => s.scope)
  const active = scope.kind === 'room-divide' && scope.levelId === levelId ? scope : null
  const ref = useRef<SVGGElement>(null)
  useDivideLifetime()
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement
    if (!svg) return
    return bindDividePointer(svg, (event) => {
      if (!(event.target instanceof Element) || event.target.closest('foreignObject')) return null
      return resolveRoomDividePlanPoint(event.clientX, event.clientY)
    })
  }, [])
  return (
    <g ref={ref}>
      {room && room.key.levelId === levelId && <RoomFloorplanMenu plan={ref} room={room} />}
      {active && <RoomDividePreview2D scope={active} />}
      <RoomTransformGhost2D levelId={levelId} />
    </g>
  )
}
