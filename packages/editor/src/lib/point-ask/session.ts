import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  hasPointAskHandler,
  type NodeEvent,
  type PointAskStatus,
  type PointCamera,
  resolveLevelId,
  sceneRegistry,
  submitPointAsk,
  subscribeSceneCommits,
  useScene,
} from '@pascal-app/core'
import { sceneViewBounds, sceneViewPose } from '@pascal-app/core/agent-operations'
import { retractNodes, useViewer } from '@pascal-app/viewer'
import { type Object3D, Vector2, Vector3 } from 'three'
import {
  resolveRoofSegmentSelectionTarget,
  roomForEvent,
} from '../../components/editor/selection-manager'
import { getEditorThreeContext } from '../../components/editor/three-context-bridge'
import { resolveEditorRoomHit } from '../../hooks/use-selected-room'
import { cameraPoseStore } from '../../store/camera-pose-store'
import useEditor, { getActiveContinuationContext } from '../../store/use-editor'
import useFollowPascal from '../../store/use-follow-pascal'
import useInteractionScope from '../../store/use-interaction-scope'
import {
  type BubbleTarget,
  type PinRecord,
  type PointBubble,
  type PointHit,
  type PointHover,
  usePointAsk,
  type WorldBox,
} from '../../store/use-point-ask'
import { isViewVisible, VIEW_3D } from '../../store/view-layout'
import { keyCyclableContinuationContext } from '../continuation'
import { resolveCanvasSelectionNode } from '../selection-routing'
import { triggerSFX } from '../sfx-bus'
import { buildPointContext } from './build-context'
import { type CapturedCrop, captureViewCrop } from './capture-crop'
import { CLICK_SLOP_PX, MAX_TARGETS, TAP_LATCH_MS } from './choreography'
import { describeTarget } from './describe-target'
import {
  createdSince,
  type HistoryMark,
  markHistory,
  stateAfterMark,
  stepsSince,
} from './history-marks'
import { outlineBox } from './outline-box'
import { resolvePointPick } from './pick'
import { createPin } from './pin-machine'
import { canvasRect, projectBox, unionRect } from './projector'
import {
  formatRegionSize,
  isRegionBigEnough,
  nearestEdgePoint,
  rankInRegion,
  rectFromDrag,
  regionFractions,
  regionLabel,
  regionSizeMetres,
} from './region'
import type { Rect } from './types'

// Point and ask's session (the owner, 8 October): the mode's entry and exit, what the pointer
// picks, the bubble's lifecycle, the send, and the pins' link to the chat and the scene. It owns
// no pixels: the overlay draws from `usePointAsk`, this module writes to it.

const CROP_WAIT_MS = 1_500

type Down = {
  x: number
  y: number
  moved: boolean
  hover: PointHover | null
  capturedAt: string
  camera: PointCamera | null
  crop: Promise<CapturedCrop | null>
  shift: boolean
}

let stopSession: (() => void) | null = null

// ─── what is pointed at ─────────────────────────────────────────────────────

/** The editor's own lookups for a hit, handed to the pure pick. */
function pickFor(event: NodeEvent, alt: boolean, selectedTargetIds: readonly string[]) {
  const editor = useEditor.getState()
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId ?? null
  return resolvePointPick({
    event,
    alt,
    selectedTargetIds,
    nodes,
    currentLevelId: levelId,
    phase: editor.phase,
    zonesPickable: false,
    resolveRoom: (e) => roomForEvent(e),
    roomAtPoint: (level, x, z) => resolveEditorRoomHit(null, level, [x, z], '3d'),
    resolveRoofSegment: (e) => resolveRoofSegmentSelectionTarget(e),
    resolveNode: (node) =>
      resolveCanvasSelectionNode({
        node,
        nodes,
        selectedIds: useViewer.getState().selection.selectedIds,
      }),
  })
}

/** The element's world box as view_scene frames it, or null when it has none to draw. */
function worldBoxOf(nodes: Record<string, AnyNode>, id: string): WorldBox | null {
  try {
    const node = nodes[id]
    return node ? outlineBox(node.type, sceneViewBounds(nodes, id)) : null
  } catch {
    return null
  }
}

function targetFor(id: string): BubbleTarget | null {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const node = nodes[id]
  if (!node) return null
  const viewer = useViewer.getState()
  const described = describeTarget(node, nodes, {
    unit: viewer.unit,
    metricNotation: viewer.metricNotation,
  })
  const {
    sizes: _sizes,
    levelId: _levelId,
    zoneId: _zoneId,
    parentId: _parentId,
    ...target
  } = described
  return { ...target, box: worldBoxOf(nodes, id) }
}

const targetCache = new Map<string, BubbleTarget>()

function cachedTarget(id: string): BubbleTarget | null {
  const cached = targetCache.get(id)
  if (cached) return cached
  const target = targetFor(id)
  if (target) targetCache.set(id, target)
  return target
}

