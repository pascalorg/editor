import {
  type AnyNodeId,
  applyZoneTransformPlan,
  duplicateZone,
  generateId,
  type Point,
  rotateZone,
  type StructureNodes,
  transformZone,
  useScene,
  type ZoneTransformPlan,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Plane, Vector2, Vector3 } from 'three'
import { create } from 'zustand'
import { levelFrame } from '../components/editor/group-transform-shared'
import { swallowNextClick } from '../components/editor/handles/use-handle-drag'
import { getEditorThreeContext } from '../components/editor/three-context-bridge'
import useEditor, { isGridSnapActive } from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { clientToPlan } from './floorplan/plan-coords'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import { isHistoryShortcut } from './history'
import { mezzanineConflictMessage } from './mezzanine-messages'
import { sfxEmitter } from './sfx-bus'
import { isTypingTarget } from './typing-target'

export const ROOM_MOVE_DRAG_LABEL = 'room-move'

export type RoomTransformKind = 'move' | 'duplicate'

export type RoomTransformSession = {
  kind: RoomTransformKind
  zoneId: string
  levelId: string
  /** The rotation origin: the room's area centroid, in level plan coordinates. */
  pivot: Point
  /** The room's outline and wall footprints at rest, carried by the ghost. */
  outline: Point[][]
  walls: Point[][]
  translate: Point
  angle: number
  /** Alt: a crossing through a door or window slides the opening along its wall. */
  force: boolean
  valid: boolean
  message?: string
}

/** Why the last Rotate left / right did nothing, shown under the room's pill for a moment. */
export type RoomActionNotice = { zoneId: string; message: string }

export const useRoomTransform = create<{
  session: RoomTransformSession | null
  notice: RoomActionNotice | null
}>(() => ({
  session: null,
  notice: null,
}))

let noticeTimer: ReturnType<typeof setTimeout> | null = null
/** Shows (or clears) the short line under a room's pill for a moment. */
export function showRoomNotice(notice: RoomActionNotice | null) {
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = notice ? setTimeout(() => showRoomNotice(null), 3500) : null
  useRoomTransform.setState({ notice })
}

/**
 * The planner's transform, mirrored for the ghost: rotation about the pivot
 * (the planner's handedness), then translation.
 */
export function transformRoomPoint(
  [x, z]: Point,
  pivot: Point,
  angle: number,
  translate: Point,
): Point {
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  return [
    pivot[0] + cos * (x - pivot[0]) + sin * (z - pivot[1]) + translate[0],
    pivot[1] - sin * (x - pivot[0]) + cos * (z - pivot[1]) + translate[1],
  ]
}

/** Area centroid of an outline (outer ring first, holes after). */
export function roomPivot(rings: Point[][]): Point {
  let weight = 0,
    x = 0,
    z = 0
  for (const [index, ring] of rings.entries()) {
    let cross = 0,
      rx = 0,
      rz = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!
      const c = a[0] * b[1] - b[0] * a[1]
      cross += c
      rx += (a[0] + b[0]) * c
      rz += (a[1] + b[1]) * c
    }
    const sign = index === 0 ? 1 : -1
    weight += (sign * cross) / 2
    x += (sign * rx) / 6
    z += (sign * rz) / 6
  }
  if (Math.abs(weight) < 1e-9) {
    const all = rings.flat()
    return all.length
      ? [
          all.reduce((sum, p) => sum + p[0], 0) / all.length,
          all.reduce((sum, p) => sum + p[1], 0) / all.length,
        ]
      : [0, 0]
  }
  return [x / weight, z / weight]
}

// Short cursor-side wording for what the planner still refuses: overlaps
// resolve (crossings split, collinear walls merge), so only an opening in the
// way, a deck resting on the room, or an open room can stop a placement.
const TRANSFORM_MESSAGES: Record<string, string> = {
  'open-room': 'Room is open',
  'occupied-split': 'Door or window in the way · Alt slides it',
  'deck-reference': 'A deck rests on this room',
}
export function roomTransformMessage(code?: string, force = false) {
  if (code === 'occupied-split' && force) return 'No room to slide the opening'
  const mezzanine = mezzanineConflictMessage(code)
  if (mezzanine) return mezzanine
  return (code && TRANSFORM_MESSAGES[code]) || "Can't place here"
}

