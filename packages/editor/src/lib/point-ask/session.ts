import {
  type AnyNode,
  type AnyNodeId,
  beginScenePreview,
  emitter,
  hasPointAskHandler,
  type NodeEvent,
  type PointAskStatus,
  type PointCamera,
  resolveLevelId,
  type SceneCommit,
  type SceneSnapshot,
  sceneRegistry,
  submitPointAsk,
  subscribeSceneCommits,
  subscribeScenePreview,
  useScene,
} from '@pascal-app/core'
import { sceneViewBounds, sceneViewPose } from '@pascal-app/core/agent-operations'
import { retractNodes, useViewer } from '@pascal-app/viewer'
import { cameraPoseStore, useFollowPascal } from '@pascal-app/viewer/ui'
import {
  type Camera,
  Matrix3,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { getEditorFloorplanContext } from '../../components/editor/floorplan-context-bridge'
import {
  resolveRoofSegmentSelectionTarget,
  roomForEvent,
} from '../../components/editor/selection-manager'
import { getEditorThreeContext } from '../../components/editor/three-context-bridge'
import { resolveEditorRoomHit, resolvePlanRoomHit } from '../../hooks/use-selected-room'
import useEditor, { getActiveContinuationContext } from '../../store/use-editor'
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
import { isViewVisible, VIEW_2D, VIEW_3D } from '../../store/view-layout'
import { keyCyclableContinuationContext } from '../continuation'
import {
  captureEnrichedRegion,
  type EnrichedCapture,
  EnrichmentFallbackError,
} from '../enriched-capture/enrich'
import { resolveCanvasSelectionNode } from '../selection-routing'
import { triggerSFX } from '../sfx-bus'
import { buildPointContext } from './build-context'
import { type CapturedCrop, captureViewCrop } from './capture-crop'
import { CLICK_SLOP_PX, MAX_TARGETS, TAP_LATCH_MS } from './choreography'
import { createCompare } from './compare'
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
import {
  canvasRect,
  preferredPointViewport,
  projectBoxIn,
  unionRect,
  viewportRect,
} from './projector'
import {
  formatRegionSize,
  isRegionBigEnough,
  nearestEdgePoint,
  rankInRegion,
  rectFromDrag,
  regionFootprint,
  regionFractions,
  regionLabel,
  regionSizeMetres,
} from './region'
import { planRetry } from './retry'
import { pointCommitEvent } from './scene-commit'
import { POINT_ASK_CURSOR, type PointViewport, type Rect, type WorldFootprint } from './types'

export { POINT_ASK_CURSOR }

// Point and ask's session (the owner, 8 October): the mode's entry and exit, what the pointer
// picks, the bubble's lifecycle, the send, and the pins' link to the chat and the scene. It owns
// no pixels: the overlay draws from `usePointAsk`, this module writes to it.

const CROP_WAIT_MS = 1_500
const ENRICHED_CROP_WAIT_MS = 12_000
type SessionCrop = CapturedCrop & { enriched?: EnrichedCapture }
let enrichedRegions = false
let freeClick = false

type Down = {
  x: number
  y: number
  moved: boolean
  surface: PointViewport
  hover: PointHover | null
  capturedAt: string
  camera: PointCamera | null
  crop: Promise<SessionCrop | null>
  cropController?: AbortController
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
  return { target, ambiguous: pick.ambiguous, hit, viewport: '3d' }
}

// ─── the camera the person pointed from ─────────────────────────────────────

function currentCamera(
  viewport: PointViewport = preferredPointViewport() ?? '3d',
  hitPoint?: readonly [number, number, number],
): PointCamera | null {
  if (viewport === '2d') {
    return getEditorFloorplanContext()?.getCamera() ?? null
  }
  const editor = useEditor.getState()
  const rect = viewportRect('3d') ?? canvasRect('3d')
  if (editor.isFirstPersonMode) {
    const three = getEditorThreeContext()
    if (!(three && rect)) return null
    three.camera.updateMatrixWorld(true)
    const eye = three.camera.getWorldPosition(new Vector3())
    const forward = three.camera.getWorldDirection(new Vector3())
    const dist = hitPoint
      ? Math.min(
          50,
          Math.max(0.5, eye.distanceTo(new Vector3(hitPoint[0], hitPoint[1], hitPoint[2]))),
        )
      : 8
    const target = eye.clone().addScaledVector(forward, dist)
    const fov = (three.camera as PerspectiveCamera).isPerspectiveCamera
      ? (three.camera as PerspectiveCamera).fov
      : 50
    return {
      position: [eye.x, eye.y, eye.z],
      target: [target.x, target.y, target.z],
      fov,
      aspect: rect.width / Math.max(1, rect.height),
      projection: 'perspective',
    }
  }
  const pose = cameraPoseStore.getState().pose
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

/** Whether the mode can start now: a host answers asks, a 2D or 3D scene view is open, nothing else holds the pointer. */
export function canPoint(): boolean {
  if (!hasPointAskHandler()) return false
  const editor = useEditor.getState()
  if (editor.isPreviewMode || editor.isCaptureMode || editor.workspaceMode !== 'edit') return false
  const can3d = isViewVisible(editor, VIEW_3D) && Boolean(getEditorThreeContext())
  const can2d =
    !editor.isFirstPersonMode &&
    isViewVisible(editor, VIEW_2D) &&
    Boolean(getEditorFloorplanContext())
  return can3d || can2d
}

/**
 * Whether C is the mode's key right now. It is the tool's while a gesture is under way or the armed
 * tool cycles something with it (the placement tools' "place once"); an armed tool that is only
 * waiting (a wall about to be drawn) is put aside and comes back when the mode leaves.
 */
function cIsOurs(): boolean {
  const editor = useEditor.getState()
  if (editor.isFirstPersonMode) {
    return useInteractionScope.getState().scope.kind === 'idle'
  }
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
  endCompare()
  // Off first: ending the scope below must not find the mode still on and leave it again.
  state.setActive(false)
  cDown = null
  leaveOnClose = false
  regionCandidates = null
  lastEvent = null
  lastPointer = null
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

function setCursor(on: boolean) {
  const canvas = getEditorThreeContext()?.domElement
  if (canvas) canvas.style.cursor = on ? POINT_ASK_CURSOR : ''
  const svg = getEditorFloorplanContext()?.svgElement
  if (svg && !on) svg.style.cursor = ''
}

// ─── the bubble ─────────────────────────────────────────────────────────────

function openBubble(
  targets: BubbleTarget[],
  hit: PointHit,
  gesture: PointBubble['gesture'],
  down: Pick<Down, 'crop' | 'cropController' | 'capturedAt' | 'camera'> | null,
  area?: PointBubble['area'],
  changesAsk?: PointBubble['changesAsk'],
  extra?: {
    locationLabel?: string
    region?: [number, number, number, number]
    viewport?: PointViewport
  },
) {
  const state = usePointAsk.getState()
  if (state.bubble && state.bubble.capturedAt !== (down?.capturedAt ?? '')) {
    cancelCrop(state.bubble.capturedAt)
    downCrops.delete(state.bubble.capturedAt)
    regionFootprintBuilders.delete(state.bubble.capturedAt)
  }
  // Asking for more starts from an empty field; the words just sent are not a draft to come back to.
  const draft = changesAsk
    ? ''
    : (state.bubble?.draft ?? state.drafts[targets[0]?.id ?? area?.ids.join() ?? ''] ?? '')
  const surface = extra?.viewport ?? preferredPointViewport() ?? '3d'
  const frame = viewportRect(surface) ?? canvasRect(surface)
  const crop = down?.crop
  const region = extra?.region ?? (area && frame ? regionFractions(area.rect, frame) : undefined)
  const bubble: PointBubble = {
    targets,
    anchor: hit.point,
    hit,
    gesture,
    capturedAt: down?.capturedAt ?? new Date().toISOString(),
    camera: down?.camera ?? currentCamera(surface, hit.point),
    crop: { state: crop ? 'pending' : 'none' },
    draft,
    error: null,
    viewport: surface,
    ...(area ? { area } : {}),
    ...(region ? { region } : {}),
    ...(extra?.locationLabel ? { locationLabel: extra.locationLabel } : {}),
    ...(changesAsk ? { changesAsk } : {}),
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
    if (down?.cropController) cropControllers.set(opened.capturedAt, down.cropController)
    crop
      .then(
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
                  ...(value.enriched ? { enriched: value.enriched } : {}),
                }
              : { state: 'failed' },
            ...(value?.enriched && current.area
              ? (() => {
                  const nextAnchor = value.enriched.world.center
                  const nextFootprint = nextAnchor
                    ? alignFootprintToCenter(
                        nextAnchor,
                        current.footprint,
                        current.hit.normal,
                        regionFootprintBuilders.get(opened.capturedAt),
                      )
                    : undefined
                  return {
                    area: { ...current.area, ids: visibleNodeIds(value.enriched), more: 0 },
                    camera: value.enriched.camera,
                    ...(nextAnchor ? { anchor: nextAnchor } : {}),
                    ...(nextFootprint ? { footprint: nextFootprint } : {}),
                  }
                })()
              : value?.enriched
                ? { camera: value.enriched.camera }
                : {}),
          })
          if (value?.enriched && current.area) {
            const ids = visibleNodeIds(value.enriched)
            useViewer.getState().setPointedIds(ids.length ? (ids as never) : null)
          }
        },
        () => undefined,
      )
      .finally(() => {
        if (cropControllers.get(opened.capturedAt) === down?.cropController) {
          cropControllers.delete(opened.capturedAt)
        }
      })
  }
  downCrops.set(bubble.capturedAt, crop ?? Promise.resolve(null))
}