/** A pick under the cursor, as the store's hover. */
function hoverFromEvent(event: NodeEvent): PointHover | null {
  const state = usePointAsk.getState()
  const pick = pickFor(event, state.alt, state.bubble?.targets.map((t) => t.id) ?? [])
  if (!pick) return null
  const target = cachedTarget(pick.nodeId)
  if (!target) return null
  const point = event.position as [number, number, number]
  const normal = (event.normal ?? [0, 1, 0]) as [number, number, number]
  const hit: PointHit = { point, normal, ...(pick.face ? { face: pick.face } : {}) }
  return { target, ambiguous: pick.ambiguous, hit }
}

// ─── the camera the person pointed from ─────────────────────────────────────

function currentCamera(): PointCamera | null {
  const pose = cameraPoseStore.getState().pose
  const rect = canvasRect()
  if (!(pose && rect)) return null
  return {
    position: pose.position,
    target: pose.target,
    fov: pose.fov ?? 50,
    aspect: rect.width / Math.max(1, rect.height),
    projection: pose.projection,
    ...(pose.projection === 'orthographic' && pose.viewWidth !== undefined
      ? { viewWidth: pose.viewWidth }
      : {}),
  }
}

// ─── entering and leaving ───────────────────────────────────────────────────

let suspendedTool: ReturnType<typeof useEditor.getState>['toolMode'] | null = null
let cDown: number | null = null
let leaveOnClose = false

/** Whether the mode can start now: a host answers asks, the view is 3D, nothing else holds the pointer. */
export function canPoint(): boolean {
  if (!hasPointAskHandler()) return false
  const editor = useEditor.getState()
  if (!isViewVisible(editor, VIEW_3D) || editor.isFirstPersonMode || editor.isPreviewMode)
    return false
  if (editor.workspaceMode !== 'edit') return false
  return !!getEditorThreeContext()
}

/**
 * Whether C is the mode's key right now. It is the tool's while a gesture is under way or the armed
 * tool cycles something with it (the placement tools' "place once"); an armed tool that is only
 * waiting (a wall about to be drawn) is put aside and comes back when the mode leaves.
 */
function cIsOurs(): boolean {
  const editor = useEditor.getState()
  if (editor.mode !== 'select' && editor.mode !== 'build') return false
  if (useInteractionScope.getState().scope.kind !== 'idle') return false
  return keyCyclableContinuationContext(getActiveContinuationContext()) === null
}

export function isPointing(): boolean {
  return usePointAsk.getState().active
}

export function enterPointMode(latched: boolean): boolean {
  if (usePointAsk.getState().active) return true
  if (!canPoint()) return false
  const editor = useEditor.getState()
  // An armed tool is put aside and comes back when the mode leaves.
  if (editor.mode !== 'select') {
    suspendedTool = editor.toolMode
    editor.armToolMode({ mode: 'select' })
  } else suspendedTool = null
  const scope = useInteractionScope.getState()
  if (scope.scope.kind !== 'idle') scope.end()
  scope.begin({ kind: 'pointing' })
  useViewer.getState().setHoverHighlightMode('point')
  useViewer.getState().setHoveredId(null)
  usePointAsk.getState().setActive(true, latched)
  setCursor(true)
  return true
}

export function leavePointMode() {
  const state = usePointAsk.getState()
  if (!state.active) return
  // Off first: ending the scope below must not find the mode still on and leave it again.
  state.setActive(false)
  cDown = null
  leaveOnClose = false
  regionCandidates = null
  const viewer = useViewer.getState()
  viewer.setHoveredId(null)
  viewer.setPointedIds(null)
  useInteractionScope.getState().endIf((s) => s.kind === 'pointing')
  viewer.setHoverHighlightMode(useEditor.getState().mode === 'delete' ? 'delete' : 'default')
  state.setRegion(null)
  targetCache.clear()
  setCursor(false)
  if (suspendedTool) {
    const tool = suspendedTool
    suspendedTool = null
    useEditor
      .getState()
      .armToolMode(tool as Parameters<ReturnType<typeof useEditor.getState>['armToolMode']>[0])
  }
}

const CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><path d='M5 3l15 7.2-6.4 1.9-2.3 6.4z' fill='%23a99bff' stroke='%2316171b' stroke-width='1.4' stroke-linejoin='round'/><rect x='15' y='15' width='11' height='9' rx='3' fill='%23edece9' stroke='%2316171b' stroke-width='1'/><text x='20.5' y='22' font-family='system-ui,sans-serif' font-size='7.5' font-weight='700' text-anchor='middle' fill='%2316171b'>C</text></svg>\") 5 3, crosshair"

function setCursor(on: boolean) {
  const canvas = getEditorThreeContext()?.domElement
  if (canvas) canvas.style.cursor = on ? CURSOR : ''
}

// ─── the bubble ─────────────────────────────────────────────────────────────