export function planRoomTransform(
  nodes: StructureNodes,
  session: Pick<RoomTransformSession, 'kind' | 'zoneId' | 'pivot' | 'translate' | 'angle'> & {
    force?: boolean
  },
  mintId: (kind: string) => string,
): ZoneTransformPlan {
  const input = {
    zoneId: session.zoneId,
    translate: session.translate,
    rotate: { angle: session.angle, pivot: session.pivot },
    force: session.force ?? false,
    mintId: mintId as (kind: string) => never,
  }
  if (session.kind !== 'duplicate') return transformZone(nodes, input)
  const plan = duplicateZone(nodes, input)
  const zone = nodes[session.zoneId]
  if (zone?.type !== 'zone' || zone.floor?.support !== 'open' || plan.conflicts?.length) return plan
  // Core slides a mezzanine copy clear of a conflict on its own; the carry
  // places it where the pointer is or not at all, and says why.
  const created = plan.changes.find(
    (change) => change.op === 'create' && change.node.type === 'zone',
  )
  const first = zone.polygon[0]
  const landed =
    created?.op === 'create' && created.node.type === 'zone' ? created.node.polygon[0] : null
  if (!(first && landed)) return plan
  const expected = transformRoomPoint(first, session.pivot, session.angle, session.translate)
  if (Math.hypot(landed[0] - expected[0], landed[1] - expected[1]) < 1e-6) return plan
  const moved = transformZone(nodes, input).conflicts?.[0]
  return {
    ...plan,
    changes: [],
    conflicts: [
      moved ?? {
        code: 'overlaps-mezzanine',
        nodeIds: [zone.id],
        message: 'Mezzanines must not overlap.',
      },
    ],
  }
}

function previewMint() {
  const used = new Set(Object.keys(useScene.getState().nodes))
  let n = 0
  return (kind: string) => {
    let id = `${kind}_roompreview${n++}`
    while (used.has(id)) id = `${kind}_roompreview${n++}`
    return id
  }
}

// The planner is the expensive step; identical candidates on the same scene
// reuse its verdict.
let memo: { nodes: StructureNodes; key: string; code?: string } | null = null

/** Moves the ghost and asks the planner whether it can land there. */
export function previewRoomTransform(translate: Point, angle: number, force?: boolean) {
  const session = useRoomTransform.getState().session
  if (!session) return
  const forced = force ?? session.force
  const nodes = useScene.getState().nodes
  const key = JSON.stringify([session.kind, translate, angle, forced])
  let code: string | undefined
  if (memo?.nodes === nodes && memo.key === key) code = memo.code
  else {
    const idle = session.kind !== 'duplicate' && angle === 0 && !translate[0] && !translate[1]
    try {
      code = idle
        ? undefined
        : planRoomTransform(nodes, { ...session, translate, angle, force: forced }, previewMint())
            .conflicts?.[0]?.code
    } catch {
      code = 'error'
    }
    memo = { nodes, key, code }
  }
  useRoomTransform.setState({
    session: {
      ...session,
      translate,
      angle,
      force: forced,
      valid: !code,
      message: code ? roomTransformMessage(code, forced) : undefined,
    },
  })
}

let teardown: (() => void) | null = null
let owner: GestureHandle | null = null

// Re-entrant safe: the session and its owner are gone before the listeners
// and the scope are released, so nothing reacting to that release finds
// anything to cancel.
function end() {
  const release = teardown
  const current = owner
  teardown = null
  owner = null
  memo = null
  useRoomTransform.setState({ session: null })
  try {
    release?.()
  } finally {
    current?.end()
  }
}

/** The pick-up in flight, for the gesture owner's lifecycle checks. */
export function getRoomTransformSession() {
  return useRoomTransform.getState().session
}

/** Puts the room back (ghost cleared, scope released). Idempotent. */
export function cancelRoomTransform() {
  if (!useRoomTransform.getState().session) return
  if (owner?.active) owner.cancel()
  else end()
}