/** The pending crop of each bubble, kept so a send can wait for it. */
const downCrops = new Map<string, Promise<SessionCrop | null>>()
const cropControllers = new Map<string, AbortController>()
const regionFootprintBuilders = new Map<
  string,
  (point: [number, number, number], normal: [number, number, number]) => WorldFootprint | null
>()

function cancelCrop(capturedAt: string) {
  const controller = cropControllers.get(capturedAt)
  if (!controller) return
  cropControllers.delete(capturedAt)
  controller.abort()
}

function makeCameraRay(
  camera: Camera,
  rect: { left: number; top: number; width: number; height: number },
) {
  const raycaster = new Raycaster()
  return (x: number, y: number) => {
    raycaster.setFromCamera(
      new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
      camera,
    )
    const { origin, direction } = raycaster.ray
    return {
      origin: [origin.x, origin.y, origin.z] as [number, number, number],
      direction: [direction.x, direction.y, direction.z] as [number, number, number],
    }
  }
}

function alignFootprintToCenter(
  center: [number, number, number],
  fallback: WorldFootprint | undefined,
  hitNormal: [number, number, number],
  build?: (
    point: [number, number, number],
    normal: [number, number, number],
  ) => WorldFootprint | null,
): WorldFootprint | undefined {
  const normal = fallback?.normal ?? hitNormal
  const recomputed = build?.(center, normal)
  if (recomputed) return recomputed
  if (!fallback) return undefined
  const dx = center[0] - fallback.center[0]
  const dy = center[1] - fallback.center[1]
  const dz = center[2] - fallback.center[2]
  return {
    center,
    normal: fallback.normal,
    corners: fallback.corners.map(([x, y, z]) => [x + dx, y + dy, z + dz]),
  }
}

function visibleNodeIds(capture: EnrichedCapture): string[] {
  return [...new Set(capture.visible.flatMap((entry) => (entry.id ? [entry.id] : [])))]
}

export function closeBubble(kind: 'send' | 'dismiss' = 'dismiss') {
  const state = usePointAsk.getState()
  const bubble = state.bubble
  if (!bubble) return
  // Words that were not sent are kept for the next time the same element is pointed at.
  if (kind === 'dismiss') {
    cancelCrop(bubble.capturedAt)
    state.rememberDraft(bubble.targets[0]?.id ?? '', bubble.draft)
  } else {
    cropControllers.delete(bubble.capturedAt)
  }
  downCrops.delete(bubble.capturedAt)
  regionFootprintBuilders.delete(bubble.capturedAt)
  if (bubble.area) state.setRegion(null)
  state.closeBubble(kind)
  useViewer.getState().setPointedIds(null)
  if (leaveOnClose) {
    leaveOnClose = false
    leavePointMode()
  }
}