function openBubble(
  targets: BubbleTarget[],
  hit: PointHit,
  gesture: PointBubble['gesture'],
  down: Down | null,
  area?: PointBubble['area'],
) {
  const state = usePointAsk.getState()
  const draft = state.bubble?.draft ?? state.drafts[targets[0]?.id ?? area?.ids.join() ?? ''] ?? ''
  const frame = canvasRect()
  const crop = down?.crop
  const bubble: PointBubble = {
    targets,
    anchor: hit.point,
    hit,
    gesture,
    capturedAt: down?.capturedAt ?? new Date().toISOString(),
    camera: down?.camera ?? currentCamera(),
    crop: { state: crop ? 'pending' : 'none' },
    draft,
    error: null,
    ...(area && frame ? { area, region: regionFractions(area.rect, frame) } : {}),
  }
  state.openBubble(bubble)
  // The bubble's targets keep the point outline while the pointer goes on naming the next pick.
  useViewer
    .getState()
    .setPointedIds(
      targets.length ? (targets.map((t) => t.id) as never) : ((area?.ids as never) ?? null),
    )
  if (crop) {
    const opened = bubble
    crop.then(
      (value) => {
        const current = usePointAsk.getState().bubble
        if (!(current && current.capturedAt === opened.capturedAt)) return
        usePointAsk.getState().patchBubble({
          crop: value
            ? {
                state: 'ready',
                dataUrl: value.dataUrl,
                width: value.width,
                height: value.height,
                marked: false,
              }
            : { state: 'failed' },
        })
      },
      () => undefined,
    )
  }
  downCrops.set(bubble.capturedAt, crop ?? Promise.resolve(null))
}

/** The pending crop of each bubble, kept so a send can wait for it. */
const downCrops = new Map<string, Promise<CapturedCrop | null>>()

export function closeBubble(kind: 'send' | 'dismiss' = 'dismiss') {
  const state = usePointAsk.getState()
  const bubble = state.bubble
  if (!bubble) return
  state.rememberDraft(bubble.targets[0]?.id ?? '', bubble.draft)
  downCrops.delete(bubble.capturedAt)
  if (bubble.area) state.setRegion(null)
  state.closeBubble(kind)
  useViewer.getState().setPointedIds(null)
  if (leaveOnClose) {
    leaveOnClose = false
    leavePointMode()
  }
}

function startCrop(hover: PointHover | null): Promise<CapturedCrop | null> {
  if (!hover?.target.box) return Promise.resolve(null)
  const rect = projectBox(hover.target.box)
  if (!rect) return Promise.resolve(null)
  return captureViewCrop(rect).then(
    (crop) => crop,
    (error) => {
      console.debug('[point-ask] no picture:', error instanceof Error ? error.message : error)
      return null
    },
  )
}

// ─── pointer ────────────────────────────────────────────────────────────────

let down: Down | null = null

/**
 * What is under a page point, found by raycasting the scene's registered nodes: the pick for a press
 * that lands before any hover was read (a fast click, a touch, which has no hover at all). The same
 * `resolvePointPick` decides it, so a click without a hover sends what the hover would have shown.
 */
function pickAtPoint(x: number, y: number): PointHover | null {
  const three = getEditorThreeContext()
  const rect = canvasRect()
  if (!(three && rect)) return null
  three.raycaster.setFromCamera(
    new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
    three.camera,
  )
  const owners = new Map<Object3D, string>()
  for (const [id, object] of sceneRegistry.nodes) owners.set(object, id)
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  for (const hit of three.raycaster.intersectObjects([...owners.keys()], true)) {
    let object: Object3D | null = hit.object
    let hidden = false
    let id: string | undefined
    for (; object; object = object.parent) {
      if (!object.visible) hidden = true
      id ??= owners.get(object)
    }
    const node = id ? nodes[id] : undefined
    if (hidden || !node) continue
    const local = hit.object.worldToLocal(hit.point.clone())
    const event = {
      node,
      position: [hit.point.x, hit.point.y, hit.point.z],
      localPosition: [local.x, local.y, local.z],
      normal: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] : undefined,
      faceIndex: hit.faceIndex,
      object: hit.object,
      stopPropagation: () => undefined,
    } as unknown as NodeEvent
    const hover = hoverFromEvent(event)
    if (hover) return hover
  }
  return null
}

function onPointerDown(event: PointerEvent) {
  const state = usePointAsk.getState()
  if (!state.active || event.button !== 0) return
  const canvas = getEditorThreeContext()?.domElement
  if (!canvas || event.target !== canvas) return
  event.preventDefault()
  event.stopImmediatePropagation()
  // A touch has no hover: its press names what it lands on, and shows the outline at once.
  const hover =
    state.hover && event.pointerType !== 'touch'
      ? state.hover
      : pickAtPoint(event.clientX, event.clientY)
  if (hover && hover !== state.hover) {
    state.setHover(hover)
    useViewer.getState().setHoveredId(hover.target.id as AnyNodeId)
  }
  down = {
    x: event.clientX,
    y: event.clientY,
    moved: false,
    hover,
    capturedAt: new Date().toISOString(),
    camera: currentCamera(),
    crop: startCrop(hover),
    shift: event.shiftKey,
  }
}

// ─── a region: a view dragged out on the canvas, not a selection ────────────

/** The camera's ray through a page point, for measuring a rectangle on the ground. */
function cameraRay(x: number, y: number) {
  const three = getEditorThreeContext()
  const rect = canvasRect()
  if (!(three && rect)) return null
  three.raycaster.setFromCamera(
    new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
    three.camera,
  )
  const { origin, direction } = three.raycaster.ray
  return {
    origin: [origin.x, origin.y, origin.z] as [number, number, number],
    direction: [direction.x, direction.y, direction.z] as [number, number, number],
  }
}