/** Places the room. Refused (the session stays) while the ghost is red. */
export function commitRoomTransform(): boolean {
  const session = useRoomTransform.getState().session
  if (!session?.valid) return false
  const idle =
    session.kind !== 'duplicate' &&
    session.angle === 0 &&
    !session.translate[0] &&
    !session.translate[1]
  if (idle) {
    end()
    return true
  }
  let plan: ZoneTransformPlan
  try {
    plan = planRoomTransform(useScene.getState().nodes, session, generateId as never)
  } catch {
    useRoomTransform.setState({
      session: { ...session, valid: false, message: roomTransformMessage() },
    })
    return false
  }
  if (plan.conflicts?.length) {
    useRoomTransform.setState({
      session: {
        ...session,
        valid: false,
        message: roomTransformMessage(plan.conflicts[0]?.code, session.force),
      },
    })
    return false
  }
  // Out of the lifecycle before the write, so its scene change cannot cancel it.
  const current = owner
  owner = null
  const apply = () => {
    try {
      applyZoneTransformPlan(plan)
      sfxEmitter.emit('sfx:item-place')
    } finally {
      end()
    }
  }
  if (current) current.finish(apply)
  else apply()
  const zoneId = plan.zoneId
  if (useScene.getState().nodes[zoneId as AnyNodeId])
    useEditor.getState().selectRoom({ levelId: session.levelId, zoneId })
  return true
}

/** Level-frame plan point under the pointer, on the 2D plan or the 3D floor plane. */
function resolvePlanPoint(event: PointerEvent, levelId: string, planeY: number): Point | null {
  const three = getEditorThreeContext()
  if (three && event.target === three.domElement) {
    const rect = three.domElement.getBoundingClientRect()
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    three.raycaster.setFromCamera(ndc, three.camera)
    const { matrix, inverse } = levelFrame(levelId)
    const origin = new Vector3(0, planeY, 0).applyMatrix4(matrix)
    const normal = new Vector3(0, 1, 0).transformDirection(matrix)
    const hit = three.raycaster.ray.intersectPlane(
      new Plane().setFromNormalAndCoplanarPoint(normal, origin),
      new Vector3(),
    )
    if (!hit) return null
    const local = hit.applyMatrix4(inverse)
    return [local.x, local.z]
  }
  const svg = (document.querySelector('g[data-floorplan-scene]') as SVGGElement | null)
    ?.ownerSVGElement
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    return null
  const plan = clientToPlan(event.clientX, event.clientY)
  return plan ? [plan[0], plan[1]] : null
}

/** The carry itself: delta-relative moves; the angle is what R / T carried. */
export function roomTransformFromPointer(
  anchor: Point,
  pointer: Point,
  carriedAngle: number,
  { gridStep, free }: { gridStep: number; free: boolean },
): { translate: Point; angle: number } {
  let dx = pointer[0] - anchor[0],
    dz = pointer[1] - anchor[1]
  if (!free && gridStep > 0) {
    dx = Math.round(dx / gridStep) * gridStep
    dz = Math.round(dz / gridStep) * gridStep
  }
  return { translate: [dx || 0, dz || 0], angle: carriedAngle }
}

export type RoomRotateResult = { ok: true; zoneId: string } | { ok: false; message: string }

/**
 * Rotate left / right: the room turns a quarter at once, as one undo step,
 * and stays selected. `rotateZone` keeps its walls on the original grid (the
 * current grid step). Rotate left is counter-clockwise seen from above.
 * `force` (Alt-click) slides a door or window a crossing would cut.
 */
export function rotateRoom(
  room: { zoneId: string; levelId: string },
  direction: 'left' | 'right',
  { force = false }: { force?: boolean } = {},
): RoomRotateResult {
  if (useRoomTransform.getState().session) cancelRoomTransform()
  const refuse = (code?: string): RoomRotateResult => {
    const message = roomTransformMessage(code, force)
    showRoomNotice({ zoneId: room.zoneId, message })
    return { ok: false, message }
  }
  const nodes = useScene.getState().nodes
  if (!nodes[room.zoneId as AnyNodeId]) return refuse()
  let plan: ZoneTransformPlan
  try {
    plan = rotateZone(nodes, {
      zoneId: room.zoneId,
      quarterTurns: direction === 'left' ? 1 : -1,
      gridStep: useEditor.getState().gridSnapStep,
      force,
      mintId: generateId as never,
    })
  } catch {
    return refuse()
  }
  if (plan.conflicts?.length) return refuse(plan.conflicts[0]?.code)
  showRoomNotice(null)
  applyZoneTransformPlan(plan)
  sfxEmitter.emit('sfx:item-rotate')
  if (useScene.getState().nodes[plan.zoneId as AnyNodeId])
    useEditor.getState().selectRoom({ levelId: room.levelId, zoneId: plan.zoneId })
  return { ok: true, zoneId: plan.zoneId }
}

/**
 * Picks the room up — Move and Duplicate carry it with the pointer (R / T
 * turn the carried room ±45°) — across the 2D plan and the 3D view, like the
 * group pick-up. The ghost turns red where the planner refuses;
 * a click places it as one undo step, Escape / right-click / ⌘Z put it back.
 */