function startCrop(
  hover: PointHover | null,
  surface: PointViewport,
  signal?: AbortSignal,
): Promise<CapturedCrop | null> {
  if (!hover?.target.box) return Promise.resolve(null)
  const rect = projectBoxIn(hover.target.box, surface)
  if (!rect) return Promise.resolve(null)
  if (surface === '2d') {
    const floorplan = getEditorFloorplanContext()
    if (!floorplan) return Promise.resolve(null)
    return floorplan.captureCrop(rect, { pad: 0.25, signal }).then(
      (crop) => crop,
      (error) => {
        console.debug('[point-ask] no picture:', error instanceof Error ? error.message : error)
        return null
      },
    )
  }
  return captureViewCrop(rect, { signal }).then(
    (crop) => crop,
    (error) => {
      console.debug('[point-ask] no picture:', error instanceof Error ? error.message : error)
      return null
    },
  )
}

// ─── pointer ────────────────────────────────────────────────────────────────

let down: Down | null = null

function surfaceForEventTarget(target: EventTarget | null): PointViewport | null {
  if (!target) return null
  const editor = useEditor.getState()
  const three = getEditorThreeContext()
  if (isViewVisible(editor, VIEW_3D) && three && target === three.domElement) {
    return '3d'
  }
  const floorplan = getEditorFloorplanContext()
  if (
    !editor.isFirstPersonMode &&
    isViewVisible(editor, VIEW_2D) &&
    floorplan &&
    (target === floorplan.svgElement ||
      (typeof Node !== 'undefined' &&
        target instanceof Node &&
        floorplan.svgElement.contains(target)))
  ) {
    return '2d'
  }
  return null
}

/**
 * What is under a page point, found by raycasting the scene's registered nodes: the pick for a press
 * that lands before any hover was read (a fast click, a touch, which has no hover at all). The same
 * `resolvePointPick` decides it, so a click without a hover sends what the hover would have shown.
 */
function pickAtPoint(x: number, y: number): PointHover | null {
  const three = getEditorThreeContext()
  const rect = canvasRect('3d')
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
    const normal = hit.face?.normal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
    const event = {
      node,
      position: [hit.point.x, hit.point.y, hit.point.z],
      localPosition: [local.x, local.y, local.z],
      normal: normal ? [normal.x, normal.y, normal.z] : undefined,
      faceIndex: hit.faceIndex,
      object: hit.object,
      stopPropagation: () => undefined,
    } as unknown as NodeEvent
    const hover = hoverFromEvent(event)
    if (hover) return hover
  }
  return null
}

/** Pick what is under a page point on the 2D floorplan using the same room-first + Alt rules. */
function pickAt2DPoint(x: number, y: number): PointHover | null {
  const floorplan = getEditorFloorplanContext()
  if (!floorplan) return null
  const hit = floorplan.pickAtScreenPoint(x, y)
  if (!hit) return null
  const state = usePointAsk.getState()
  const selectedTargetIds = state.bubble?.targets.map((t) => t.id) ?? []
  const editor = useEditor.getState()
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId ?? null

  let resolvedNode = hit.nodeId ? nodes[hit.nodeId] : undefined
  if (resolvedNode) {
    resolvedNode = resolveCanvasSelectionNode({
      node: resolvedNode,
      nodes,
      selectedIds: useViewer.getState().selection.selectedIds,
    })
    if (
      (resolvedNode.type === 'building' || resolvedNode.type === 'site') &&
      editor.phase !== 'site'
    ) {
      resolvedNode = undefined
    } else if (
      resolvedNode.type !== 'elevator' &&
      levelId &&
      resolveLevelId(resolvedNode, nodes) !== levelId
    ) {
      resolvedNode = undefined
    }
  }

  const roomZoneId = hit.roomZoneId && nodes[hit.roomZoneId] ? hit.roomZoneId : null
  let pickedId: string | null = null
  let ambiguous = false
  let face: PointHit['face']

  if (
    resolvedNode &&
    (resolvedNode.type === 'wall' ||
      resolvedNode.type === 'slab' ||
      resolvedNode.type === 'ceiling') &&
    roomZoneId &&
    !state.alt &&
    !selectedTargetIds.includes(roomZoneId)
  ) {
    pickedId = roomZoneId
    ambiguous = true
    face = 'top'
  } else if (resolvedNode && resolvedNode.type !== 'zone') {
    pickedId = resolvedNode.id
    if (
      resolvedNode.type === 'wall' ||
      resolvedNode.type === 'slab' ||
      resolvedNode.type === 'ceiling'
    ) {
      face = 'top'
    }
  } else if (roomZoneId) {
    pickedId = roomZoneId
  }

  if (!pickedId) return null
  const target = cachedTarget(pickedId)
  if (!target) return null
  return {
    target,
    ambiguous,
    hit: {
      point: hit.point,
      normal: hit.normal,
      ...(face ? { face } : {}),
    },
    viewport: '2d',
  }
}