/** The floor of the level in view, in world metres. */
function levelFloorY(): number {
  const levelId = useViewer.getState().selection.levelId
  const object = levelId ? sceneRegistry.nodes.get(levelId) : null
  if (!object) return 0
  object.updateWorldMatrix(true, false)
  return object.getWorldPosition(new Vector3()).y
}

/** What a region drag could take, boxed once when the drag begins: rebuilding it per move would walk the whole scene. */
let regionCandidates: { id: string; box: WorldBox }[] | null = null
let regionPreviewAt = 0

function candidatesForRegion() {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId
  const found: { id: string; box: WorldBox }[] = []
  for (const node of Object.values(nodes)) {
    if (!REGION_KINDS.has(node.type) || node.visible === false) continue
    if (levelId && resolveLevelId(node, nodes) !== levelId) continue
    const box = worldBoxOf(nodes, node.id)
    if (box) found.push({ id: node.id, box })
  }
  return found
}

/** The live preview of a region: what its rectangle would take is outlined while it is dragged. */
function previewRegion(rect: Rect, now: number) {
  if (now - regionPreviewAt < 80) return
  regionPreviewAt = now
  regionCandidates ??= candidatesForRegion()
  const { ids } = rankInRegion(
    regionCandidates.map(({ id, box }) => ({ id, rect: projectBox(box) })),
    rect,
  )
  useViewer.getState().setPointedIds(ids.length ? (ids as never) : null)
}

function updateRegionDrag(press: Down, event: PointerEvent) {
  const bounds = canvasRect()
  if (!bounds) return
  const rect = rectFromDrag(
    { x: press.x, y: press.y },
    { x: event.clientX, y: event.clientY },
    { x0: bounds.left, y0: bounds.top, x1: bounds.right, y1: bounds.bottom },
  )
  const size = regionSizeMetres(rect, cameraRay, levelFloorY())
  const state = usePointAsk.getState()
  state.setRegion({
    rect,
    sizeLabel: size ? formatRegionSize(size, useViewer.getState().unit) : null,
    settled: false,
    flashKey: state.region?.flashKey ?? 0,
  })
  // A region has no pick: the chip and the hover outline step aside while it is drawn.
  if (state.hover) state.setHover(null)
  useViewer.getState().setHoveredId(null)
  previewRegion(rect, event.timeStamp)
}

/** The elements of the level in view that show inside the rectangle, the biggest first. */
function elementsInRegion(rect: Rect) {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId
  const candidates: { id: string; rect: Rect | null }[] = []
  for (const node of Object.values(nodes)) {
    if (!REGION_KINDS.has(node.type) || node.visible === false) continue
    if (levelId && resolveLevelId(node, nodes) !== levelId) continue
    const box = worldBoxOf(nodes, node.id)
    candidates.push({ id: node.id, rect: box ? projectBox(box) : null })
  }
  return rankInRegion(candidates, rect)
}

const REGION_KINDS = new Set([
  'zone',
  'wall',
  'window',
  'door',
  'item',
  'stair',
  'roof',
  'column',
  'fence',
  'shelf',
])

/** The press became a drag and was let go: the shutter fires and a bubble opens on the rectangle. */
function finishRegion(press: Down, event: PointerEvent) {
  const state = usePointAsk.getState()
  const region = state.region
  regionCandidates = null
  if (!(region && isRegionBigEnough(region.rect))) {
    state.setRegion(null)
    useViewer.getState().setPointedIds(null)
    return
  }
  const rect = region.rect
  state.setRegion({ ...region, settled: true, flashKey: region.flashKey + 1 })
  if (state.playful) triggerSFX('sfx:snapshot-capture')
  const crop = captureViewCrop(rect, { pad: 0 }).then(
    (value) => value,
    (error) => {
      console.debug(
        '[point-ask] no picture of the region:',
        error instanceof Error ? error.message : error,
      )
      return null
    },
  )
  const { ids, more } = elementsInRegion(rect)
  const release = { x: event.clientX, y: event.clientY }
  const click = nearestEdgePoint(rect, release)
  // The pin plants on the ground under where the finger let go (the level's floor when the ray misses).
  const planeY = levelFloorY()
  const ray = cameraRay(release.x, release.y)
  const t = ray && ray.direction[1] < -1e-6 ? (planeY - ray.origin[1]) / ray.direction[1] : null
  const point: [number, number, number] =
    ray && t !== null && t > 0
      ? [ray.origin[0] + ray.direction[0] * t, planeY, ray.origin[2] + ray.direction[2] * t]
      : (cameraPoseStore.getState().pose?.target ?? [0, planeY, 0])
  openBubble(
    [],
    { point, normal: [0, 1, 0] },
    'region',
    { ...press, crop },
    { rect, click, ids, more },
  )
}