export function startRoomTransform(
  kind: RoomTransformKind,
  room: { zoneId: string; levelId: string; outline: Point[][]; walls: Point[][]; floorY: number },
): boolean {
  if (useRoomTransform.getState().session) cancelRoomTransform()
  if (!useScene.getState().nodes[room.zoneId as AnyNodeId] || !room.outline[0]?.length) return false
  const pivot = roomPivot(room.outline)
  useRoomTransform.setState({
    session: {
      kind,
      zoneId: room.zoneId,
      levelId: room.levelId,
      pivot,
      outline: room.outline,
      walls: room.walls,
      translate: [0, 0],
      angle: 0,
      force: false,
      valid: kind !== 'duplicate',
    },
  })
  if (kind === 'duplicate') previewRoomTransform([0, 0], 0)
  sfxEmitter.emit('sfx:item-pick')
  const handle = beginGesture({
    kind: 'room-transform',
    scope: {
      kind: 'handle-drag',
      nodeId: room.zoneId,
      handle: ROOM_MOVE_DRAG_LABEL,
    },
    stale: () => !useScene.getState().nodes[room.zoneId as AnyNodeId],
    onCancel: () => {
      if (owner === handle) owner = null
      end()
    },
  })
  owner = handle
  document.body.style.cursor = 'grabbing'

  let anchor: Point | null = null
  let carriedAngle = 0
  let frame = 0
  let pending: PointerEvent | null = null
  let pressed: number | null = null

  const apply = (event: PointerEvent) => {
    const pointer = resolvePlanPoint(event, room.levelId, room.floorY)
    if (!pointer) return
    if (!anchor) {
      anchor = pointer
      return
    }
    const next = roomTransformFromPointer(anchor, pointer, carriedAngle, {
      gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
      free: event.altKey,
    })
    const current = useRoomTransform.getState().session
    if (
      current &&
      current.force === event.altKey &&
      current.angle === next.angle &&
      current.translate[0] === next.translate[0] &&
      current.translate[1] === next.translate[1]
    )
      return
    sfxEmitter.emit('sfx:grid-snap')
    previewRoomTransform(next.translate, next.angle, event.altKey)
  }
  const flush = () => {
    frame = 0
    const event = pending
    pending = null
    if (event) apply(event)
  }
  const onMove = (event: PointerEvent) => {
    pending = event
    if (!frame) frame = requestAnimationFrame(flush) || 0
  }
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      event.preventDefault()
      event.stopPropagation()
      cancelRoomTransform()
      return
    }
    if (event.button !== 0 || !resolvePlanPoint(event, room.levelId, room.floorY)) return
    event.preventDefault()
    event.stopPropagation()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pending = null
    apply(event)
    pressed = event.pointerId
  }
  const onPointerUp = (event: PointerEvent) => {
    if (pressed === null || event.pointerId !== pressed) return
    pressed = null
    event.preventDefault()
    event.stopPropagation()
    swallowNextClick()
    useViewer.getState().setInputDragging(true)
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
    commitRoomTransform()
  }
  const label = ROOM_MOVE_DRAG_LABEL
  const ownsScope = () => {
    const scope = useInteractionScope.getState().scope
    return scope.kind === 'handle-drag' && scope.handle === label && scope.nodeId === room.zoneId
  }
  // Alt re-asks the planner where the room stands: slide an opening or not.
  const onAlt = (event: KeyboardEvent) => {
    if (event.key !== 'Alt' || isTypingTarget(event.target) || !ownsScope()) return
    const session = useRoomTransform.getState().session
    const force = event.type === 'keydown'
    if (session && session.force !== force)
      previewRoomTransform(session.translate, session.angle, force)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target) || !ownsScope()) return
    if (event.key === 'Alt') return onAlt(event)
    const key = event.key.toLowerCase()
    if (
      (key === 'r' || key === 't') &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      carriedAngle += (key === 'r' ? 1 : -1) * (Math.PI / 4)
      const session = useRoomTransform.getState().session
      if (session) previewRoomTransform(session.translate, carriedAngle)
      sfxEmitter.emit('sfx:item-rotate')
      return
    }
    if (event.key !== 'Escape' && !isHistoryShortcut(event)) return
    event.preventDefault()
    event.stopPropagation()
    cancelRoomTransform()
  }
  const onContextMenu = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onAlt, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  teardown = () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onAlt, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
  }
  return true
}