function onPointerDown(event: PointerEvent) {
  const state = usePointAsk.getState()
  if (!state.active || event.button !== 0) return
  const surface = surfaceForEventTarget(event.target)
  if (!surface) return
  if (surface === '2d' && getEditorFloorplanContext()?.isSpacePanPressed()) return
  // This capture listener may run before the pin layer's outside-dismiss listener.
  if (state.cardFor && state.pins[state.cardFor]?.behavior === 'persistent') {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    state.openCard(null)
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  // A touch has no hover: its press names what it lands on, and shows the outline at once.
  const hover =
    surface === '2d'
      ? pickAt2DPoint(event.clientX, event.clientY)
      : state.hover && state.hover.viewport !== '2d' && event.pointerType !== 'touch'
        ? state.hover
        : pickAtPoint(event.clientX, event.clientY)
  if (hover && hover !== state.hover) {
    state.setHover(hover)
    useViewer.getState().setHoveredId(hover.target.id as AnyNodeId)
  }
  const cropController = new AbortController()
  down = {
    x: event.clientX,
    y: event.clientY,
    moved: false,
    surface,
    hover,
    capturedAt: new Date().toISOString(),
    camera: currentCamera(surface, hover?.hit.point),
    crop: startCrop(hover, surface, cropController.signal),
    cropController,
    shift: event.shiftKey,
  }
}

// ─── a region: a view dragged out on the canvas, not a selection ────────────

/** The camera's ray through a page point, for measuring a rectangle on the ground. */
function cameraRay(x: number, y: number, viewport: PointViewport = '3d') {
  if (viewport === '2d') {
    return getEditorFloorplanContext()?.cameraRay(x, y) ?? null
  }
  const three = getEditorThreeContext()
  const rect = canvasRect('3d')
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
function previewRegion(rect: Rect, now: number, surface: PointViewport) {
  if (now - regionPreviewAt < 80) return
  regionPreviewAt = now
  regionCandidates ??= candidatesForRegion()
  const { ids } = rankInRegion(
    regionCandidates.map(({ id, box }) => ({ id, rect: projectBoxIn(box, surface) })),
    rect,
  )
  useViewer.getState().setPointedIds(ids.length ? (ids as never) : null)
}

function updateRegionDrag(press: Down, event: PointerEvent) {
  const bounds = viewportRect(press.surface)
  if (!bounds) return
  const rect = rectFromDrag(
    { x: press.x, y: press.y },
    { x: event.clientX, y: event.clientY },
    { x0: bounds.left, y0: bounds.top, x1: bounds.right, y1: bounds.bottom },
  )
  const floorY =
    press.surface === '2d'
      ? (getEditorFloorplanContext()?.getLevelY() ?? levelFloorY())
      : levelFloorY()
  const size = regionSizeMetres(rect, (x, y) => cameraRay(x, y, press.surface), floorY)
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
  previewRegion(rect, event.timeStamp, press.surface)
}

/** The elements of the level in view that show inside the rectangle, the biggest first. */
function elementsInRegion(rect: Rect, surface: PointViewport) {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId
  const candidates: { id: string; rect: Rect | null }[] = []
  for (const node of Object.values(nodes)) {
    if (!REGION_KINDS.has(node.type) || node.visible === false) continue
    if (levelId && resolveLevelId(node, nodes) !== levelId) continue
    const box = worldBoxOf(nodes, node.id)
    candidates.push({ id: node.id, rect: box ? projectBoxIn(box, surface) : null })
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

function regionCenterHit(rect: Rect, surface: PointViewport): PointHit {
  const center = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }
  if (surface === '2d') {
    const surfaceHit = pickAt2DPoint(center.x, center.y)?.hit
    if (surfaceHit) return surfaceHit
    const floorplan = getEditorFloorplanContext()
    const world = floorplan?.screenToWorld(center.x, center.y)
    const planeY = floorplan?.getLevelY() ?? levelFloorY()
    return { point: world ?? [0, planeY, 0], normal: [0, 1, 0] }
  }
  const surfaceHit = pickAtPoint(center.x, center.y)?.hit
  if (surfaceHit) return surfaceHit
  // Empty ground has no registered node: only then fall back to the level plane.
  const planeY = levelFloorY()
  const ray = cameraRay(center.x, center.y, '3d')
  const t = ray && ray.direction[1] < -1e-6 ? (planeY - ray.origin[1]) / ray.direction[1] : null
  const point: [number, number, number] =
    ray && t !== null && t >= 0
      ? [ray.origin[0] + ray.direction[0] * t, planeY, ray.origin[2] + ray.direction[2] * t]
      : (cameraPoseStore.getState().pose?.target ?? [0, planeY, 0])
  return { point, normal: [0, 1, 0] }
}

function captureRegionCrop(
  rect: Rect,
  surface: PointViewport,
  signal?: AbortSignal,
): Promise<SessionCrop> {
  if (surface === '2d') {
    const floorplan = getEditorFloorplanContext()
    if (!floorplan) return Promise.reject(new Error('The 2D plan view is not ready'))
    return floorplan.captureCrop(rect, { pad: 0, signal })
  }
  if (!enrichedRegions) return captureViewCrop(rect, { pad: 0, signal })
  return captureEnrichedRegion(rect, { pad: 0, signal }).then(
    (enriched) => ({ ...enriched.crop, enriched }),
    (error) => {
      if (error instanceof EnrichmentFallbackError) {
        console.debug('[point-ask] enriched map unavailable, keeping photo:', error.message)
        return error.crop
      }
      throw error
    },
  )
}

/** The press became a drag and was let go: the shutter fires and a bubble opens on the rectangle. */
function finishRegion(press: Down, event: PointerEvent) {
  press.cropController?.abort()
  const state = usePointAsk.getState()
  const region = state.region
  regionCandidates = null
  if (!(region && isRegionBigEnough(region.rect))) {
    state.setRegion(null)
    useViewer.getState().setPointedIds(null)
    return
  }
  const rect = region.rect
  const surface = press.surface
  state.setRegion({ ...region, settled: true, flashKey: region.flashKey + 1 })
  if (state.playful) triggerSFX('sfx:snapshot-capture')
  const cropController = new AbortController()
  const crop = captureRegionCrop(rect, surface, cropController.signal).then(
    (value) => value,
    (error) => {
      console.debug(
        '[point-ask] no picture of the region:',
        error instanceof Error ? error.message : error,
      )
      return null
    },
  )
  const { ids, more } = elementsInRegion(rect, surface)
  const release = { x: event.clientX, y: event.clientY }
  const click = nearestEdgePoint(rect, release)
  const hit = regionCenterHit(rect, surface)
  const three = surface === '3d' ? getEditorThreeContext() : null
  const bounds = viewportRect(surface)
  const rayFn =
    surface === '2d'
      ? (x: number, y: number) => cameraRay(x, y, '2d')
      : three && bounds
        ? (() => {
            const camera = three.camera.clone()
            camera.updateMatrixWorld(true)
            return makeCameraRay(camera, bounds)
          })()
        : (x: number, y: number) => cameraRay(x, y, '3d')
  const footprint = regionFootprint(rect, rayFn, hit)
  const camera = currentCamera(surface, hit.point) ?? press.camera
  openBubble(
    [],
    hit,
    'region',
    { ...press, camera, crop, cropController },
    { rect, click, ids, more },
    undefined,
    { viewport: surface },
  )
  const opened = usePointAsk.getState().bubble
  if (opened) {
    regionFootprintBuilders.set(opened.capturedAt, (point, normal) =>
      regionFootprint(rect, rayFn, { point, normal }),
    )
    if (footprint) state.patchBubble({ footprint })
  }
}

function onPointerMove(event: PointerEvent) {
  const point = usePointAsk.getState()
  const surface = point.active ? surfaceForEventTarget(event.target) : null
  if (point.active && !down) {
    lastPointer = surface ? { x: event.clientX, y: event.clientY, surface } : null
    if (!surface) {
      if (point.hover) {
        point.setHover(null)
        useViewer.getState().setHoveredId(null)
      }
    } else if (surface === '2d') {
      lastEvent = null
      const hover = pickAt2DPoint(event.clientX, event.clientY)
      point.setHover(hover)
      useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
    } else if (useEditor.getState().isFirstPersonMode) {
      lastEvent = null
      const hover = pickAtPoint(event.clientX, event.clientY)
      point.setHover(hover)
      useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
    }
  }
  if (!down) return
  if (!down.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) {
    down.moved = true
    down.cropController?.abort()
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
    updateRegionDrag(press, event)
    finishRegion(press, event)
    return
  }
  handleClick(press, event.shiftKey || press.shift)
}

/** A native click that follows a press this mode took must not reach the scene. */
function swallowCanvasClick(event: MouseEvent) {
  if (!usePointAsk.getState().active) return
  if (surfaceForEventTarget(event.target) !== null) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

function freePointHit(x: number, y: number, surface: PointViewport): PointHit {
  if (surface === '2d') {
    const floorplan = getEditorFloorplanContext()
    const point = floorplan?.screenToWorld(x, y)
    const planeY = floorplan?.getLevelY() ?? levelFloorY()
    return { point: point ?? [0, planeY, 0], normal: [0, 1, 0] }
  }
  const three = getEditorThreeContext()
  const rect = canvasRect('3d')
  if (three && rect) {
    three.raycaster.setFromCamera(
      new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
      three.camera,
    )
    for (const hit of three.raycaster.intersectObjects([...sceneRegistry.nodes.values()], true)) {
      let object: Object3D | null = hit.object
      let hidden = false
      for (; object; object = object.parent) {
        if (!object.visible) {
          hidden = true
          break
        }
      }
      if (hidden) continue
      const normal = hit.face?.normal
        .clone()
        .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
      return {
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: normal ? [normal.x, normal.y, normal.z] : [0, 1, 0],
      }
    }
  }
  const planeY = levelFloorY()
  const ray = cameraRay(x, y, '3d')
  const t = ray && ray.direction[1] < -1e-6 ? (planeY - ray.origin[1]) / ray.direction[1] : null
  const point: [number, number, number] =
    ray && t !== null && t >= 0 && t <= 200
      ? [ray.origin[0] + ray.direction[0] * t, planeY, ray.origin[2] + ray.direction[2] * t]
      : ray
        ? [
            ray.origin[0] + ray.direction[0] * 6,
            ray.origin[1] + ray.direction[1] * 6,
            ray.origin[2] + ray.direction[2] * 6,
          ]
        : (cameraPoseStore.getState().pose?.target ?? [0, planeY, 0])
  return { point, normal: [0, 1, 0] }
}

function localClickRect(x: number, y: number, surface: PointViewport): Rect | null {
  const bounds = viewportRect(surface) ?? canvasRect(surface)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const w = Math.min(240, bounds.width)
  const h = Math.min(180, bounds.height)
  const x0 = Math.max(bounds.left, Math.min(x - w / 2, bounds.right - w))
  const y0 = Math.max(bounds.top, Math.min(y - h / 2, bounds.bottom - h))
  return { x0, y0, x1: x0 + w, y1: y0 + h }
}

function freeLocationLabel(
  hit: PointHit,
  surface: PointViewport,
  screenPoint?: { x: number; y: number },
): string {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const levelId = useViewer.getState().selection.levelId
  if (surface === '2d' && screenPoint) {
    const planHit = getEditorFloorplanContext()?.pickAtScreenPoint(screenPoint.x, screenPoint.y)
    const roomId = planHit?.roomZoneId
    const roomName = roomId ? (nodes[roomId] as { name?: string } | undefined)?.name?.trim() : ''
    if (roomName) return roomName
  }
  if (levelId) {
    const roomKey =
      resolveEditorRoomHit(null, levelId, [hit.point[0], hit.point[2]], '3d') ??
      resolvePlanRoomHit(null, [hit.point[0], hit.point[2]])
    const roomNode = roomKey ? nodes[roomKey.zoneId] : undefined
    const roomName = (roomNode as { name?: string } | undefined)?.name?.trim()
    if (roomName) return roomName
    const level = nodes[levelId] as { name?: string; level?: number } | undefined
    const levelName =
      level?.name?.trim() || (level?.level !== undefined ? `Level ${level.level}` : '')
    if (levelName) return levelName
  }
  return 'Point'
}

function handleClick(press: Down, shift: boolean) {
  const state = usePointAsk.getState()
  const hover = press.hover
  const surface = press.surface
  if (!hover) {
    press.cropController?.abort()
    if (!freeClick) {
      if (state.bubble) closeBubble('dismiss')
      return
    }
    const hit = freePointHit(press.x, press.y, surface)
    const locationLabel = freeLocationLabel(hit, surface, { x: press.x, y: press.y })
    const frame = viewportRect(surface) ?? canvasRect(surface)
    const rect = localClickRect(press.x, press.y, surface)
    const cropController = rect ? new AbortController() : undefined
    const capture: Promise<SessionCrop | null> = rect
      ? captureRegionCrop(rect, surface, cropController?.signal)
      : Promise.resolve(null)
    const crop = capture.then(
      (value) => value,
      (error) => {
        console.debug('[point-ask] no picture:', error instanceof Error ? error.message : error)
        return null
      },
    )
    const camera = currentCamera(surface, hit.point) ?? press.camera
    openBubble([], hit, 'click', { ...press, camera, crop, cropController }, undefined, undefined, {
      locationLabel,
      viewport: surface,
      ...(rect && frame ? { region: regionFractions(rect, frame) } : {}),
    })
    return
  }
  const bubble = state.bubble
  if (bubble && shift) {
    press.cropController?.abort()
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
  openBubble([hover.target], hover.hit, 'click', press, undefined, undefined, {
    viewport: surface,
  })
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
let lastPointer: { x: number; y: number; surface: PointViewport } | null = null

function replayHover() {
  const state = usePointAsk.getState()
  if (lastPointer?.surface === '2d') {
    const hover = pickAt2DPoint(lastPointer.x, lastPointer.y)
    state.setHover(hover)
    useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
    return
  }
  if (lastPointer?.surface === '3d' && useEditor.getState().isFirstPersonMode) {
    const hover = pickAtPoint(lastPointer.x, lastPointer.y)
    state.setHover(hover)
    useViewer.getState().setHoveredId((hover?.target.id as AnyNodeId | undefined) ?? null)
    return
  }
  if (!lastEvent) return
  const hover = hoverFromEvent(lastEvent)
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
    if (
      state.cardFor &&
      state.pins[state.cardFor]?.behavior === 'persistent' &&
      document.querySelector('[role="dialog"][aria-modal="true"]')
    )
      return
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
      openBubble([state.hover.target], state.hover.hit, 'click', null, undefined, undefined, {
        viewport: state.hover.viewport,
      })
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
  // In walkthrough, C acts as a clean latch toggle so pointer lock releases without hold-peek.
  if (useEditor.getState().isFirstPersonMode) {
    if (enterPointMode(true)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    return
  }
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

/**
 * The chat has taken the ask: the scene as it stands now is the "before" of its turn. Taken here and
 * not at the chat's first "working", which comes from the stream and can follow the turn's first
 * write. An ask the chat queued behind another turn is marked when its own turn starts.
 */
function markAccepted(askId: string) {
  const marks = askMarks.get(askId)
  const pin = usePointAsk.getState().pins[askId]
  if (marks && marks.start === null && pin && pin.model.state !== 'queued') marks.start = markNow()
}

const askMarks = new Map<
  string,
  { start: HistoryMark | null; end: HistoryMark | null; undoneSteps: number; undone: boolean }
>()

/**
 * Sends the bubble's ask: the pin plants on the frame of Enter and the bubble folds into it; the
 * handoff to the chat follows (after the crop, up to 1.5 s ordinarily or 12 s for an enriched
 * region), and a refusal brings the bubble back with its words and the reason.
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
  const surface = bubble.viewport ?? preferredPointViewport() ?? '3d'
  const is2d = surface === '2d'
  // closeBubble removes downCrops[capturedAt]; retain the pending crop promise for every send.
  const freeEnriched = !is2d && !area && freeClick && bubble.targets.length === 0 && enrichedRegions
  const waitEnriched = !is2d && ((Boolean(area) && enrichedRegions) || freeEnriched)
  const pendingCrop = downCrops.get(bubble.capturedAt)
  const pendingController = cropControllers.get(bubble.capturedAt)
  const buildFootprint = regionFootprintBuilders.get(bubble.capturedAt)
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
      : (first?.name ?? bubble.locationLabel ?? 'Point')
  state.addPin({
    model,
    anchor: bubble.anchor,
    ...(bubble.footprint ? { footprint: bubble.footprint } : {}),
    local,
    label,
    levelId: useViewer.getState().selection.levelId ?? null,
    retireAt: null,
    createdAt: Date.now(),
    ...(bubble.crop.state === 'ready' ? { before: bubble.crop } : {}),
  })
  askMarks.set(askId, { start: null, end: null, undoneSteps: 0, undone: false })
  const restore = bubble
  // "Change more": the earlier pin gives way to this ask's, which now stands where it stood.
  const changes = bubble.changesAsk?.askId
  if (changes) state.patchPin(changes, { supersededBy: askId })
  closeBubble('send')
  state.dispatchPin(askId, { type: 'sent' })

  // Ordinary crops wait briefly; enriched regions allow their full correlated capture budget.
  let crop = bubble.crop
  if (crop.state === 'pending') {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = pendingCrop
      ? await Promise.race([
          pendingCrop,
          new Promise<null>((resolve) => {
            timer = setTimeout(
              () => {
                pendingController?.abort()
                resolve(null)
              },
              waitEnriched ? ENRICHED_CROP_WAIT_MS : CROP_WAIT_MS,
            )
          }),
        ]).finally(() => clearTimeout(timer))
      : null
    crop = waited
      ? {
          state: 'ready',
          dataUrl: waited.dataUrl,
          width: waited.width,
          height: waited.height,
          marked: false,
          ...(waited.enriched ? { enriched: waited.enriched } : {}),
        }
      : { state: 'failed' }
  }
  const enriched = (area || freeEnriched) && crop.state === 'ready' ? crop.enriched : undefined
  if (enriched) {
    const ids = visibleNodeIds(enriched)
    usePointAsk.setState((state) => {
      const pin = state.pins[askId]
      if (!pin) return state
      const nextAnchor = area ? (enriched.world.center ?? pin.anchor) : pin.anchor
      const nextFootprint =
        area && enriched.world.center
          ? alignFootprintToCenter(
              enriched.world.center,
              pin.footprint,
              restore.hit.normal,
              buildFootprint,
            )
          : undefined
      return {
        pins: {
          ...state.pins,
          [askId]: {
            ...pin,
            model: { ...pin.model, targetIds: ids },
            ...(area
              ? {
                  anchor: nextAnchor,
                  ...(nextFootprint ? { footprint: nextFootprint } : {}),
                  label: regionLabel(ids.length),
                }
              : {}),
            before: crop,
          },
        },
      }
    })
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
    ...(area || enriched
      ? {
          inRegion: enriched
            ? {
                ids: visibleNodeIds(enriched),
                more: 0,
                visible: enriched.visible,
                world: enriched.world,
                rooms: enriched.rooms,
              }
            : { ids: area!.ids, more: area!.more },
        }
      : {}),
    camera: enriched?.camera ??
      bubble.camera ??
      currentCamera(surface, bubble.anchor) ?? {
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
            ...(enriched
              ? {
                  segmented: enriched.segmented,
                  legend: enriched.legend,
                  legendText: enriched.legendText,
                }
              : {}),
          },
        }
      : {}),
  })
  const submit = { askId, text: words, context, from }
  usePointAsk.getState().patchPin(askId, { submit })
  const result = await submitPointAsk(submit)
  if (result.ok) {
    markAccepted(askId)
    if (changes) {
      usePointAsk.getState().dispatchPin(changes, { type: 'keep' })
      usePointAsk.getState().removePin(changes)
      askMarks.delete(changes)
    }
    return
  }
  // The chat did not take it: the pin goes, and the bubble returns with the reason and the words.
  usePointAsk.getState().removePin(askId)
  if (changes) usePointAsk.getState().patchPin(changes, { supersededBy: undefined })
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
  const points =
    boxes.length === 0 && pin.footprint?.corners.length ? pin.footprint.corners : [pin.anchor]
  const box =
    boxes.length > 0
      ? {
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
      : {
          min: [
            Math.min(...points.map((p) => p[0])) - 1.5,
            Math.min(...points.map((p) => p[1])) - 1,
            Math.min(...points.map((p) => p[2])) - 1.5,
          ] as [number, number, number],
          max: [
            Math.max(...points.map((p) => p[0])) + 1.5,
            Math.max(...points.map((p) => p[1])) + 1,
            Math.max(...points.map((p) => p[2])) + 1.5,
          ] as [number, number, number],
        }
  // The person asked to look: Follow Pascal must not take the camera back while it flies there.
  useFollowPascal.getState().pause()
  emitter.emit('camera-controls:apply-pose', sceneViewPose(box, {}))
}

/** The picture of what the turn made, from the same view when the camera has not moved: the card's "after". */
async function captureAfter(askId: string) {
  const pin = usePointAsk.getState().pins[askId]
  if (!pin) return
  const surface: PointViewport = viewportRect('3d') ? '3d' : viewportRect('2d') ? '2d' : '3d'
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const boxes = pin.model.targetIds.flatMap((id) => {
    const box = worldBoxOf(nodes, id)
    const rect = box ? projectBoxIn(box, surface) : null
    return rect ? [rect] : []
  })
  const rect =
    boxes.length > 0
      ? boxes.reduce((all, r) => ({
          x0: Math.min(all.x0, r.x0),
          y0: Math.min(all.y0, r.y0),
          x1: Math.max(all.x1, r.x1),
          y1: Math.max(all.y1, r.y1),
        }))
      : null
  if (!rect) return
  try {
    const crop =
      surface === '2d'
        ? await getEditorFloorplanContext()?.captureCrop(rect)
        : await captureViewCrop(rect)
    if (!crop) return
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

/**
 * Try again: the same words and context go as a new ask, planted where the old pin was. After an
 * error the new pin replaces the old; from the chat a finished ask keeps its pin. False when the pin
 * is gone (a reload, an ask of a collaborator's): the caller sends the words again without one.
 */
export async function retryAsk(askId: string): Promise<boolean> {
  const state = usePointAsk.getState()
  const old = state.pins[askId]
  const next = newAskId()
  const plan = old ? planRetry(old, next, Date.now()) : null
  if (!plan) return false
  state.addPin(plan.pin)
  if (!plan.keepOld) state.removePin(askId)
  state.openCard(null)
  askMarks.set(next, { start: null, end: null, undoneSteps: 0, undone: false })
  state.dispatchPin(next, { type: 'sent' })
  const result = await submitPointAsk(plan.submit)
  if (result.ok) {
    markAccepted(next)
    return true
  }
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
  return true
}

// ─── the card: change more, and the scene as it was ─────────────────────────

/**
 * "Change more": the done pin's bubble opens again on the same elements (a fresh view and picture
 * of them, the field focused, chips that move on) and sends as its own ask. The pin gives way while
 * the bubble is open, and goes when the new ask is taken.
 */
export function changeMore(askId: string): boolean {
  const state = usePointAsk.getState()
  const pin = state.pins[askId]
  if (!pin) return false
  const targets = pin.model.targetIds
    .map((id) => targetFor(id))
    .filter((target): target is BubbleTarget => target !== null)
    .slice(0, MAX_TARGETS)
  if (targets.length === 0) return false
  if (!state.active && !enterPointMode(true)) return false
  endCompare()
  if (usePointAsk.getState().bubble) closeBubble('dismiss')
  const surface = usePointAsk.getState().cardViewport ?? preferredPointViewport() ?? '3d'
  state.openCard(null)
  const boxes = targets.flatMap((target) => {
    const projected = target.box ? projectBoxIn(target.box, surface) : null
    return projected ? [projected] : []
  })
  const rect =
    boxes.length > 0
      ? boxes.reduce((all, r) => ({
          x0: Math.min(all.x0, r.x0),
          y0: Math.min(all.y0, r.y0),
          x1: Math.max(all.x1, r.x1),
          y1: Math.max(all.y1, r.y1),
        }))
      : null
  const cropPromise =
    rect && surface === '2d'
      ? getEditorFloorplanContext()?.captureCrop(rect)
      : rect
        ? captureViewCrop(rect)
        : null
  const crop = cropPromise
    ? cropPromise.then(
        (value) => value,
        () => null,
      )
    : Promise.resolve(null)
  openBubble(
    targets,
    { point: pin.anchor, normal: [0, 1, 0] },
    targets.length > 1 ? 'multi' : 'click',
    { crop, capturedAt: new Date().toISOString(), camera: currentCamera(surface, pin.anchor) },
    undefined,
    { askId, after: pin.model.text },
    { viewport: surface },
  )
  return true
}

/** The scene as it was before the ask's turn: the state Undo would restore, null once it cannot. */
function beforeAsk(askId: string): SceneSnapshot | null {
  const marks = askMarks.get(askId)
  if (!(marks?.start && usePointAsk.getState().pins[askId]) || marks.undone) return null
  const past = useScene.temporal.getState().pastStates as unknown as SceneSnapshot[]
  return stateAfterMark(past, marks.start)
}

// Only a turn that is writing swallows a preview. One that has been sent and not started cannot
// (its first write lets go of the preview itself), and one that is waiting on the person is not
// writing: a stuck "sent" pin must not shut every hold for good.
const TURN_WRITING = new Set(['working'])
const COMPARE_REFUSAL_MS = 3500

const compare = createCompare({
  before: beforeAsk,
  // A pin that says "working" while the chat is idle never heard its turn end: it is not writing.
  turnsWorking: () => {
    const state = usePointAsk.getState()
    return state.busy && Object.values(state.pins).some((pin) => TURN_WRITING.has(pin.model.state))
  },
  begin: beginScenePreview,
  onChange: (askId) => usePointAsk.getState().setComparing(askId),
})

/** Shows the scene as it was before that ask's turn, until `endCompare`. False when it may not. */
export function startCompare(askId: string) {
  const started = compare.start(askId)
  const reason = compare.refusal()
  const state = usePointAsk.getState()
  if (started || !reason) {
    state.setCompareRefusal(null)
    return started
  }
  state.setCompareRefusal({ askId, reason })
  setTimeout(() => {
    const refusal = usePointAsk.getState().compareRefusal
    if (refusal?.askId === askId && refusal.reason === reason) {
      usePointAsk.getState().setCompareRefusal(null)
    }
  }, COMPARE_REFUSAL_MS)
  return false
}

/** Lets go: the live scene is back. Idempotent, so every way out can call it. */
export const endCompare = () => compare.end()

/**
 * A hold that keeps its release by pointer capture (the pin) cannot see the pointer leave: it ends
 * when the pointer has drifted `radius` px from where it pressed.
 */
export function endCompareWhenPointerDrifts(origin: { x: number; y: number }, radius: number) {
  const watch = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > radius) endCompare()
  }
  const stop = () => {
    window.removeEventListener('pointermove', watch, true)
    off()
  }
  window.addEventListener('pointermove', watch, true)
  const off = usePointAsk.subscribe((state) => {
    if (state.comparing === null) stop()
  })
}

// ─── the chat's word on a turn, and the scene's commits ─────────────────────

/**
 * The ask whose turn is running: the last one the chat reported "working", until it ends. Only its
 * pin takes the scene's commits. A pin that says "working" and never heard its end is an older turn
 * that is not running, and must not absorb this one's changes.
 */
let runningAskId: string | null = null

/**
 * Pins that said "working" or "asking" for a turn the chat has moved past end, unfinished. `running`
 * is the ask that is working now; none when the chat is idle.
 */
function settleStalePins(running: string | null) {
  const state = usePointAsk.getState()
  for (const askId of state.pinOrder) {
    if (askId === running) continue
    const model = state.pins[askId]?.model
    if (model && (model.state === 'working' || model.state === 'needs-input')) {
      state.dispatchPin(askId, {
        type: 'status',
        status: {
          askId,
          status: 'ended',
          outcome: 'cancelled',
          asked: false,
          wroteScene: false,
        },
      })
    }
  }
}

/**
 * The chat has no turn running: an ask that still says "working" never heard its end, and the next
 * turn (a plain message, say) is not its. Called by the host's busy flag going false.
 */
export function chatWentIdle() {
  runningAskId = null
  settleStalePins(null)
}

function onStatus(status: PointAskStatus) {
  // A turn starting to write while the before is held would be swallowed by it.
  if (status.status === 'working' || status.status === 'queued') endCompare()
  const state = usePointAsk.getState()
  const pin = state.pins[status.askId]
  if (!pin) return
  if (status.status === 'working') {
    runningAskId = status.askId
    settleStalePins(status.askId)
  }
  const marks = askMarks.get(status.askId)
  if (status.status === 'queued' && marks) marks.start = null
  if (status.status === 'working' && marks && marks.start === null) marks.start = markNow()
  state.dispatchPin(status.askId, { type: 'status', status })
  if (status.status === 'ended') {
    if (runningAskId === status.askId) runningAskId = null
    if (marks) marks.end = markNow()
    state.patchPin(status.askId, { retireAt: null })
    const settled = usePointAsk.getState().pins[status.askId]
    if (settled?.model.state === 'done') void captureAfter(status.askId)
  }
}

function onCommit(commit: SceneCommit) {
  if (!runningAskId) return
  const state = usePointAsk.getState()
  const pin = state.pins[runningAskId]
  if (pin?.model.state !== 'working') return
  const event = pointCommitEvent(commit, pin.model.targetIds)
  if (event) state.dispatchPin(runningAskId, event)
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
export function startPointAskSession(
  options: { enrichedRegions?: boolean; freeClick?: boolean } = {},
): () => void {
  // PointAskLayer is single-instance in the editor; still copy updated flags before returning
  // the existing teardown so remounts or duplicate callers never keep stale options.
  enrichedRegions = options.enrichedRegions === true
  freeClick = options.freeClick === true
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
  // A hold on the "before" ends on any way out: a key (Cmd+S, Cmd+Z, Delete are not for a preview),
  // the window or tab losing focus, the page going away.
  listen('keydown', (event) => {
    if (!event.repeat) endCompare()
  })
  listen('pointerup', endCompare)
  listen('blur', endCompare, false)
  listen('pagehide', endCompare, false)
  listen('pointercancel', endCompare)
  const onHidden = () => {
    if (document.hidden) endCompare()
  }
  document.addEventListener('visibilitychange', onHidden)
  offs.push(() => document.removeEventListener('visibilitychange', onHidden))
  // The scene lets go of a preview itself when something is about to write: the tag follows.
  offs.push(
    subscribeScenePreview((previewing) => {
      if (!previewing) compare.released()
    }),
  )
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
      const hasScene = isViewVisible(state, VIEW_3D) || isViewVisible(state, VIEW_2D)
      if (
        !hasScene ||
        state.isPreviewMode ||
        state.isCaptureMode ||
        state.workspaceMode !== 'edit'
      ) {
        leavePointMode()
        return
      }
      if (state.isFirstPersonMode && !prev.isFirstPersonMode) {
        leavePointMode()
        return
      }
      const point = usePointAsk.getState()
      if (point.hover?.viewport && !viewportRect(point.hover.viewport)) {
        point.setHover(null)
        useViewer.getState().setHoveredId(null)
      }
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
    endCompare()
    for (const off of offs) off()
    down?.cropController?.abort()
    down = null
    for (const controller of cropControllers.values()) controller.abort()
    cropControllers.clear()
    leavePointMode()
    downCrops.clear()
    regionFootprintBuilders.clear()
    runningAskId = null
    enrichedRegions = false
    freeClick = false
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