function onPointerMove(event: PointerEvent) {
  const point = usePointAsk.getState()
  // Over a pin, its card or the bubble the pointer is no longer on the scene: nothing is named.
  if (
    point.active &&
    !down &&
    point.hover &&
    event.target !== getEditorThreeContext()?.domElement
  ) {
    point.setHover(null)
    useViewer.getState().setHoveredId(null)
  }
  if (!down) return
  if (!down.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) {
    down.moved = true
    // A drag begun while composing re-points: the open bubble goes, its words are kept.
    if (usePointAsk.getState().bubble) closeBubble('dismiss')
  }
  if (down.moved) updateRegionDrag(down, event)
}

function onPointerUp(event: PointerEvent) {
  const press = down
  down = null
  if (!press || event.button !== 0) return
  const state = usePointAsk.getState()
  if (!state.active) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (press.moved) {
    finishRegion(press, event)
    return
  }
  handleClick(press, event.shiftKey || press.shift)
}

/** A native click that follows a press this mode took must not reach the scene. */
function swallowCanvasClick(event: MouseEvent) {
  if (!usePointAsk.getState().active) return
  const canvas = getEditorThreeContext()?.domElement
  if (canvas && event.target === canvas) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

function handleClick(press: Down, shift: boolean) {
  const state = usePointAsk.getState()
  const hover = press.hover
  if (!hover) {
    if (state.bubble) closeBubble('dismiss')
    return
  }
  const bubble = state.bubble
  if (bubble && shift) {
    const has = bubble.targets.some((t) => t.id === hover.target.id)
    const targets = has
      ? bubble.targets.filter((t) => t.id !== hover.target.id)
      : bubble.targets.length < MAX_TARGETS
        ? [...bubble.targets, hover.target]
        : bubble.targets
    if (targets.length === 0) return closeBubble('dismiss')
    state.patchBubble({ targets, gesture: targets.length > 1 ? 'multi' : 'click' })
    return
  }
  // A plain click on another element while composing moves the bubble there and keeps the words.
  openBubble([hover.target], hover.hit, 'click', press)
}

// ─── hover (the node events the viewer already raises) ──────────────────────

function onAnyEvent(type: string | symbol, event: unknown) {
  if (typeof type !== 'string') return
  const state = usePointAsk.getState()
  if (!state.active) return
  // Each pointer event is emitted per kind (`wall:move`) and again generically (`node:move`), and
  // then climbs to the level, the building and the site: only the innermost kind's own event is read.
  if (type.startsWith('node:')) return
  const suffix = type.slice(type.lastIndexOf(':') + 1)
  if (suffix !== 'enter' && suffix !== 'move' && suffix !== 'leave') return
  const nodeEvent = event as NodeEvent | undefined
  if (!nodeEvent?.node) return
  if (
    nodeEvent.node.type === 'level' ||
    nodeEvent.node.type === 'building' ||
    nodeEvent.node.type === 'site'
  )
    return
  const viewer = useViewer.getState()
  if (viewer.cameraDragging || viewer.inputDragging || down?.moved) return
  if (suffix === 'leave') {
    const current = state.hover
    if (current) {
      // The next enter in the same pointer move replaces it; a leave with no enter clears.
      queueMicrotask(() => {
        const now = usePointAsk.getState()
        if (now.hover === current) {
          now.setHover(null)
          useViewer.getState().setHoveredId(null)
        }
      })
    }
    return
  }
  lastEvent = nodeEvent
  // What is under the pointer is read here and goes no higher.
  nodeEvent.stopPropagation()
  const hover = hoverFromEvent(nodeEvent)
  state.setHover(hover)
  useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
}

let lastEvent: NodeEvent | null = null

function replayHover() {
  if (!lastEvent) return
  const hover = hoverFromEvent(lastEvent)
  const state = usePointAsk.getState()
  state.setHover(hover)
  useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
}

// ─── keys ───────────────────────────────────────────────────────────────────

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))

function onKeyDown(event: KeyboardEvent) {
  const state = usePointAsk.getState()
  if (event.key === 'Alt' || event.key === 'Shift') {
    state.setModifiers(event.altKey, event.shiftKey)
    if (state.active) replayHover()
    return
  }
  if (event.key === 'Escape') {
    if (state.cardFor) {
      state.openCard(null)
      event.stopImmediatePropagation()
      return
    }
    if (state.bubble) {
      closeBubble('dismiss')
      event.stopImmediatePropagation()
      return
    }
    if (state.active) {
      leavePointMode()
      event.stopImmediatePropagation()
    }
    return
  }
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && state.active && !state.bubble) {
    if (state.hover) {
      event.preventDefault()
      event.stopImmediatePropagation()
      openBubble([state.hover.target], state.hover.hit, 'click', null)
    }
    return
  }
  if (event.key !== 'c' && event.key !== 'C') return
  // A held C never types: its repeats are swallowed until the key goes up.
  if (cDown !== null) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
  if (event.repeat) return
  if (state.active && state.latched) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.bubble) closeBubble('dismiss')
    leavePointMode()
    return
  }
  if (state.active) return
  if (!cIsOurs()) return
  if (enterPointMode(false)) {
    cDown = event.timeStamp
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

function onKeyUp(event: KeyboardEvent) {
  const state = usePointAsk.getState()
  if (event.key === 'Alt' || event.key === 'Shift') {
    state.setModifiers(event.altKey, event.shiftKey)
    if (state.active) replayHover()
    return
  }
  if ((event.key === 'c' || event.key === 'C') && cDown !== null) {
    // Both times are the input's own: a slow render between the two must not turn a tap into a hold.
    const held = event.timeStamp - cDown
    cDown = null
    if (held < TAP_LATCH_MS) state.setLatched(true)
    else if (state.bubble) leaveOnClose = true
    else leavePointMode()
  }
}

function onBlur() {
  usePointAsk.getState().setModifiers(false, false)
  if (cDown !== null) {
    cDown = null
    if (usePointAsk.getState().bubble) leaveOnClose = true
    else leavePointMode()
  }
}

// ─── send ───────────────────────────────────────────────────────────────────

let askCounter = 0
const newAskId = () =>
  `ask_${Date.now().toString(36)}${(askCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** The scene history now, marked so what an ask's turn wrote can be counted when its Undo comes. */
const markNow = () => markHistory(useScene.temporal.getState().pastStates)
const stepsFrom = (mark: HistoryMark) => stepsSince(useScene.temporal.getState().pastStates, mark)

const askMarks = new Map<
  string,
  { start: HistoryMark | null; end: HistoryMark | null; undoneSteps: number; undone: boolean }
>()

function isInTargets(targetIds: readonly string[]) {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  return (id: string) => {
    let node: AnyNode | undefined = nodes[id]
    for (let hops = 0; node && hops < 12; hops++) {
      if (targetIds.includes(node.id)) return true
      node = node.parentId ? nodes[node.parentId] : undefined
    }
    return false
  }
}

/**
 * Sends the bubble's ask: the pin plants on the frame of Enter and the bubble folds into it; the
 * handoff to the chat follows (after the crop, up to 1.5 s), and a refusal brings the bubble back
 * with its words and the reason.
 */
export async function sendBubble(
  text: string,
  from: { x: number; y: number; width: number; height: number },
) {
  const state = usePointAsk.getState()
  const bubble = state.bubble
  const words = text.trim()
  if (!(bubble && words)) return
  const askId = newAskId()
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const first = bubble.targets[0]
  const area = bubble.area
  const object = first ? sceneRegistry.nodes.get(first.id) : undefined
  let local: PinRecord['local'] = null
  if (object && first) {
    object.updateWorldMatrix(true, false)
    const p = object.worldToLocal(new Vector3(...bubble.anchor))
    local = { nodeId: first.id, offset: [p.x, p.y, p.z] }
  }
  // A region has no targets: what shows inside it is what the pin watches for changes.
  const model = createPin({
    askId,
    text: words,
    targetIds: area ? area.ids : bubble.targets.map((t) => t.id),
  })
  const label = area
    ? regionLabel(area.ids.length + area.more)
    : bubble.targets.length > 1
      ? `${first?.name} and ${bubble.targets.length - 1} more`
      : (first?.name ?? 'Selection')
  state.addPin({
    model,
    anchor: bubble.anchor,
    local,
    label,
    levelId: useViewer.getState().selection.levelId ?? null,
    retireAt: null,
    createdAt: Date.now(),
    ...(bubble.crop.state === 'ready' ? { before: bubble.crop } : {}),
  })
  askMarks.set(askId, { start: null, end: null, undoneSteps: 0, undone: false })
  const restore = bubble
  closeBubble('send')
  state.dispatchPin(askId, { type: 'sent' })

  // The crop is usually ready by now (it started at pointer-down); wait for it only briefly.
  let crop = bubble.crop
  if (crop.state === 'pending') {
    const pending = downCrops.get(bubble.capturedAt)
    const waited = pending
      ? await Promise.race([
          pending,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), CROP_WAIT_MS)),
        ])
      : null
    crop = waited
      ? {
          state: 'ready',
          dataUrl: waited.dataUrl,
          width: waited.width,
          height: waited.height,
          marked: false,
        }
      : { state: 'failed' }
  }
  const firstNode = first ? nodes[first.id] : undefined
  const levelId =
    useViewer.getState().selection.levelId ??
    (firstNode ? (resolveLevelId(firstNode, nodes) ?? '') : '')
  const context = buildPointContext({
    askId,
    capturedAt: bubble.capturedAt,
    gesture: bubble.gesture,
    nodes: nodes as Record<string, AnyNode>,
    levelId,
    targets: bubble.targets.map((t, i) => ({ id: t.id, ...(i === 0 ? { hit: bubble.hit } : {}) })),
    ...(area ? { inRegion: { ids: area.ids, more: area.more } } : {}),
    camera: bubble.camera ??
      currentCamera() ?? {
        position: [0, 5, 5],
        target: [0, 0, 0],
        fov: 50,
        aspect: 1.6,
        projection: 'perspective',
      },
    ...(bubble.region ? { region: bubble.region } : {}),
    ...(crop.state === 'ready' && crop.dataUrl
      ? {
          image: {
            dataUrl: crop.dataUrl,
            width: crop.width ?? 0,
            height: crop.height ?? 0,
            marked: false,
          },
        }
      : {}),
  })
  const submit = { askId, text: words, context, from }
  usePointAsk.getState().patchPin(askId, { submit })
  const result = await submitPointAsk(submit)
  if (result.ok) return
  // The chat did not take it: the pin goes, and the bubble returns with the reason and the words.
  usePointAsk.getState().removePin(askId)
  askMarks.delete(askId)
  usePointAsk.getState().openBubble({ ...restore, draft: words, error: result.message })
  if (restore.area)
    usePointAsk
      .getState()
      .setRegion({ rect: restore.area.rect, sizeLabel: null, settled: true, flashKey: 0 })
}

/** The camera flies to what an ask is about (the edge marker's click): the targets' union box, as view_scene frames it. */
export function lookAtAsk(askId: string) {
  const pin = usePointAsk.getState().pins[askId]
  if (!pin) return
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const boxes = pin.model.targetIds.flatMap((id) => {
    const box = worldBoxOf(nodes, id)
    return box ? [box] : []
  })
  if (boxes.length === 0) return
  const box = {
    min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i] as number))) as [
      number,
      number,
      number,
    ],
    max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i] as number))) as [
      number,
      number,
      number,
    ],
  }
  // The person asked to look: Follow Pascal must not take the camera back while it flies there.
  useFollowPascal.getState().pause()
  emitter.emit('camera-controls:apply-pose', sceneViewPose(box, {}))
}

/** The picture of what the turn made, from the same view when the camera has not moved: the card's "after". */
async function captureAfter(askId: string) {
  const pin = usePointAsk.getState().pins[askId]
  if (!pin) return
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const boxes = pin.model.targetIds.flatMap((id) => {
    const box = worldBoxOf(nodes, id)
    const rect = box ? projectBox(box) : null
    return rect ? [rect] : []
  })
  const rect = unionRect(boxes)
  if (!rect) return
  try {
    const crop = await captureViewCrop(rect)
    usePointAsk.getState().patchPin(askId, {
      after: {
        state: 'ready',
        dataUrl: crop.dataUrl,
        width: crop.width,
        height: crop.height,
        marked: false,
      },
    })
  } catch (error) {
    console.debug(
      '[point-ask] no picture of the result:',
      error instanceof Error ? error.message : error,
    )
  }
}

/** Try again after an error: the same words and context go as a new ask, planted where the old pin was. */
export async function retryAsk(askId: string) {
  const state = usePointAsk.getState()
  const old = state.pins[askId]
  if (!old?.submit) return
  const next = newAskId()
  const submit = { ...old.submit, askId: next, context: { ...old.submit.context, askId: next } }
  state.addPin({
    ...old,
    model: createPin({ askId: next, text: old.model.text, targetIds: old.model.targetIds }),
    submit,
    retireAt: null,
    createdAt: Date.now(),
  })
  state.removePin(askId)
  state.openCard(null)
  askMarks.set(next, { start: null, end: null, undoneSteps: 0, undone: false })
  state.dispatchPin(next, { type: 'sent' })
  const result = await submitPointAsk(submit)
  if (!result.ok) {
    usePointAsk.getState().dispatchPin(next, {
      type: 'status',
      status: {
        askId: next,
        status: 'ended',
        outcome: 'errored',
        asked: false,
        wroteScene: false,
        error: result.message,
      },
    })
  }
}

// ─── the chat's word on a turn, and the scene's commits ─────────────────────

function onStatus(status: PointAskStatus) {
  const state = usePointAsk.getState()
  const pin = state.pins[status.askId]
  if (!pin) return
  const marks = askMarks.get(status.askId)
  if (status.status === 'working' && marks && marks.start === null) marks.start = markNow()
  state.dispatchPin(status.askId, { type: 'status', status })
  if (status.status === 'ended') {
    if (marks) marks.end = markNow()
    state.patchPin(status.askId, { retireAt: null })
    const settled = usePointAsk.getState().pins[status.askId]
    if (settled?.model.state === 'done') void captureAfter(status.askId)
  }
}

function onCommit(commit: { changedNodeIds?: ReadonlySet<AnyNodeId> }) {
  const state = usePointAsk.getState()
  const changed = commit.changedNodeIds ? [...commit.changedNodeIds] : []
  if (changed.length === 0) return
  for (const askId of state.pinOrder) {
    const pin = state.pins[askId]
    if (pin?.model.state !== 'working') continue
    state.dispatchPin(askId, {
      type: 'commit',
      changedNodeIds: changed,
      isInTargets: isInTargets(pin.model.targetIds),
    })
  }
}

/** What an undo of the turn will take out of the scene: the nodes the turn created, not those it only changed. */
function createdByTurn(start: HistoryMark): string[] {
  const before = stateAfterMark(useScene.temporal.getState().pastStates, start)
  if (!before) return []
  return createdSince(
    before.nodes as Record<string, unknown>,
    useScene.getState().nodes as Record<string, unknown>,
  )
}

/**
 * Undo for an ask from its pin: the history steps its turn wrote (the chat has no turn undo
 * tonight). What the turn built plays backwards first (the construction in reverse, so taking
 * something back is as satisfying as making it) and the steps are undone the moment it has gone.
 * `needs-confirm` when the scene changed after the turn ended, which Undo would remove too;
 * `unavailable` when the history no longer holds the whole turn.
 */
export async function undoAsk(
  askId: string,
  options: { force?: boolean } = {},
): Promise<'undone' | 'needs-confirm' | 'unavailable'> {
  const marks = askMarks.get(askId)
  if (!marks?.start) return 'unavailable'
  const steps = stepsFrom(marks.start)
  if (steps === null || steps <= 0) return 'unavailable'
  if (!options.force && handEditsSince(askId) > 0) return 'needs-confirm'
  usePointAsk.getState().dispatchPin(askId, { type: 'undo' })
  // Only what the undo removes is retracted: a node it merely changes would go and come back whole.
  const created = createdByTurn(marks.start)
  if (created.length > 0) {
    // Walls the level has batched are drawn by a merged mesh a pose cannot move: a dirty mark hands
    // each back to its own mesh, as an edit does, or the walls would stand whole until they vanish.
    for (const id of created) useScene.getState().markDirty(id as AnyNodeId)
    await retractNodes(created)
  }
  // The steps are counted again: the history can have moved while the build played backwards.
  const now = stepsFrom(marks.start) ?? steps
  useScene.temporal.getState().undo(now)
  marks.undone = true
  marks.undoneSteps = now
  usePointAsk.getState().dispatchPin(askId, { type: 'undone', ok: true })
  return 'undone'
}

/** Redo for an ask the person just undid, while nothing else has been done since. */
export function redoAsk(askId: string): boolean {
  const marks = askMarks.get(askId)
  if (!marks?.undone) return false
  const temporal = useScene.temporal.getState()
  // Anything done after the undo clears the future, so there is nothing of the ask to bring back.
  if (temporal.futureStates.length < marks.undoneSteps) return false
  temporal.redo(marks.undoneSteps)
  marks.undone = false
  usePointAsk.getState().dispatchPin(askId, { type: 'redo' })
  return true
}

/**
 * How many steps the scene has taken since the ask's turn ended: the person's own edits, which an
 * Undo would remove too. A history that no longer holds the turn's end counts as one.
 */
export function handEditsSince(askId: string): number {
  const marks = askMarks.get(askId)
  if (!marks?.end) return 0
  return stepsFrom(marks.end) ?? 1
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

/** Starts listening for the keys, the pointer, the chat's statuses and the scene's commits. */
export function startPointAskSession(): () => void {
  if (stopSession) return stopSession
  const offs: (() => void)[] = []
  const listen = <K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options: AddEventListenerOptions | boolean = true,
  ) => {
    window.addEventListener(type, handler as EventListener, options)
    offs.push(() => window.removeEventListener(type, handler as EventListener, options))
  }
  listen('keydown', onKeyDown)
  listen('keyup', onKeyUp)
  listen('blur', onBlur, false)
  listen('pointerdown', onPointerDown)
  listen('pointermove', onPointerMove)
  listen('pointerup', onPointerUp)
  listen('click', swallowCanvasClick)
  listen('dblclick', swallowCanvasClick)
  emitter.on('*', onAnyEvent as never)
  offs.push(() => emitter.off('*', onAnyEvent as never))
  emitter.on('point-ask:status', onStatus as never)
  offs.push(() => emitter.off('point-ask:status', onStatus as never))
  offs.push(subscribeSceneCommits(onCommit))
  // The editor's selection manager resets the hover style whenever the tool mode changes, which
  // putting an armed tool aside does: while the mode is on the point style is kept.
  offs.push(
    useViewer.subscribe((state) => {
      if (usePointAsk.getState().active && state.hoverHighlightMode !== 'point')
        state.setHoverHighlightMode('point')
    }),
  )
  // Another interaction taking the pointer ends the mode; a level or view change drops stale hover.
  offs.push(
    useInteractionScope.subscribe((state) => {
      if (usePointAsk.getState().active && state.scope.kind !== 'pointing') leavePointMode()
    }),
  )
  offs.push(
    useEditor.subscribe((state, prev) => {
      if (!usePointAsk.getState().active) return
      if (!isViewVisible(state, VIEW_3D)) leavePointMode()
      if (state.isFirstPersonMode && !prev.isFirstPersonMode) leavePointMode()
    }),
  )
  offs.push(
    useScene.subscribe((state, prev) => {
      if (state.nodes === prev.nodes) return
      const point = usePointAsk.getState()
      if (point.hover && !state.nodes[point.hover.target.id as AnyNodeId]) point.setHover(null)
      targetCache.clear()
    }),
  )
  stopSession = () => {
    for (const off of offs) off()
    leavePointMode()
    stopSession = null
  }
  return stopSession
}

// Used by the overlay to know a node's level for hiding pins on hidden levels.
export function levelOfNode(id: string): string | null {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const node = nodes[id]
  return node ? (resolveLevelId(node, nodes) ?? null) : null
}

export { unionRect }
