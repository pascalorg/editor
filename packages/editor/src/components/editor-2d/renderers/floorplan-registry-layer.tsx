'use client'

import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  type FloorplanAffordanceSession,
  type FloorplanGeometry,
  type FloorplanPalette,
  type FloorplanPoint,
  type GeometryContext,
  isRegistryMovable,
  kindsWithFloorplanScope,
  type LiveNodeOverrides,
  type LiveTransform,
  nodeRegistry,
  pauseSceneHistory,
  resolveBuildingForLevel,
  resumeSceneHistory,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ROTATE_HANDLE_DRAG_LABEL } from '../../../lib/contextual-help'
import {
  canDirectRotateNode,
  resolveDirectRotationDragDelta,
  resolveDirectRotationPatch,
  snapDirectRotationDelta,
} from '../../../lib/direct-manipulation'
import { createEditorApi } from '../../../lib/editor-api'
import { clientToPlan } from '../../../lib/floorplan/plan-coords'
import {
  type ActiveInteractionScope,
  boundaryReshapeScope,
  controlPointReshapeScope,
  curveReshapeScope,
  endpointReshapeScope,
  holeEditScope,
  tangentReshapeScope,
} from '../../../lib/interaction/scope'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { clearSurfacePlanSnapFeedback } from '../../../lib/surface-plan-snap'
import useDirectManipulationFeedback from '../../../store/use-direct-manipulation-feedback'
import useEditor from '../../../store/use-editor'
import useInteractionScope, {
  useEndpointReshape,
  useMovingNode,
} from '../../../store/use-interaction-scope'
import { startGroupPickUp } from '../../editor/group-actions'
import { classifyParticipant } from '../../editor/group-transform-shared'
import { suppressBoxSelectForPointer } from '../../tools/select/box-select-state'
import {
  FloorplanGroupSelectionBox,
  startFloorplanGroupMove,
  startFloorplanGroupRotate,
} from '../floorplan-group-move'
import { useFloorplanRender } from '../floorplan-render-context'
import { FloorplanGeometryRenderer } from './floorplan-geometry-renderer'

/**
 * Registry-driven floor-plan layer.
 *
 * For every node in the active level whose definition exposes
 * `def.floorplan`, builds a `GeometryContext` (with `viewState` so the
 * kind can theme its output), calls the builder, and walks the resulting
 * tree. Static primitives (polygon / line / circle / etc.) defer to
 * `<FloorplanGeometryRenderer>`. Interactive primitives — `hatch`,
 * `hit-line`, `endpoint-handle`, `dimension-label` — render here so they
 * can access the SVG context for pointer events + units-per-pixel.
 *
 * Selection: clicking the entry's `<g>` selects the node. The wall
 * `def.floorplan` also emits a `hit-line` along the centerline so the
 * user can grab the wall body even at zoom levels where the polygon is
 * skinny.
 *
 * 2D endpoint drag: when an `endpoint-handle` is pointer-downed and its
 * `affordance === 'move-endpoint'`, this layer drives the legacy wall
 * endpoint flow inline — snap pointer to walls/grid, run linked-wall
 * cascade, live-update positions with history paused, single undo on
 * commit. The kind-generic abstraction lands once fence + slab + ceiling
 * pick up their 2D drags too (next iteration).
 */
// Handle / hit-area sizes mirror the legacy `FLOORPLAN_ENDPOINT_HANDLE_*`
// constants in floorplan-panel.tsx. Sizes are in screen pixels — the
// dispatcher multiplies by `unitsPerPixel` so handles stay the same on-
// screen size at any zoom.
const ENDPOINT_HANDLE_SELECTED_RADIUS_PX = 8
const ENDPOINT_HANDLE_ACTIVE_RADIUS_PX = 9
const ENDPOINT_HANDLE_DOT_RADIUS_PX = 3
const ENDPOINT_HANDLE_ACTIVE_DOT_RADIUS_PX = 4
const ENDPOINT_HIT_STROKE_WIDTH_PX = 18
const ENDPOINT_HOVER_GLOW_STROKE_WIDTH_PX = 16
const ENDPOINT_HOVER_RING_STROKE_WIDTH_PX = 7
const HOVER_TRANSITION = 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)'
const DIRECT_DRAG_THRESHOLD_PX = 4
const DIRECT_ROTATE_EPSILON = 1e-6
const DIRECT_ROTATE_RADIANS_PER_PIXEL = Math.PI / 180

/**
 * Snapshot of node fields captured at drag-start, used by the single-undo
 * dance to revert untracked before re-applying as a single tracked
 * change. The dispatcher only knows about the `affectedIds` the
 * affordance declares; it captures whatever fields exist on each node by
 * cloning the full record minus the registry-managed `id` / `type`.
 */
type NodeSnapshot = { id: AnyNodeId; data: Record<string, unknown> }

type ActiveDrag = {
  pointerId: number
  /** Key for the visual `active` flag — e.g. `${nodeId}:${endpoint}`. */
  handleId: string
  session: FloorplanAffordanceSession
  snapshots: NodeSnapshot[]
  historyPaused: boolean
  /**
   * Set only for rotate-arrow drags (handles that carry a `pivot`). Drives
   * the live angle wedge + degree readout — the 2D twin of the 3D rotate
   * gizmo's readout. The bearing sweep is measured the same way every
   * rotate affordance measures it: `atan2(pointer − pivot)`.
   */
  rotation?: { pivot: FloorplanPoint; initialAngle: number; radius: number }
  /**
   * Node id of the reshaping scope this drag began (boundary / curve / endpoint
   * edits), so the matching `endIf` on release/cancel tears down exactly this
   * scope. Unset for affordances that drive no snapping scope (resize / rotate).
   */
  reshapeScopeNodeId?: string
}

// Map a floor-plan affordance to the reshaping scope it represents, so the
// dispatcher can drive the contextual snapping HUD (the chip) AND make
// `getActiveSnapContext()` resolve the right mode-set during the edit. Geometry
// edits that set a direction/shape map to a scope; resize / rotate / body-move
// affordances return `null` (no polygon/wall snapping chip). Keyed off the
// affordance name the kinds register (`move-vertex` / `move-edge` / `add-vertex`
// / `curve` / `move-endpoint`).
function affordanceReshapeScope(
  affordance: string,
  nodeId: string,
  payload: unknown,
): ActiveInteractionScope | null {
  if (affordance.includes('vertex') || affordance.includes('edge')) {
    const holeIndex = (payload as { holeIndex?: number } | undefined)?.holeIndex
    return holeIndex !== undefined
      ? holeEditScope({ nodeId, holeIndex })
      : boundaryReshapeScope(nodeId)
  }
  if (affordance.includes('curve')) {
    return curveReshapeScope(nodeId)
  }
  if (affordance.includes('control-point')) {
    const index = (payload as { index?: number } | undefined)?.index ?? 0
    return controlPointReshapeScope(nodeId, index)
  }
  if (affordance.includes('tangent')) {
    const target = payload as { index?: number; side?: 'in' | 'out' } | undefined
    return tangentReshapeScope(nodeId, target?.index ?? 0, target?.side ?? 'out')
  }
  if (affordance.includes('endpoint')) {
    const endpoint = (payload as { endpoint?: 'start' | 'end' } | undefined)?.endpoint ?? 'end'
    return endpointReshapeScope(nodeId, endpoint)
  }
  // Roof-segment width/depth resize — a no-angle dimension edit, so the
  // no-angle 'polygon' snap set (grid / lines / off) via a boundary scope.
  // Matched exactly so a still-legacy `*-resize` affordance on another kind
  // doesn't get a chip its snap math can't honour yet.
  if (affordance === 'roof-segment-resize') {
    return boundaryReshapeScope(nodeId)
  }
  // 2D corner rotate-arrow (column / elevator / roof-segment / shelf / spawn /
  // stair). Begin the same handle-drag scope the 3D rotate gizmo uses, label-
  // matched, so the contextual HUD shows the "Shift = rotate freely" hint over
  // the drag. The affordance applies the 15° angle step itself.
  if (affordance.includes('rotate')) {
    return { kind: 'handle-drag', nodeId, handle: ROTATE_HANDLE_DRAG_LABEL }
  }
  return null
}

/**
 * Transient live-rotation readout state. Rebuilt each pointer-move while a
 * rotate-arrow is dragged and cleared on release. World-plan coords.
 */
type RotationOverlayState = {
  pivot: FloorplanPoint
  startAngle: number
  endAngle: number
  radius: number
  /** Swept magnitude in radians, for the degree chip. */
  sweep: number
}

type FloorplanEntryDescriptor = {
  id: AnyNodeId
  node: AnyNode
  dependsOnSiblingInputs: boolean
  ctxOverrides?: FloorplanContextOverrides
}

type NodeDeps = {
  node: AnyNode
  live: LiveTransform | undefined
  selected: boolean
  highlighted: boolean
  hovered: boolean
  moving: boolean
  liveOverride: LiveNodeOverrides | undefined
  palette: FloorplanPalette | undefined
  siblingEpoch: number
  committedNodes: Record<string, AnyNode> | null
  interactiveElevators: unknown
}

type CacheEntry = {
  deps: NodeDeps
  base: FloorplanGeometry | null
  overlay: FloorplanGeometry | null
  node: AnyNode
}

type LevelDataCacheEntry = {
  nodes: Record<string, AnyNode>
  liveOverrides: Map<string, LiveNodeOverrides>
  ids: readonly AnyNodeId[]
  value: unknown
}

type FloorplanContextOverrides = {
  children: AnyNode[]
  siblings: AnyNode[]
  parent: AnyNode | null
}

type FloorplanLevelDataHook = (args: {
  siblings: ReadonlyArray<AnyNode>
  nodes: Record<string, AnyNode>
}) => unknown

type FloorplanRenderPass = 'base' | 'overlay'

const POINTER_CURSOR_STYLE = { cursor: 'pointer' } as const
// Group members advertise the drag-to-move-the-selection gesture.
const MOVE_CURSOR_STYLE = { cursor: 'move' } as const
const NO_POINTER_EVENTS_STYLE = { pointerEvents: 'none' } as const

function snapshotNode(node: AnyNode): NodeSnapshot {
  // Shallow-clone every non-id, non-type field. Arrays / vec tuples are
  // deep-cloned to detach from the live store reference.
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'type' || key === 'object' || key === 'parentId') continue
    data[key] = Array.isArray(value) ? [...(value as unknown[])] : value
  }
  return { id: node.id, data }
}

function snapshotsToUpdates(snapshots: NodeSnapshot[]) {
  return snapshots.map((s) => ({ id: s.id, data: s.data }))
}

// Stable empty sentinel used by per-entry builders while the floor plan is
// hidden; committed scene edits still flow through `useScene`.
const EMPTY_LIVE_OVERRIDES: Map<string, LiveNodeOverrides> = new Map()

export const FloorplanRegistryLayer = memo(function FloorplanRegistryLayer() {
  const selectedLevelId = useViewer((s) => s.selection.levelId)
  const selectedBuildingId = useViewer((s) => s.selection.buildingId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const activeRotateNodeId = useDirectManipulationFeedback((s) => s.activeRotateNodeId)
  const setHoveredId = useViewer((s) => s.setHoveredId)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const movingNode = useMovingNode()
  // When a building is being moved, its explicit selection may be
  // cleared as part of the move handoff. Fall back to the
  // mid-drag building id so the dimmed floor keeps rendering
  // throughout the gesture.
  const movingBuildingId =
    movingNode && nodeRegistry.get(movingNode.type)?.capabilities?.floorplanLevelContainer
      ? movingNode.id
      : null
  const ambientBuildingSourceId = selectedBuildingId ?? movingBuildingId

  // When only a building is in scope (no specific level), fall back to
  // its level 0 (or the lowest-indexed level) so the floor still
  // renders as context — dimmed and non-interactive — instead of
  // disappearing entirely.
  const ambientLevelId = useMemo<AnyNodeId | null>(() => {
    if (selectedLevelId || !ambientBuildingSourceId) return null
    const building = nodes[ambientBuildingSourceId]
    if (building?.type !== 'building') return null
    let zero: AnyNodeId | null = null
    let lowestId: AnyNodeId | null = null
    let lowestIdx = Number.POSITIVE_INFINITY
    const childIds = (building as unknown as { children?: AnyNodeId[] }).children ?? []
    for (const childId of childIds) {
      const child = nodes[childId]
      if (child?.type !== 'level') continue
      if (child.level === 0) {
        zero = child.id
        break
      }
      if (child.level < lowestIdx) {
        lowestIdx = child.level
        lowestId = child.id
      }
    }
    return zero ?? lowestId
  }, [selectedLevelId, ambientBuildingSourceId, nodes])

  const levelId = selectedLevelId ?? ambientLevelId
  const isAmbient = !selectedLevelId && !!ambientLevelId
  const renderCtx = useFloorplanRender()
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setMovingNodeOrigin = useEditor((s) => s.setMovingNodeOrigin)
  // Door / window placement (both build and move) needs the SVG's
  // background click handler to run — it finds the closest wall via
  // `findClosestWallPoint` and emits `wall:click` for the door / window
  // tool. When the user clicks *on top of* a wall in this mode, the
  // wall's registry entry would otherwise swallow the click via
  // `handleClickStop` / `handleSelect`, so the placement never fires.
  // Pass clicks through in that case.
  const editorPhase = useEditor((s) => s.phase)
  const editorMode = useEditor((s) => s.mode)
  const editorTool = useEditor((s) => s.tool)
  const structureLayer = useEditor((s) => s.structureLayer)
  const floorplanSelectionTool = useEditor((s) => s.floorplanSelectionTool)
  const endpointReshape = useEndpointReshape()
  const isOpeningPlacementActive =
    (editorPhase === 'structure' &&
      editorMode === 'build' &&
      (editorTool === 'door' || editorTool === 'window')) ||
    (movingNode != null && !!nodeRegistry.get(movingNode.type)?.capabilities?.wallOpeningPlacement)
  const isMarqueeSelectionActive =
    editorMode === 'select' &&
    floorplanSelectionTool === 'marquee' &&
    structureLayer !== 'zones' &&
    !movingNode &&
    !endpointReshape
  // While the floor plan is not on screen (pure 3D view), per-entry live
  // selectors freeze to `undefined` so drag publishes do not re-render the
  // hidden floor-plan tree.
  const floorplanVisible = useEditor((s) => s.viewMode !== '3d')
  // Elevator builders read runtime state imperatively, so entries include this
  // rare-changing ref in their cache deps.
  const interactiveElevators = useInteractive((s) => s.elevators)

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Marquee preview selection — matches the legacy `highlightedIdSet` use
  // (filter-while-marquee), surfaces selection chrome without keyboard focus.
  const highlightedIdSet = useMemo(() => new Set(previewSelectedIds), [previewSelectedIds])
  // Multi-selection: members show highlight only (per-node edit chrome hidden)
  // and transformable members advertise the drag-to-move gesture.
  const isMultiSelect = selectedIds.length > 1
  const groupParticipantIdSet = useMemo(() => {
    if (selectedIds.length < 2 || !levelId) return null
    return new Set(
      selectedIds.filter(
        (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
      ),
    )
  }, [selectedIds, levelId, nodes])

  // Interactive state lives in refs; only the visible feedback bits go
  // into React state to keep re-renders cheap during drag.
  const dragRef = useRef<ActiveDrag | null>(null)
  const [hoveredHandleId, setHoveredHandleId] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [rotationOverlay, setRotationOverlay] = useState<RotationOverlayState | null>(null)
  const geometryCacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const levelDataCacheRef = useRef<Map<string, LevelDataCacheEntry>>(new Map())
  const nodesRef = useRef(nodes)
  const [siblingEpochs, setSiblingEpochs] = useState<Map<AnyNodeId, number>>(() => new Map())
  // Per-node sibling epoch (replaces a single global epoch). Bumped only for the
  // nodes affected by this frame's live drags, so an unaffected wall/opening
  // keeps its epoch and stays cached. `prevLiveFlaggedIdsRef` remembers which
  // sibling-dependent nodes were live last frame, so a node that just STOPPED
  // being dragged (override cleared, no commit) still gets one final rebuild to
  // revert — its dependents (host wall, junction neighbours) don't carry its
  // override in their own deps.
  const nodeSiblingEpochRef = useRef<Map<AnyNodeId, number>>(new Map())
  const prevLiveFlaggedIdsRef = useRef<AnyNodeId[]>([])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const bumpAffectedSiblingEpochs = useCallback(() => {
    if (!floorplanVisible) return

    const sceneNodes = nodesRef.current
    const liveTransforms = useLiveTransforms.getState().transforms
    const liveOverrides = useLiveNodeOverrides.getState().overrides
    const liveFlaggedIds: AnyNodeId[] = []

    for (const [id] of liveTransforms) {
      const node = sceneNodes[id as AnyNodeId]
      if (node && nodeRegistry.get(node.type)?.floorplanDependsOnSiblings) {
        liveFlaggedIds.push(id as AnyNodeId)
      }
    }
    for (const [id] of liveOverrides) {
      const node = sceneNodes[id as AnyNodeId]
      if (node && nodeRegistry.get(node.type)?.floorplanDependsOnSiblings) {
        liveFlaggedIds.push(id as AnyNodeId)
      }
    }

    const expandFrom = Array.from(new Set([...liveFlaggedIds, ...prevLiveFlaggedIdsRef.current]))
    const affectedSiblingIds = computeAffectedSiblingIds(expandFrom, sceneNodes, liveOverrides)
    const nodeSiblingEpochs = nodeSiblingEpochRef.current
    for (const id of affectedSiblingIds) {
      nodeSiblingEpochs.set(id, (nodeSiblingEpochs.get(id) ?? 0) + 1)
    }
    prevLiveFlaggedIdsRef.current = liveFlaggedIds
    if (affectedSiblingIds.size > 0) {
      setSiblingEpochs(new Map(nodeSiblingEpochs))
    }
  }, [floorplanVisible])

  useEffect(() => {
    bumpAffectedSiblingEpochs()
    const unsubscribeTransforms = useLiveTransforms.subscribe(bumpAffectedSiblingEpochs)
    const unsubscribeOverrides = useLiveNodeOverrides.subscribe(bumpAffectedSiblingEpochs)
    return () => {
      unsubscribeTransforms()
      unsubscribeOverrides()
    }
  }, [bumpAffectedSiblingEpochs])

  const applyEntrySelection = useCallback(
    (id: AnyNodeId, shouldToggle: boolean) => {
      const currentSelectedIds = useViewer.getState().selection.selectedIds
      setSelection({
        selectedIds: shouldToggle
          ? currentSelectedIds.includes(id)
            ? currentSelectedIds.filter((selectedId) => selectedId !== id)
            : [...currentSelectedIds, id]
          : [id],
      })
      // Setting selection re-renders the entry — the overlay pass mounts
      // (endpoint handles, etc.), reshuffling DOM under the cursor between
      // pointerdown and click. If the click target ends up on the SVG
      // background, `<g floorplan-registry-layer onClick=handleClickStop>`
      // never sees it, and the SVG's `handleBackgroundClick` clears the
      // selection we just set. Swallow the next click globally to break
      // that race; the listener removes itself after firing (or after a
      // safety timeout if no click follows).
      swallowNextClick(200)
    },
    [setSelection],
  )

  const handleSelect = useCallback(
    (id: AnyNodeId, event: React.PointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      applyEntrySelection(id, event.metaKey || event.ctrlKey || event.shiftKey)
    },
    [applyEntrySelection],
  )

  const handleClickStop = useCallback((event: React.MouseEvent<SVGGElement>) => {
    event.stopPropagation()
  }, [])

  const startDirectMoveDrag = useCallback(
    (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>): boolean => {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false

      const node = useScene.getState().nodes[id]
      if (!node || !isRegistryMovable(node.type)) return false
      // Sole selection only: per-node direct manipulation stands down for a
      // multi-selection (the group session owns plain drags there, and Cmd is
      // the selection-toggle key — a wobbly Cmd+click must not yank one
      // member out of the group).
      const currentSelectedIds = useViewer.getState().selection.selectedIds
      if (currentSelectedIds.length !== 1 || currentSelectedIds[0] !== id) return false

      event.preventDefault()
      event.stopPropagation()

      const startX = event.clientX
      const startY = event.clientY
      const pointerId = event.pointerId
      let engaged = false

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        if (engaged) {
          useViewer.getState().setInputDragging(false)
        }
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        if (engaged) return
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY)
        if (distance < DIRECT_DRAG_THRESHOLD_PX) return

        engaged = true
        useViewer.getState().setInputDragging(true)
        swallowNextClick(300)
        createEditorApi().engageMoveDrag(node)

        requestAnimationFrame(() => {
          window.dispatchEvent(
            new PointerEvent('pointermove', {
              altKey: moveEvent.altKey,
              bubbles: true,
              buttons: moveEvent.buttons,
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              ctrlKey: moveEvent.ctrlKey,
              metaKey: moveEvent.metaKey,
              pointerId,
              pointerType: moveEvent.pointerType,
              shiftKey: moveEvent.shiftKey,
            }),
          )
        })
      }

      const onEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return
        cleanup()
        if (!engaged) {
          applyEntrySelection(id, true)
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
      return true
    },
    [applyEntrySelection],
  )

  const startDirectRotateDrag = useCallback(
    (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>): boolean => {
      if (event.button !== 2 || !(event.metaKey || event.ctrlKey)) return false

      const node = useScene.getState().nodes[id]
      if (!node || !canDirectRotateNode(node)) return false
      // Sole selection only — same stand-down as the direct move above.
      const selectedIds = useViewer.getState().selection.selectedIds
      if (selectedIds.length !== 1 || selectedIds[0] !== id) return false
      event.preventDefault()
      event.stopPropagation()

      const nodeId = node.id as AnyNodeId
      const pointerId = event.pointerId
      const startX = event.clientX
      const sceneApi = createSceneApi(useScene)
      let lastPatch: Partial<AnyNode> | null = null

      const applyDelta = (pointerEvent: PointerEvent | ReactPointerEvent<SVGGElement>) => {
        const delta = resolveDirectRotationDragDelta(
          startX,
          pointerEvent.clientX,
          DIRECT_ROTATE_RADIANS_PER_PIXEL,
          pointerEvent.shiftKey,
        )
        if (Math.abs(delta) < DIRECT_ROTATE_EPSILON) {
          lastPatch = null
          useLiveNodeOverrides.getState().clear(nodeId)
          useScene.getState().markDirty(nodeId)
          return
        }
        const patch = resolveDirectRotationPatch(node, delta, sceneApi)
        if (!patch) return
        lastPatch = patch
        useLiveNodeOverrides.getState().set(nodeId, patch as Record<string, unknown>)
        useScene.getState().markDirty(nodeId)
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onCancel, true)
        window.removeEventListener('contextmenu', preventContextMenu, true)
        useLiveNodeOverrides.getState().clear(nodeId)
        useScene.getState().markDirty(nodeId)
        resumeSceneHistory(useScene)
        useDirectManipulationFeedback.getState().clearActiveRotateNodeId(nodeId)
        useViewer.getState().setInputDragging(false)
        if (document.body.style.cursor === 'ew-resize') {
          document.body.style.cursor = ''
        }
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        moveEvent.stopPropagation()
        applyDelta(moveEvent)
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        upEvent.preventDefault()
        upEvent.stopPropagation()
        swallowNextClick(300)
        if (lastPatch) {
          sceneApi.update(nodeId, lastPatch)
          sfxEmitter.emit('sfx:item-place')
        }
        cleanup()
      }

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return
        cleanup()
      }

      const preventContextMenu = (contextEvent: Event) => {
        contextEvent.preventDefault()
        contextEvent.stopPropagation()
      }

      pauseSceneHistory(useScene)
      useViewer.getState().setInputDragging(true)
      useDirectManipulationFeedback.getState().setActiveRotateNodeId(nodeId)
      document.body.style.cursor = 'ew-resize'
      sfxEmitter.emit('sfx:item-pick')
      applyDelta(event)

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
      window.addEventListener('contextmenu', preventContextMenu, true)
      return true
    },
    [],
  )

  // Photoshop-style group drag: plain pointer-down on a transformable member
  // of a multi-selection slides the whole selection rigidly; a plain click
  // (no drag) enters the group pick-up instead — parity with the single-item
  // click-to-move (clicking outside still deselects). Modified clicks
  // (selection toggle) and Cmd-drag / direct-rotate keep their existing
  // paths. `immediate` engages without the drag threshold — the move-handle
  // dot's pick-up semantics.
  const startGroupMoveDrag = useCallback(
    (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>, immediate = false): boolean => {
      if (event.button !== 0) return false
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
      if (movingNode) return false
      if (useEditor.getState().mode === 'delete') return false
      const started = startFloorplanGroupMove(id, event, {
        immediate,
        onClickFallthrough: immediate ? undefined : () => startGroupPickUp(),
      })
      if (!started) return false
      event.preventDefault()
      event.stopPropagation()
      suppressBoxSelectForPointer(event)
      return true
    },
    [movingNode],
  )

  // Move-handle dot variant — routes the dot through the group session when
  // the owning node is part of a multi-selection.
  const handleGroupMoveHandlePointerDown = useCallback(
    (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>) => startGroupMoveDrag(id, event, true),
    [startGroupMoveDrag],
  )

  // The dashed selection box is itself the group's drag handle: a press
  // anywhere inside it slides the group (or picks it up on a plain click),
  // anchored on the first transformable member.
  const handleGroupBoxPointerDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>) => {
      const { selectedIds: currentIds, levelId: currentLevelId } = useViewer.getState().selection
      const sceneNodes = useScene.getState().nodes
      const anchor = currentIds.find(
        (id) =>
          classifyParticipant(sceneNodes[id as AnyNodeId], currentLevelId, sceneNodes) !== null,
      )
      if (!anchor) return
      startGroupMoveDrag(anchor as AnyNodeId, event)
    },
    [startGroupMoveDrag],
  )

  // Corner rotate handles on the dashed selection box — 15° steps, Shift
  // free, mirroring the 3D group rotate gizmo.
  const handleGroupBoxRotatePointerDown = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (useEditor.getState().mode === 'delete') return
    if (startFloorplanGroupRotate(event)) {
      event.preventDefault()
      suppressBoxSelectForPointer(event)
    }
  }, [])

  const handleEntryPointerDown = useCallback(
    (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>) => {
      if (startDirectMoveDrag(id, event)) return
      if (startDirectRotateDrag(id, event)) return
      if (startGroupMoveDrag(id, event)) return
      handleSelect(id, event)
    },
    [handleSelect, startDirectMoveDrag, startDirectRotateDrag, startGroupMoveDrag],
  )

  const floorplanData = useMemo(() => {
    if (!levelId) {
      geometryCacheRef.current.clear()
      levelDataCacheRef.current.clear()
      return {
        entries: [] as FloorplanEntryDescriptor[],
        levelNodeIdsByType: new Map<string, AnyNodeId[]>(),
      }
    }

    const out: FloorplanEntryDescriptor[] = []
    const levelNodeIdsByType = new Map<string, AnyNodeId[]>()

    const collectLevelDataKind = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      if (def?.computeFloorplanLevelData) {
        const ids = levelNodeIdsByType.get(node.type)
        if (ids) ids.push(id)
        else levelNodeIdsByType.set(node.type, [id])
      }
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) collectLevelDataKind(cid)
      }
    }

    collectLevelDataKind(levelId as AnyNodeId)

    const pushEntry = (id: AnyNodeId, node: AnyNode, ctxOverrides?: FloorplanContextOverrides) => {
      const def = nodeRegistry.get(node.type)
      if (!def?.floorplan) return
      const dependsOnSiblingInputs = !!(
        def.floorplanDependsOnSiblings || def.floorplanSiblingOverrides
      )
      const descriptor: FloorplanEntryDescriptor = { id, node, dependsOnSiblingInputs }
      if (ctxOverrides) descriptor.ctxOverrides = ctxOverrides
      out.push(descriptor)
    }

    const visit = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      pushEntry(id, node)
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(levelId as AnyNodeId)

    // Building-scoped kinds (`def.floorplanScope === 'building'`) live
    // as siblings of the level, not under it — the `visit(levelId)` DFS
    // above doesn't reach them. Walk every node of those kinds whose
    // parent matches the active level's building, and synthesise a
    // `GeometryContext` whose `parent` is the active level (so kind
    // builders that gate on the current floor — e.g. elevator service
    // range — keep working). Pure registry-driven dispatch: no kind
    // name appears in this file.
    const activeLevelNode = nodes[levelId as AnyNodeId] as AnyNode | undefined
    const activeBuildingId = activeLevelNode
      ? resolveBuildingForLevel(levelId as AnyNodeId, nodes)
      : null
    if (activeLevelNode && activeBuildingId) {
      const buildingScopedKinds = kindsWithFloorplanScope('building')
      const buildingScopedKindSet = new Set(buildingScopedKinds)
      for (const [id, node] of Object.entries(nodes)) {
        if (!node || !buildingScopedKindSet.has(node.type)) continue
        const parentId = (node as { parentId?: AnyNodeId | null }).parentId
        if (parentId !== activeBuildingId) continue
        const cid = id as AnyNodeId
        pushEntry(cid, node, {
          children: [],
          siblings: [],
          parent: activeLevelNode,
        })
      }
    }

    // Stable z-order sort. SVG renders in document order — later siblings
    // paint on top of earlier ones — so anything that should sit *under*
    // other floor-plan geometry has to come first in the entries array.
    // Zones are conceptual room/area regions; walls / slabs / furniture
    // all belong on top of them. Within a layer bucket we preserve the
    // DFS visit order (stable sort) so siblings keep their relative
    // priority.
    out.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))
    const entryIds = new Set(out.map((entry) => entry.id))
    for (const id of geometryCacheRef.current.keys()) {
      if (!entryIds.has(id as AnyNodeId)) geometryCacheRef.current.delete(id)
    }
    for (const type of levelDataCacheRef.current.keys()) {
      if (!levelNodeIdsByType.has(type)) levelDataCacheRef.current.delete(type)
    }
    return { entries: out, levelNodeIdsByType }
  }, [levelId, nodes])

  // ── Generic 2D affordance dispatch ─────────────────────────────────
  //
  // Pointer-down on an interactive handle resolves the kind's
  // `def.floorplanAffordances?.[affordance]` and starts a session. The
  // dispatcher then owns: history pause/resume, snapshot capture,
  // pointer-move/up/cancel routing, and the single-undo dance on
  // commit. Each kind owns the actual mutation logic inside `apply`.
  const startAffordanceDrag = useCallback(
    (
      nodeId: AnyNodeId,
      handleId: string,
      affordance: string,
      payload: unknown,
      event: ReactPointerEvent<SVGGElement>,
      // Present only for rotate-arrow handles — the pivot the node turns
      // around, used to drive the live angle wedge + degree readout.
      rotationPivot?: FloorplanPoint,
    ) => {
      if (event.button !== 0) return
      if (movingNode) return

      const sceneNodes = useScene.getState().nodes
      const node = sceneNodes[nodeId]
      if (!node) return

      const def = nodeRegistry.get(node.type)
      const handler = def?.floorplanAffordances?.[affordance]
      if (!handler) return

      const initialPlanPoint = clientToPlan(event.clientX, event.clientY)
      if (!initialPlanPoint) return

      event.preventDefault()
      event.stopPropagation()
      suppressBoxSelectForPointer(event)

      const session = handler.start({
        node,
        payload,
        nodes: sceneNodes,
        initialPlanPoint,
        gridSnapStep: useEditor.getState().gridSnapStep,
      })

      const snapshots: NodeSnapshot[] = []
      for (const id of session.affectedIds) {
        const n = sceneNodes[id]
        if (n) snapshots.push(snapshotNode(n))
      }

      pauseSceneHistory(useScene)

      // Rotation readout setup. The wedge radius tracks the grab distance
      // from the pivot (≈ the handle's orbit), nudged inward so the swept
      // fill reads as the handle swinging round rather than overlapping it,
      // and floored so a tight footprint still shows a legible wedge.
      let rotation: ActiveDrag['rotation']
      if (rotationPivot) {
        const dx = initialPlanPoint[0] - rotationPivot[0]
        const dz = initialPlanPoint[1] - rotationPivot[1]
        rotation = {
          pivot: rotationPivot,
          initialAngle: Math.atan2(dz, dx),
          radius: Math.max(Math.hypot(dx, dz) * 0.72, 0.25),
        }
      }

      // Begin the matching reshaping scope so the contextual snapping HUD shows
      // the right chip during the edit AND `getActiveSnapContext()` resolves the
      // polygon / wall mode-set the affordance's snap math reads. Torn down on
      // release / cancel below. `null` for resize / rotate (no snapping chip).
      const reshapeScope = affordanceReshapeScope(affordance, nodeId, payload)
      if (reshapeScope) {
        useInteractionScope.getState().begin(reshapeScope)
      }

      dragRef.current = {
        pointerId: event.pointerId,
        handleId,
        session,
        snapshots,
        historyPaused: true,
        rotation,
        reshapeScopeNodeId: reshapeScope ? nodeId : undefined,
      }
      setActiveDragId(handleId)
      setSelection({ selectedIds: [nodeId] })
      ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    },
    [movingNode, setSelection],
  )

  useEffect(() => {
    // Tear down the scope this drag opened (if any) — a reshaping scope for an
    // edit affordance, or a handle-drag scope for a rotate-arrow — matched by
    // node id so a concurrent scope from another path is never ended by mistake.
    const endReshapeScope = (drag: ActiveDrag) => {
      if (drag.reshapeScopeNodeId) {
        useInteractionScope
          .getState()
          .endIf(
            (s) =>
              (s.kind === 'reshaping' || s.kind === 'handle-drag') &&
              s.nodeId === drag.reshapeScopeNodeId,
          )
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      const planPoint = clientToPlan(event.clientX, event.clientY)
      if (!planPoint) return

      drag.session.apply({
        planPoint,
        modifiers: {
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        },
      })

      // Live rotation readout. Sweep from the bearing at grab to the
      // current pointer bearing around the pivot — the same measurement
      // every rotate affordance applies — and surface it as a wedge +
      // degree chip. Suppressed below ~0.5° so a fresh grab doesn't flash
      // a zero-width sliver.
      const rot = drag.rotation
      if (rot) {
        const current = Math.atan2(planPoint[1] - rot.pivot[1], planPoint[0] - rot.pivot[0])
        let delta = current - rot.initialAngle
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        // Match the affordance's 15° angle step (Shift = free) so the wedge +
        // degree chip read the committed rotation, not the raw pointer bearing.
        delta = snapDirectRotationDelta(delta, event.shiftKey)
        if (Math.abs(delta) < 0.0087) {
          setRotationOverlay(null)
        } else {
          setRotationOverlay({
            pivot: rot.pivot,
            startAngle: rot.initialAngle,
            endAngle: rot.initialAngle + delta,
            radius: rot.radius,
            sweep: Math.abs(delta),
          })
        }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      const commitValid = drag.session.canCommit()

      // Sessions with a `commit` hook own their atomic write (e.g.
      // affordances that publish to `useLiveNodeOverrides` during
      // `apply()` and never touch scene mid-drag). Mirrors the move
      // overlay's `session.commit` path — revert untracked (no-op when
      // the session never wrote to scene), resume history, then let
      // the session do the tracked write.
      if (commitValid && drag.session.commit) {
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
          drag.historyPaused = false
        }
        drag.session.commit()
        sfxEmitter.emit('sfx:structure-build')
        clearSurfacePlanSnapFeedback()
        endReshapeScope(drag)
        dragRef.current = null
        setActiveDragId(null)
        setRotationOverlay(null)
        return
      }

      // Capture the final state BEFORE the revert so we know what to
      // re-apply post-resume.
      const sceneNodes = useScene.getState().nodes
      const finalUpdates: Array<{ id: AnyNodeId; data: Record<string, unknown> }> = []
      for (const snap of drag.snapshots) {
        const current = sceneNodes[snap.id]
        if (!current) continue
        const data: Record<string, unknown> = {}
        let changed = false
        for (const [key, before] of Object.entries(snap.data)) {
          const after = (current as unknown as Record<string, unknown>)[key]
          if (!deepEqual(before, after)) {
            data[key] = Array.isArray(after) ? [...(after as unknown[])] : after
            changed = true
          }
        }
        if (changed) finalUpdates.push({ id: snap.id, data })
      }

      if (commitValid && finalUpdates.length > 0) {
        // Single-undo dance (mirrors the 3D move-endpoint-tool):
        //   1. Revert to baseline while history is still paused (untracked).
        //   2. Resume history.
        //   3. Re-apply the final state — recorded as one tracked change.
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
          drag.historyPaused = false
        }
        useScene.getState().updateNodes(finalUpdates)
        sfxEmitter.emit('sfx:structure-build')
      } else {
        // Either no net change or canCommit() rejected — revert and
        // resume without committing. Also clear any live overrides
        // the session published (no-op when the session writes to
        // scene directly).
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
          drag.historyPaused = false
        }
        const overrides = useLiveNodeOverrides.getState()
        for (const id of drag.session.affectedIds) overrides.clear(id)
      }

      clearSurfacePlanSnapFeedback()
      endReshapeScope(drag)
      dragRef.current = null
      setActiveDragId(null)
      setRotationOverlay(null)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      // Revert untracked, then resume — no history entry is recorded.
      useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
      if (drag.historyPaused) {
        resumeSceneHistory(useScene)
        drag.historyPaused = false
      }
      // Affordances that publish Figma alignment guides during `apply`
      // (fence endpoint) leave them in the store on cancel — `canCommit`
      // (the pointer-up clear) never runs on a cancel.
      clearSurfacePlanSnapFeedback()
      // Drop any live overrides the session may have published. No-op
      // for affordances whose `apply()` writes straight to scene; the
      // override-routed sessions (wall endpoint, wall curve) rely on
      // this to revert cleanly.
      const overrides = useLiveNodeOverrides.getState()
      for (const id of drag.session.affectedIds) overrides.clear(id)

      endReshapeScope(drag)
      dragRef.current = null
      setActiveDragId(null)
      setRotationOverlay(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      // Component unmounted mid-drag — restore the baseline and unpause
      // history so we don't leak a paused store across mounts. Also
      // drop any live overrides the session published so the next
      // mount doesn't render at the cancelled position.
      const drag = dragRef.current
      if (drag) {
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
        }
        const overrides = useLiveNodeOverrides.getState()
        for (const id of drag.session.affectedIds) overrides.clear(id)
        endReshapeScope(drag)
        dragRef.current = null
      }
      // Clear any alignment guide a session left behind on mid-drag unmount.
      clearSurfacePlanSnapFeedback()
    }
  }, [])

  const entries = floorplanData.entries
  if (entries.length === 0) return null

  const unitsPerPixel = renderCtx?.unitsPerPixel ?? 1
  const palette = renderCtx?.palette

  return (
    // The outer wrapper stops `click` events that escape an entry's
    // `onClick={handleClickStop}`. The base+overlay split means
    // pointer-down can land on the base `<g>` and pointer-up on the
    // overlay `<g>` (selection mounts the overlay on top mid-gesture).
    // When the down/up targets differ, the browser dispatches `click`
    // to the lowest common ancestor — which sits ABOVE the entry-level
    // handler. Without this guard the click reaches the SVG's
    // `handleBackgroundClick`, which calls
    // `resolveFloorplanBackgroundSelection` → `clear-elements` (because
    // registry-driven items aren't in the legacy hit-test set) →
    // clearing the selection that pointer-down just set, so items
    // appear to "deselect themselves a fraction of a second after
    // clicking." Scoped to `onClick` so hover / drag / pointer events
    // still propagate normally inside the registry tree.
    <g
      className="floorplan-registry-layer"
      onClick={isOpeningPlacementActive ? undefined : handleClickStop}
      opacity={isAmbient ? 0.3 : undefined}
      style={isAmbient ? NO_POINTER_EVENTS_STYLE : undefined}
    >
      {/* Base pass — rank-sorted body geometry (polygons, paths, fills,
          strokes, hatches). Lower-rank kinds (zones) paint first so
          higher-rank kinds (slabs, then walls / items / shelves) layer
          on top in the expected document-order z-stack. */}
      <g className="floorplan-registry-base">
        {entries.map((entry) => (
          <FloorplanRegistryEntry
            activeDragId={handleIdForNode(activeDragId, entry.id)}
            activeRotateNodeId={activeRotateNodeId === entry.id ? activeRotateNodeId : null}
            floorplanVisible={floorplanVisible}
            geometryCacheRef={geometryCacheRef}
            hatchPatternId={renderCtx?.hatchPatternId}
            highlighted={highlightedIdSet.has(entry.id)}
            hovered={hoveredId === entry.id}
            hoveredHandleId={handleIdForNode(hoveredHandleId, entry.id)}
            interactiveElevators={interactiveElevators}
            isMarqueeSelectionActive={isMarqueeSelectionActive}
            isOpeningPlacementActive={isOpeningPlacementActive}
            key={`base-${entry.id}`}
            levelDataCacheRef={levelDataCacheRef}
            levelNodeIdsByType={floorplanData.levelNodeIdsByType}
            moving={movingNode?.id === entry.id}
            node={entry.node}
            nodeId={entry.id}
            nodes={nodes}
            onClickStop={handleClickStop}
            onEntryPointerDown={handleEntryPointerDown}
            onGroupMovePointerDown={handleGroupMoveHandlePointerDown}
            onHandleHoverChange={setHoveredHandleId}
            onHandlePointerDown={startAffordanceDrag}
            onHoveredIdChange={setHoveredId}
            palette={palette}
            pass="base"
            sceneRotationDeg={renderCtx?.sceneRotationDeg ?? 0}
            selected={selectedIdSet.has(entry.id)}
            suppressHandles={isMultiSelect && selectedIdSet.has(entry.id)}
            groupMoveCursor={groupParticipantIdSet?.has(entry.id) ?? false}
            setMovingNode={setMovingNode}
            setMovingNodeOrigin={setMovingNodeOrigin}
            siblingEpoch={entry.dependsOnSiblingInputs ? (siblingEpochs.get(entry.id) ?? 0) : 0}
            unitsPerPixel={unitsPerPixel}
            visibilityRootId={entry.ctxOverrides ? undefined : (levelId as AnyNodeId)}
            ctxOverrides={entry.ctxOverrides}
          />
        ))}
      </g>
      {/* Overlay pass — interactive handles (vertex / midpoint / edge /
          move) and labels (text / dimensions). Painted after every base
          entry so polygon-editor chrome on a selected slab stays above
          neighbouring walls, and a zone name stays readable above the
          slab + wall geometry sitting on top of the zone. Each overlay
          still routes through the same selection-handling `<g>` so a
          click on a zone's name selects the zone. */}
      <g className="floorplan-registry-overlay">
        {entries.map((entry) => (
          <FloorplanRegistryEntry
            activeDragId={handleIdForNode(activeDragId, entry.id)}
            activeRotateNodeId={activeRotateNodeId === entry.id ? activeRotateNodeId : null}
            floorplanVisible={floorplanVisible}
            geometryCacheRef={geometryCacheRef}
            hatchPatternId={renderCtx?.hatchPatternId}
            highlighted={highlightedIdSet.has(entry.id)}
            hovered={hoveredId === entry.id}
            hoveredHandleId={handleIdForNode(hoveredHandleId, entry.id)}
            interactiveElevators={interactiveElevators}
            isMarqueeSelectionActive={isMarqueeSelectionActive}
            isOpeningPlacementActive={isOpeningPlacementActive}
            key={`overlay-${entry.id}`}
            levelDataCacheRef={levelDataCacheRef}
            levelNodeIdsByType={floorplanData.levelNodeIdsByType}
            moving={movingNode?.id === entry.id}
            node={entry.node}
            nodeId={entry.id}
            nodes={nodes}
            onClickStop={handleClickStop}
            onEntryPointerDown={handleEntryPointerDown}
            onGroupMovePointerDown={handleGroupMoveHandlePointerDown}
            onHandleHoverChange={setHoveredHandleId}
            onHandlePointerDown={startAffordanceDrag}
            onHoveredIdChange={setHoveredId}
            palette={palette}
            pass="overlay"
            sceneRotationDeg={renderCtx?.sceneRotationDeg ?? 0}
            selected={selectedIdSet.has(entry.id)}
            suppressHandles={isMultiSelect && selectedIdSet.has(entry.id)}
            groupMoveCursor={groupParticipantIdSet?.has(entry.id) ?? false}
            setMovingNode={setMovingNode}
            setMovingNodeOrigin={setMovingNodeOrigin}
            siblingEpoch={entry.dependsOnSiblingInputs ? (siblingEpochs.get(entry.id) ?? 0) : 0}
            unitsPerPixel={unitsPerPixel}
            visibilityRootId={entry.ctxOverrides ? undefined : (levelId as AnyNodeId)}
            ctxOverrides={entry.ctxOverrides}
          />
        ))}
      </g>
      {/* Dashed group bbox — shows what a group drag carries along while a
          multi-selection exists, rides the live delta mid-drag, and doubles
          as the group's whole-area drag handle. */}
      <FloorplanGroupSelectionBox
        onPointerDown={handleGroupBoxPointerDown}
        onRotatePointerDown={handleGroupBoxRotatePointerDown}
        palette={palette}
        unitsPerPixel={unitsPerPixel}
      />
      {/* Transient live-rotation readout — drawn last so the wedge + degree
          chip sit above all handle chrome while a rotate-arrow is dragged. */}
      {rotationOverlay && palette ? (
        <RotationAngleOverlay
          overlay={rotationOverlay}
          palette={palette}
          sceneRotationDeg={renderCtx?.sceneRotationDeg ?? 0}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
    </g>
  )
})

type FloorplanRegistryEntryProps = {
  activeDragId: string | null
  activeRotateNodeId: AnyNodeId | null
  ctxOverrides: FloorplanContextOverrides | undefined
  floorplanVisible: boolean
  geometryCacheRef: { current: Map<string, CacheEntry> }
  hatchPatternId: string | undefined
  highlighted: boolean
  hovered: boolean
  hoveredHandleId: string | null
  interactiveElevators: unknown
  isMarqueeSelectionActive: boolean
  isOpeningPlacementActive: boolean
  levelDataCacheRef: { current: Map<string, LevelDataCacheEntry> }
  levelNodeIdsByType: ReadonlyMap<string, readonly AnyNodeId[]>
  moving: boolean
  node: AnyNode
  nodeId: AnyNodeId
  nodes: Record<string, AnyNode>
  /** Selected member of a multi-selection: hide its per-node edit chrome. */
  suppressHandles: boolean
  /** Transformable member of a multi-selection: advertise drag-to-move. */
  groupMoveCursor: boolean
  onClickStop: (event: React.MouseEvent<SVGGElement>) => void
  onEntryPointerDown: (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>) => void
  onGroupMovePointerDown: (id: AnyNodeId, event: ReactPointerEvent<SVGGElement>) => boolean
  onHandleHoverChange: (id: string | null) => void
  onHandlePointerDown: (
    nodeId: AnyNodeId,
    handleId: string,
    affordance: string,
    payload: unknown,
    event: ReactPointerEvent<SVGGElement>,
    rotationPivot?: FloorplanPoint,
  ) => void
  onHoveredIdChange: (id: AnyNodeId | null) => void
  palette: FloorplanPalette | undefined
  pass: FloorplanRenderPass
  sceneRotationDeg: number
  selected: boolean
  setMovingNode: ReturnType<typeof useEditor.getState>['setMovingNode']
  setMovingNodeOrigin: ReturnType<typeof useEditor.getState>['setMovingNodeOrigin']
  siblingEpoch: number
  unitsPerPixel: number
  visibilityRootId: AnyNodeId | undefined
}

const FloorplanRegistryEntry = memo(function FloorplanRegistryEntry({
  activeDragId,
  activeRotateNodeId,
  ctxOverrides,
  floorplanVisible,
  geometryCacheRef,
  hatchPatternId,
  highlighted,
  hovered,
  hoveredHandleId,
  interactiveElevators,
  isMarqueeSelectionActive,
  isOpeningPlacementActive,
  levelDataCacheRef,
  levelNodeIdsByType,
  moving,
  node,
  nodeId,
  nodes,
  suppressHandles,
  groupMoveCursor,
  onClickStop,
  onEntryPointerDown,
  onGroupMovePointerDown,
  onHandleHoverChange,
  onHandlePointerDown,
  onHoveredIdChange,
  palette,
  pass,
  sceneRotationDeg,
  selected,
  setMovingNode,
  setMovingNodeOrigin,
  siblingEpoch,
  unitsPerPixel,
  visibilityRootId,
}: FloorplanRegistryEntryProps): React.ReactElement | null {
  const live = useLiveTransforms((s) => (floorplanVisible ? s.transforms.get(nodeId) : undefined))
  const liveOverride = useLiveNodeOverrides((s) =>
    floorplanVisible ? s.overrides.get(nodeId) : undefined,
  )
  const liveOverrides = floorplanVisible
    ? useLiveNodeOverrides.getState().overrides
    : EMPTY_LIVE_OVERRIDES

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>) => onEntryPointerDown(nodeId, event),
    [nodeId, onEntryPointerDown],
  )

  // Mirror the sidebar tree nodes' hover wiring — `useViewer.hoveredId` drives
  // the highlight halo in 3D as well as registry floor-plan hover strokes.
  const handlePointerEnter = useCallback(() => {
    onHoveredIdChange(nodeId)
  }, [nodeId, onHoveredIdChange])

  const handlePointerLeave = useCallback(() => {
    if (useViewer.getState().hoveredId === nodeId) onHoveredIdChange(null)
  }, [nodeId, onHoveredIdChange])

  const handleHandlePointerDown = useCallback(
    (
      affordance: string,
      payload: unknown,
      event: ReactPointerEvent<SVGGElement>,
      rotationPivot?: FloorplanPoint,
    ) => {
      onHandlePointerDown(
        nodeId,
        makeHandleId(nodeId, payload),
        affordance,
        payload,
        event,
        rotationPivot,
      )
    },
    [nodeId, onHandlePointerDown],
  )

  const handleMoveHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      const currentNode = useScene.getState().nodes[nodeId]
      if (!currentNode) return
      event.preventDefault()
      event.stopPropagation()
      suppressBoxSelectForPointer(event)
      // In a multi-selection the move dot drives the group session, matching
      // the body-drag gesture — the whole selection slides, not one member.
      if (onGroupMovePointerDown(nodeId, event)) return
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(currentNode as never)
      // Claim 2D ownership of this move at the source. `setMovingNode`
      // resets the origin to null, so this must follow it.
      setMovingNodeOrigin('2d')
    },
    [nodeId, onGroupMovePointerDown, setMovingNode, setMovingNodeOrigin],
  )

  const cacheEntry = buildFloorplanEntryGeometry({
    ctxOverrides,
    geometryCache: geometryCacheRef.current,
    highlighted,
    hovered,
    interactiveElevators,
    levelDataCache: levelDataCacheRef.current,
    levelNodeIdsByType,
    live,
    liveOverride,
    liveOverrides,
    moving,
    node,
    nodeId,
    nodes,
    palette,
    selected,
    siblingEpoch,
    visibilityRootId,
  })
  const rawGeometry = cacheEntry ? (pass === 'base' ? cacheEntry.base : cacheEntry.overlay) : null
  // Multi-selection shows highlight only: strip this member's edit handles /
  // dimension chrome (all of which live in the overlay pass) while keeping
  // its highlighted body geometry.
  const geometry =
    rawGeometry && suppressHandles && pass === 'overlay'
      ? stripHandleChrome(rawGeometry)
      : rawGeometry
  if (!geometry) return null

  const entryClick = isOpeningPlacementActive || isMarqueeSelectionActive ? undefined : onClickStop
  const entryPointerDown =
    isOpeningPlacementActive || isMarqueeSelectionActive ? undefined : handlePointerDown

  return (
    <g
      className="floorplan-registry-entry"
      data-node-id={nodeId}
      onClick={entryClick}
      onPointerDown={entryPointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={groupMoveCursor ? MOVE_CURSOR_STYLE : POINTER_CURSOR_STYLE}
    >
      <InteractiveGeometry
        activeDragId={activeDragId}
        activeRotateNodeId={activeRotateNodeId}
        geometry={geometry}
        hatchPatternId={hatchPatternId}
        hoveredHandleId={hoveredHandleId}
        isMarqueeSelectionActive={isMarqueeSelectionActive}
        nodeId={nodeId}
        onHandleHoverChange={onHandleHoverChange}
        onHandlePointerDown={handleHandlePointerDown}
        onMoveHandlePointerDown={handleMoveHandlePointerDown}
        palette={palette}
        sceneRotationDeg={sceneRotationDeg}
        unitsPerPixel={unitsPerPixel}
      />
    </g>
  )
}, shallowPropsAreEqual)

type BuildFloorplanEntryGeometryArgs = {
  ctxOverrides: FloorplanContextOverrides | undefined
  geometryCache: Map<string, CacheEntry>
  highlighted: boolean
  hovered: boolean
  interactiveElevators: unknown
  levelDataCache: Map<string, LevelDataCacheEntry>
  levelNodeIdsByType: ReadonlyMap<string, readonly AnyNodeId[]>
  live: LiveTransform | undefined
  liveOverride: LiveNodeOverrides | undefined
  liveOverrides: Map<string, LiveNodeOverrides>
  moving: boolean
  node: AnyNode
  nodeId: AnyNodeId
  nodes: Record<string, AnyNode>
  palette: FloorplanPalette | undefined
  selected: boolean
  siblingEpoch: number
  visibilityRootId: AnyNodeId | undefined
}

function buildFloorplanEntryGeometry({
  ctxOverrides,
  geometryCache,
  highlighted,
  hovered,
  interactiveElevators,
  levelDataCache,
  levelNodeIdsByType,
  live,
  liveOverride,
  liveOverrides,
  moving,
  node,
  nodeId,
  nodes,
  palette,
  selected,
  siblingEpoch,
  visibilityRootId,
}: BuildFloorplanEntryGeometryArgs): CacheEntry | null {
  const def = nodeRegistry.get(node.type)
  const builder = def?.floorplan
  if (!builder) return null

  const visible = visibilityRootId
    ? isFloorplanHierarchyVisible(node, nodes, liveOverrides, visibilityRootId)
    : isFloorplanNodeVisible(node, liveOverride)
  if (!visible) {
    geometryCache.delete(nodeId)
    return null
  }

  const dependsOnSiblingInputs = !!(def.floorplanDependsOnSiblings || def.floorplanSiblingOverrides)
  const deps: NodeDeps = {
    node,
    live,
    selected,
    highlighted,
    hovered,
    moving,
    liveOverride,
    palette,
    siblingEpoch: dependsOnSiblingInputs ? siblingEpoch : 0,
    // Sibling-dependent kinds (wall miters, opening cuts) read other nodes'
    // committed state via `ctx`, so committed sibling edits still invalidate.
    committedNodes: dependsOnSiblingInputs ? nodes : null,
    interactiveElevators,
  }
  const cached = geometryCache.get(nodeId)
  if (cached && nodeDepsEqual(cached.deps, deps)) return cached

  const applyLiveTransform = (sourceNode: AnyNode): AnyNode => {
    if (!live) return sourceNode
    const hasPosition = Array.isArray((sourceNode as { position?: unknown }).position)
    if (sourceNode.type === 'door' || sourceNode.type === 'window') {
      const r = (sourceNode as { rotation?: unknown }).rotation
      return {
        ...sourceNode,
        position: live.position,
        rotation: Array.isArray(r)
          ? [(r[0] as number) ?? 0, live.rotation, (r[2] as number) ?? 0]
          : r,
      } as AnyNode
    }
    if ((def.capabilities?.floorPlaced || def.floorplanScope === 'building') && hasPosition) {
      return applyPositionLiveTransform(sourceNode, live)
    }
    if (sourceNode.type === 'slab' || sourceNode.type === 'ceiling' || sourceNode.type === 'zone') {
      const dx = live.position[0]
      const dz = live.position[2]
      if (dx === 0 && dz === 0) return sourceNode
      const surface = sourceNode as {
        polygon: Array<[number, number]>
        holes?: Array<Array<[number, number]>>
      }
      return {
        ...sourceNode,
        polygon: surface.polygon.map(([x, z]) => [x + dx, z + dz] as [number, number]),
        holes: (surface.holes ?? []).map((h) =>
          h.map(([x, z]) => [x + dx, z + dz] as [number, number]),
        ),
      } as AnyNode
    }
    return sourceNode
  }

  const contextNodes = def.floorplanSiblingOverrides
    ? def.floorplanSiblingOverrides({ nodeId, nodes, liveOverrides })
    : nodes
  const sourceNode = contextNodes !== nodes ? (contextNodes[nodeId] ?? node) : node
  const overrideNode = liveOverride ? ({ ...sourceNode, ...liveOverride } as AnyNode) : sourceNode
  const effectiveNode = applyLiveTransform(overrideNode)
  const levelData = getFloorplanLevelData(
    node.type,
    nodes,
    liveOverrides,
    levelNodeIdsByType,
    levelDataCache,
  )
  const viewState = {
    selected,
    highlighted,
    hovered,
    moving,
    palette,
  }
  const ctx: GeometryContext = ctxOverrides
    ? {
        resolve: <N = AnyNode>(rid: AnyNodeId): N | undefined => contextNodes[rid] as N | undefined,
        children: ctxOverrides.children,
        siblings: ctxOverrides.siblings,
        parent: ctxOverrides.parent,
        levelData,
        viewState: palette
          ? {
              selected,
              highlighted,
              hovered,
              moving,
              palette,
            }
          : undefined,
      }
    : buildContext(effectiveNode, contextNodes, viewState, levelData)
  const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
    effectiveNode,
    ctx,
  )
  const { base, overlay } = geometry
    ? splitFloorplanOverlay(geometry)
    : { base: null, overlay: null }
  const entry: CacheEntry = { deps, base, overlay, node: effectiveNode }
  geometryCache.set(nodeId, entry)
  return entry
}

export function getFloorplanLevelData(
  type: string,
  nodes: Record<string, AnyNode>,
  liveOverrides: Map<string, LiveNodeOverrides>,
  levelNodeIdsByType: ReadonlyMap<string, readonly AnyNodeId[]>,
  levelDataCache: Map<string, LevelDataCacheEntry>,
): unknown {
  const def = nodeRegistry.get(type)
  if (!def?.computeFloorplanLevelData) return undefined
  const ids = levelNodeIdsByType.get(type)
  const sampleId = ids?.[0]
  if (!ids || !sampleId) return undefined

  const cached = levelDataCache.get(type)
  if (
    cached &&
    cached.nodes === nodes &&
    cached.liveOverrides === liveOverrides &&
    cached.ids === ids
  ) {
    return cached.value
  }

  const computeLevelData = def.computeFloorplanLevelData as FloorplanLevelDataHook
  const contextNodes = def.floorplanSiblingOverrides
    ? def.floorplanSiblingOverrides({ nodeId: sampleId, nodes, liveOverrides })
    : nodes
  const siblings: AnyNode[] = []
  for (const id of ids) {
    const sibling = contextNodes[id]
    if (sibling?.type === type) siblings.push(sibling)
  }
  const value = computeLevelData({ siblings, nodes: contextNodes })
  levelDataCache.set(type, { nodes, liveOverrides, ids, value })
  return value
}

// ── Interactive geometry walker ──────────────────────────────────────

type InteractiveGeometryProps = {
  geometry: FloorplanGeometry
  unitsPerPixel: number
  palette: FloorplanPalette | undefined
  hatchPatternId: string | undefined
  hoveredHandleId: string | null
  activeDragId: string | null
  activeRotateNodeId: AnyNodeId | null
  isMarqueeSelectionActive: boolean
  nodeId: AnyNodeId
  sceneRotationDeg: number
  onHandleHoverChange: (id: string | null) => void
  onHandlePointerDown: (
    affordance: string,
    payload: unknown,
    event: ReactPointerEvent<SVGGElement>,
    // Forwarded only by rotate-arrow handles — the pivot the drag turns
    // the node around, used to drive the live angle wedge + degree chip.
    rotationPivot?: FloorplanPoint,
  ) => void
  onMoveHandlePointerDown: (event: ReactPointerEvent<SVGGElement>) => void
}

const InteractiveGeometry = memo(function InteractiveGeometry({
  geometry,
  unitsPerPixel,
  palette,
  hatchPatternId,
  hoveredHandleId,
  activeDragId,
  activeRotateNodeId,
  isMarqueeSelectionActive,
  nodeId,
  sceneRotationDeg,
  onHandleHoverChange,
  onHandlePointerDown,
  onMoveHandlePointerDown,
}: InteractiveGeometryProps): React.ReactElement {
  return renderInteractive(geometry, 0)

  function renderInteractive(g: FloorplanGeometry, keyHint: number): React.ReactElement {
    switch (g.kind) {
      case 'group': {
        const transform = formatGroupTransform(g.transform)
        return (
          <g key={keyHint} transform={transform}>
            {g.children.map((child, i) => renderInteractive(child, i))}
          </g>
        )
      }
      case 'hatch': {
        if (!hatchPatternId) return <></>
        return (
          <polygon
            fill={`url(#${hatchPatternId})`}
            key={keyHint}
            opacity={g.opacity}
            pointerEvents="none"
            points={g.points.map(([x, y]) => `${x},${y}`).join(' ')}
          />
        )
      }
      case 'hit-line': {
        return (
          <line
            key={keyHint}
            pointerEvents={isMarqueeSelectionActive ? 'none' : (g.pointerEvents ?? 'stroke')}
            stroke="transparent"
            strokeLinecap="round"
            strokeWidth={g.strokeWidthPx * unitsPerPixel}
            style={{ cursor: g.cursor ?? 'pointer' }}
            vectorEffect="non-scaling-stroke"
            x1={g.x1}
            x2={g.x2}
            y1={g.y1}
            y2={g.y2}
          />
        )
      }
      case 'endpoint-handle': {
        if (!palette) return <></>
        const handleId = makeHandleId(nodeId, g.payload)
        const isHovered = hoveredHandleId === handleId
        const isActive = activeDragId === handleId
        // Variant picks the colour-set. Endpoint dots use the orange
        // legacy palette; curve sagitta dots use the teal set so users
        // can tell them apart at a glance.
        const isCurve = g.variant === 'curve'
        const stroke = isCurve
          ? palette.curveHandleStroke
          : isActive
            ? palette.endpointHandleActiveStroke
            : palette.endpointHandleStroke
        const hoverStroke = isCurve
          ? palette.curveHandleHoverStroke
          : isActive
            ? palette.endpointHandleActiveStroke
            : palette.endpointHandleHoverStroke
        const fill = isCurve
          ? palette.curveHandleFill
          : isActive
            ? palette.endpointHandleActiveFill
            : palette.endpointHandleFill
        const outerRadius =
          (isActive ? ENDPOINT_HANDLE_ACTIVE_RADIUS_PX : ENDPOINT_HANDLE_SELECTED_RADIUS_PX) *
          unitsPerPixel
        const dotRadius =
          (isActive ? ENDPOINT_HANDLE_ACTIVE_DOT_RADIUS_PX : ENDPOINT_HANDLE_DOT_RADIUS_PX) *
          unitsPerPixel
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.24 : 0.16}
              strokeWidth={ENDPOINT_HOVER_GLOW_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ opacity: isHovered || isActive ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.72 : 0.52}
              strokeWidth={ENDPOINT_HOVER_RING_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ opacity: isHovered || isActive ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={fill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeWidth="0.05"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={stroke}
              pointerEvents="none"
              r={dotRadius}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="transparent"
              onPointerDown={(e) =>
                onHandlePointerDown(g.affordance, g.payload, e as ReactPointerEvent<SVGGElement>)
              }
              pointerEvents="all"
              r={outerRadius}
              stroke="transparent"
              strokeWidth={ENDPOINT_HIT_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ cursor: 'pointer' }}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      }
      case 'move-handle': {
        if (!palette) return <></>
        const moveHandleId = `${nodeId}:move`
        const isHovered = hoveredHandleId === moveHandleId
        // World-relative sizing: the move dot is anchored to the door,
        // not to the screen, so it grows when the user zooms in and
        // shrinks when they zoom out — same scaling rule as the door
        // footprint itself. Sizes are tuned for a ~0.9 m door at default
        // zoom; the ratios match the legacy 13/15/6/16/7/18 px stack.
        const baseRadius = 0.1
        const hoverRadius = 0.115
        const outerRadius = isHovered ? hoverRadius : baseRadius
        const dotRadius = 0.045
        const fillStroke = 0.005
        const glowStroke = 0.12
        const ringStroke = 0.055
        const hitStroke = 0.14
        // Same 5-circle stack as the orange endpoint dot — hover glow +
        // hover ring + filled outer + inner dot + transparent hit. On
        // pointer-down, the layer calls `setMovingNode(node)`, which
        // FloorplanRegistryMoveOverlay picks up and routes to the
        // kind's `def.floorplanMoveTarget`.
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={() => onHandleHoverChange(moveHandleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={palette.endpointHandleHoverStroke}
              strokeOpacity={0.16}
              strokeWidth={glowStroke}
              style={{ opacity: isHovered ? 1 : 0, transition: HOVER_TRANSITION }}
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={palette.endpointHandleHoverStroke}
              strokeOpacity={0.52}
              strokeWidth={ringStroke}
              style={{ opacity: isHovered ? 1 : 0, transition: HOVER_TRANSITION }}
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={palette.endpointHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={palette.endpointHandleStroke}
              strokeWidth={fillStroke}
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={palette.endpointHandleStroke}
              pointerEvents="none"
              r={dotRadius}
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="transparent"
              onPointerDown={(e) => onMoveHandlePointerDown(e as ReactPointerEvent<SVGGElement>)}
              pointerEvents="all"
              r={outerRadius}
              stroke="transparent"
              strokeWidth={hitStroke}
              style={{ cursor: 'move' }}
            />
          </g>
        )
      }
      case 'rotate-arrow': {
        if (!palette) return <></>
        // 2D counterpart of the 3D `arc-resize` rotate gizmo. Local
        // frame: +X is the radial-outward direction (away from the
        // pivot); the arc bows in that direction with arrowheads on
        // each end pointing tangentially in opposite directions —
        // "rotate either way."
        const handleId = makeHandleId(nodeId, g.payload)
        const isHovered = hoveredHandleId === handleId || activeRotateNodeId === nodeId
        // Arc geometry (all values precomputed for a 72° arc of
        // radius 0.13 — comparable footprint to `move-arrow`).
        const R = 0.13
        const halfSpan = Math.PI / 5
        const cosH = Math.cos(halfSpan)
        const sinH = Math.sin(halfSpan)
        const endY = R * sinH
        const headLen = 0.06
        const headHalfBase = 0.045
        // End-1 (top) arrowhead — tip along CCW tangent.
        const t1x = -sinH * headLen
        const t1y = endY + cosH * headLen
        const b1ax = cosH * headHalfBase
        const b1ay = endY + sinH * headHalfBase
        const b1bx = -cosH * headHalfBase
        const b1by = endY - sinH * headHalfBase
        // End-2 (bottom) arrowhead — mirror of End-1.
        const t2x = -sinH * headLen
        const t2y = -endY - cosH * headLen
        const b2ax = cosH * headHalfBase
        const b2ay = -endY - sinH * headHalfBase
        const b2bx = -cosH * headHalfBase
        const b2by = -endY + sinH * headHalfBase
        const arcPath = `M 0 ${-endY} A ${R} ${R} 0 0 1 0 ${endY}`
        const head1 = `M ${t1x} ${t1y} L ${b1ax} ${b1ay} L ${b1bx} ${b1by} Z`
        const head2 = `M ${t2x} ${t2y} L ${b2ax} ${b2ay} L ${b2bx} ${b2by} Z`
        const fill = isHovered ? '#a5b4fc' : '#8381ed'
        const strokeWidthPx = isHovered ? 2.4 : 1.8
        const angleDeg = (g.angle * 180) / Math.PI
        const affordance = g.affordance
        const payload = g.payload
        const pivot = g.pivot
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            transform={`translate(${g.point[0]} ${g.point[1]}) rotate(${angleDeg})`}
          >
            <path
              d={arcPath}
              fill="none"
              pointerEvents="none"
              stroke={fill}
              strokeLinecap="round"
              strokeWidth={strokeWidthPx}
              vectorEffect="non-scaling-stroke"
            />
            <path d={head1} fill={fill} pointerEvents="none" />
            <path d={head2} fill={fill} pointerEvents="none" />
            {/* Hit target — fat invisible stroke along the arc + filled
                triangles at the heads so the user can grab anywhere on
                the visible icon. */}
            <path
              d={arcPath}
              fill="none"
              onPointerDown={(e) =>
                onHandlePointerDown(
                  affordance,
                  payload,
                  e as ReactPointerEvent<SVGPathElement>,
                  pivot,
                )
              }
              onPointerEnter={() => onHandleHoverChange(handleId)}
              onPointerLeave={() => onHandleHoverChange(null)}
              pointerEvents="stroke"
              stroke="transparent"
              strokeWidth={0.06}
              style={{ cursor: 'grab' }}
            />
            <path
              d={`${head1} ${head2}`}
              fill="transparent"
              onPointerDown={(e) =>
                onHandlePointerDown(
                  affordance,
                  payload,
                  e as ReactPointerEvent<SVGPathElement>,
                  pivot,
                )
              }
              onPointerEnter={() => onHandleHoverChange(handleId)}
              onPointerLeave={() => onHandleHoverChange(null)}
              pointerEvents="fill"
              style={{ cursor: 'grab' }}
            />
          </g>
        )
      }
      case 'move-arrow': {
        if (!palette) return <></>
        // Affordance-routed arrows (door width-resize) get a per-payload
        // handle id so each side can hover independently; default
        // (move-flow) arrows share the node's :move id like the dot.
        const handleId = g.affordance ? makeHandleId(nodeId, g.payload) : `${nodeId}:move`
        const isHovered = hoveredHandleId === handleId
        // Arrow geometry in plan units (meters) — scales with the scene
        // so it shrinks on zoom-out and grows on zoom-in, matching the
        // wall it accompanies. Composed of a rectangular shaft + triangular
        // head, drawn as a single path for a clean fill + stroke outline.
        const sl = 0.1 // shaft length (shortened body)
        const hl = 0.12 // head length
        const sh = 0.04 // shaft half-height
        const hh = 0.1 // head half-height
        // Inset the shaft start so the arrow sits a little off the wall
        // body (matches the 3D `HANDLE_OFFSET`).
        const bi = 0.03 // base inset
        const arrowD = `M ${bi},${-sh} L ${bi + sl},${-sh} L ${bi + sl},${-hh} L ${bi + sl + hl},0 L ${bi + sl},${hh} L ${bi + sl},${sh} L ${bi},${sh} Z`
        // Indigo palette to match the 3D `WallMoveSideHandles` arrows
        // (`ARROW_COLOR` / `ARROW_HOVER_COLOR`) and the corner-sphere
        // accent in `floating-action-menu.tsx`.
        const fill = isHovered ? '#a5b4fc' : '#8381ed'
        const angleDeg = (g.angle * 180) / Math.PI
        const cursor = g.affordance ? 'ew-resize' : 'move'
        const affordance = g.affordance
        const payload = g.payload
        // No hover-grow: a scaling transform would enlarge the hit area
        // too, letting clicks just outside the visible arrow still start
        // a drag. Hover feedback is colour-only so the click region
        // always matches the painted arrow shape exactly.
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            transform={`translate(${g.point[0]} ${g.point[1]}) rotate(${angleDeg})`}
          >
            <path d={arrowD} fill={fill} pointerEvents="none" />
            <path
              d={arrowD}
              fill="transparent"
              onPointerDown={(e) => {
                if (affordance) {
                  onHandlePointerDown(affordance, payload, e as ReactPointerEvent<SVGGElement>)
                } else {
                  onMoveHandlePointerDown(e as ReactPointerEvent<SVGGElement>)
                }
              }}
              onPointerEnter={() => onHandleHoverChange(handleId)}
              onPointerLeave={() => onHandleHoverChange(null)}
              pointerEvents="fill"
              style={{ cursor }}
            />
          </g>
        )
      }
      case 'edge-handle': {
        if (!palette) return <></>
        const handleId = makeHandleId(nodeId, g.payload)
        const isHovered = hoveredHandleId === handleId
        const isActive = activeDragId === handleId
        const showVisible = isHovered || isActive
        const stroke = isActive ? palette.endpointHandleActiveStroke : palette.selectedStroke
        // Stroke widths in screen pixels — non-scaling-stroke keeps the
        // hit area + glow consistent at every zoom.
        const glowWidthPx = 14
        const visibleWidthPx = 3
        const hitWidthPx = 18
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            {/* Soft glow — visible only on hover / active. */}
            <line
              pointerEvents="none"
              stroke={stroke}
              strokeLinecap="round"
              strokeOpacity={0.18}
              strokeWidth={glowWidthPx * unitsPerPixel}
              style={{ opacity: showVisible ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
              x1={g.x1}
              x2={g.x2}
              y1={g.y1}
              y2={g.y2}
            />
            {/* Solid stroke on top — slightly more opaque when active. */}
            <line
              pointerEvents="none"
              stroke={stroke}
              strokeLinecap="round"
              strokeOpacity={isActive ? 0.95 : 0.82}
              strokeWidth={visibleWidthPx * unitsPerPixel}
              style={{ opacity: showVisible ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
              x1={g.x1}
              x2={g.x2}
              y1={g.y1}
              y2={g.y2}
            />
            {/* Transparent hit area along the edge. */}
            <line
              onPointerDown={(e) =>
                onHandlePointerDown(g.affordance, g.payload, e as ReactPointerEvent<SVGGElement>)
              }
              pointerEvents="stroke"
              stroke="transparent"
              strokeLinecap="round"
              strokeWidth={hitWidthPx * unitsPerPixel}
              style={{ cursor: 'pointer' }}
              vectorEffect="non-scaling-stroke"
              x1={g.x1}
              x2={g.x2}
              y1={g.y1}
              y2={g.y2}
            />
          </g>
        )
      }
      case 'midpoint-handle': {
        if (!palette) return <></>
        const handleId = makeHandleId(nodeId, g.payload)
        const isHovered = hoveredHandleId === handleId
        const isActive = activeDragId === handleId
        const stroke = palette.endpointHandleStroke
        const hoverStroke = palette.endpointHandleHoverStroke
        // Slightly smaller than endpoint dots; hover-expanded.
        const baseRadiusPx = 6
        const hoverRadiusPx = 8
        const radius = (isHovered || isActive ? hoverRadiusPx : baseRadiusPx) * unitsPerPixel
        const plusHalf = 3 * unitsPerPixel
        return (
          <g
            key={keyHint}
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={radius + 2 * unitsPerPixel}
              stroke={hoverStroke}
              strokeOpacity={0.16}
              strokeWidth={ENDPOINT_HOVER_RING_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ opacity: isHovered || isActive ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="#ffffff"
              fillOpacity={1}
              pointerEvents="none"
              r={radius}
              stroke={stroke}
              strokeOpacity={0.9}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {/* `+` icon — only when the user is close enough to see it
                clearly (hover or active state). Keeps the resting state
                visually quiet on busy polygons. */}
            <line
              pointerEvents="none"
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              x1={g.point[0] - plusHalf}
              x2={g.point[0] + plusHalf}
              y1={g.point[1]}
              y2={g.point[1]}
            />
            <line
              pointerEvents="none"
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              x1={g.point[0]}
              x2={g.point[0]}
              y1={g.point[1] - plusHalf}
              y2={g.point[1] + plusHalf}
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="transparent"
              onPointerDown={(e) =>
                onHandlePointerDown(g.affordance, g.payload, e as ReactPointerEvent<SVGGElement>)
              }
              pointerEvents="all"
              r={radius + unitsPerPixel * 2}
              stroke="transparent"
              strokeWidth={ENDPOINT_HIT_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ cursor: 'pointer' }}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      }
      case 'dimension-label': {
        if (!palette) return <></>
        // Flip the label upright relative to the SCREEN, not the local
        // coord system. The registry layer's parent `<g>` is rotated by
        // `sceneRotationDeg` (default 90° in the floor plan), so a label
        // we draw "upright" in local coords ends up sideways on screen.
        // Combine local angle + scene rotation, normalise to (-180, 180],
        // and flip by 180° if it falls outside (-90, 90] — that keeps
        // text reading left-to-right, top-to-bottom regardless of the
        // building's orientation.
        let degrees = (g.angle * 180) / Math.PI
        let screenDegrees = degrees + sceneRotationDeg
        screenDegrees = ((((screenDegrees + 180) % 360) + 360) % 360) - 180
        if (screenDegrees > 90) degrees -= 180
        else if (screenDegrees <= -90) degrees += 180

        const padX = unitsPerPixel * 6
        const padY = unitsPerPixel * 3
        const fontSize = Math.max(unitsPerPixel * 10, 0.08)
        // Rough text width approximation — SVG can't measure text without
        // the DOM. 6.2px per char at 10px font keeps the plate visually
        // balanced for the short length strings ("3.24m", "1'2\"", etc.).
        const textWidth = g.text.length * unitsPerPixel * 6.2
        const plateW = textWidth + padX * 2
        const plateH = fontSize + padY * 2
        return (
          <g
            key={keyHint}
            pointerEvents="none"
            transform={`translate(${g.cx} ${g.cy}) rotate(${degrees})`}
          >
            <rect
              fill={palette.measurementLabelBackground}
              height={plateH}
              opacity={0.92}
              rx={unitsPerPixel * 3}
              ry={unitsPerPixel * 3}
              stroke={palette.measurementStroke}
              strokeWidth={unitsPerPixel * 0.5}
              vectorEffect="non-scaling-stroke"
              width={plateW}
              x={-plateW / 2}
              y={-plateH / 2}
            />
            <text
              dominantBaseline="middle"
              fill={palette.measurementLabelText}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={fontSize}
              fontWeight={600}
              textAnchor="middle"
              x={0}
              y={0}
            >
              {g.text}
            </text>
          </g>
        )
      }
      case 'equal-spacing-badge': {
        // A distinct accent (Figma-style "=" rhythm) so equal spacing reads
        // apart from the orange placement dimensions. Same screen-upright flip
        // as the dimension-label case above.
        const accent = '#ec4899'
        let degrees = (g.angle * 180) / Math.PI
        let screenDegrees = degrees + sceneRotationDeg
        screenDegrees = ((((screenDegrees + 180) % 360) + 360) % 360) - 180
        if (screenDegrees > 90) degrees -= 180
        else if (screenDegrees <= -90) degrees += 180

        const label = `= ${g.text}`
        const padX = unitsPerPixel * 6
        const padY = unitsPerPixel * 3
        const fontSize = Math.max(unitsPerPixel * 10, 0.08)
        const textWidth = label.length * unitsPerPixel * 6.2
        const plateW = textWidth + padX * 2
        const plateH = fontSize + padY * 2
        return (
          <g
            key={keyHint}
            pointerEvents="none"
            transform={`translate(${g.point[0]} ${g.point[1]}) rotate(${degrees})`}
          >
            <rect
              fill="#ffffff"
              height={plateH}
              opacity={0.95}
              rx={unitsPerPixel * 3}
              ry={unitsPerPixel * 3}
              stroke={accent}
              strokeWidth={unitsPerPixel * 0.75}
              vectorEffect="non-scaling-stroke"
              width={plateW}
              x={-plateW / 2}
              y={-plateH / 2}
            />
            <text
              dominantBaseline="middle"
              fill={accent}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={fontSize}
              fontWeight={700}
              textAnchor="middle"
              x={0}
              y={0}
            >
              {label}
            </text>
          </g>
        )
      }
      case 'dimension': {
        if (!palette) return <></>
        const stroke = g.stroke ?? palette.measurementStroke
        // Offset endpoints along the outward normal — this is where the
        // dimension line sits, parallel to the edge.
        const ox = g.offsetNormal[0] * g.offsetDistance
        const oy = g.offsetNormal[1] * g.offsetDistance
        const dStart: [number, number] = [g.start[0] + ox, g.start[1] + oy]
        const dEnd: [number, number] = [g.end[0] + ox, g.end[1] + oy]

        // Extension line endpoints — extend past the dimension line by
        // `extensionOvershoot` so the tip clears the dimension stroke.
        const eOvershoot = g.extensionOvershoot
        const eOx = g.offsetNormal[0] * (g.offsetDistance + eOvershoot)
        const eOy = g.offsetNormal[1] * (g.offsetDistance + eOvershoot)
        const eStartTip: [number, number] = [g.start[0] + eOx, g.start[1] + eOy]
        const eEndTip: [number, number] = [g.end[0] + eOx, g.end[1] + eOy]

        const dx = dEnd[0] - dStart[0]
        const dy = dEnd[1] - dStart[1]
        const length = Math.hypot(dx, dy)
        if (length < 1e-6) return <></>
        const dirX = dx / length
        const dirY = dy / length

        // Plan-unit constants matching the legacy `floorplan-
        // measurements-layer.tsx`. `strokeWidth` is intentionally a
        // raw value (not multiplied by `unitsPerPixel`) because every
        // stroke here uses `vectorEffect: non-scaling-stroke` — the
        // browser interprets it as screen-pixel-stable. Multiplying
        // by `unitsPerPixel` would shrink the strokes by ~100× and
        // make them invisible. Tick length, dash pattern, font size,
        // and the label gap stay in plan units (they're geometry,
        // not stroke width).
        const tickHalf = 0.09 // FLOORPLAN_MEASUREMENT_END_TICK / 2 = 0.18 / 2
        const perpX = -dirY * tickHalf
        const perpY = dirX * tickHalf

        const fontSize = 0.15 // FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE
        const labelGap = 0.5 // plan units — gap in the dimension line for the label
        const gapHalf = Math.min(labelGap / 2, length / 2 - 0.04)

        const midX = (dStart[0] + dEnd[0]) / 2
        const midY = (dStart[1] + dEnd[1]) / 2
        const gapStart: [number, number] = [midX - dirX * gapHalf, midY - dirY * gapHalf]
        const gapEnd: [number, number] = [midX + dirX * gapHalf, midY + dirY * gapHalf]

        // Keep the label parallel to the dimension line, but decide the
        // 180° flip from the on-SCREEN angle, not the local one. The parent
        // `<g>` is rotated by `sceneRotationDeg` (default 90° in the floor
        // plan), so a label kept upright in local coords still renders
        // upside down for half of the wall orientations. Same fix as the
        // `dimension-label` case above.
        let labelDeg = (Math.atan2(dy, dx) * 180) / Math.PI
        let screenDeg = labelDeg + sceneRotationDeg
        screenDeg = ((((screenDeg + 180) % 360) + 360) % 360) - 180
        if (screenDeg > 90) labelDeg -= 180
        else if (screenDeg <= -90) labelDeg += 180

        return (
          <g key={keyHint} pointerEvents="none">
            {/* Extension lines (dashed). */}
            <line
              stroke={stroke}
              strokeDasharray="0.08 0.12"
              strokeLinecap="round"
              strokeOpacity={0.95}
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={g.start[0]}
              x2={eStartTip[0]}
              y1={g.start[1]}
              y2={eStartTip[1]}
            />
            <line
              stroke={stroke}
              strokeDasharray="0.08 0.12"
              strokeLinecap="round"
              strokeOpacity={0.95}
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={g.end[0]}
              x2={eEndTip[0]}
              y1={g.end[1]}
              y2={eEndTip[1]}
            />
            {/* Dimension line: two halves with the label in between. */}
            <line
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={dStart[0]}
              x2={gapStart[0]}
              y1={dStart[1]}
              y2={gapStart[1]}
            />
            <line
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={gapEnd[0]}
              x2={dEnd[0]}
              y1={gapEnd[1]}
              y2={dEnd[1]}
            />
            {/* End ticks. */}
            <line
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={dStart[0] - perpX}
              x2={dStart[0] + perpX}
              y1={dStart[1] - perpY}
              y2={dStart[1] + perpY}
            />
            <line
              stroke={stroke}
              strokeLinecap="round"
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
              x1={dEnd[0] - perpX}
              x2={dEnd[0] + perpX}
              y1={dEnd[1] - perpY}
              y2={dEnd[1] + perpY}
            />
            {/* Rotated label centered in the gap. */}
            <text
              dominantBaseline="central"
              fill={stroke}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize={fontSize}
              fontWeight={600}
              textAnchor="middle"
              transform={`rotate(${labelDeg} ${midX} ${midY})`}
              x={midX}
              y={midY}
            >
              {g.text}
            </text>
          </g>
        )
      }
      case 'text': {
        if (!g.upright) return <FloorplanGeometryRenderer geometry={g} key={keyHint} />
        // Counter-rotate by the scene rotation so the label reads
        // horizontally on screen even when the floor-plan view is
        // rotated (default `sceneRotationDeg` is 90°).
        return (
          <g key={keyHint} transform={`translate(${g.x} ${g.y}) rotate(${-sceneRotationDeg})`}>
            <text
              dominantBaseline={g.dominantBaseline ?? 'middle'}
              fill={g.fill ?? '#171717'}
              fontFamily={g.fontFamily}
              fontSize={g.fontSize}
              fontWeight={g.fontWeight}
              opacity={g.opacity}
              paintOrder={g.paintOrder}
              stroke={g.stroke}
              strokeLinecap={g.stroke ? 'round' : undefined}
              strokeLinejoin={g.stroke ? 'round' : undefined}
              strokeWidth={g.strokeWidth}
              textAnchor={g.textAnchor ?? 'start'}
              x={0}
              y={0}
            >
              {g.text}
            </text>
          </g>
        )
      }
      default:
        return (
          <FloorplanGeometryRenderer
            geometry={g}
            key={keyHint}
            pointerEventsOverride={isMarqueeSelectionActive ? 'none' : undefined}
          />
        )
    }
  }
}, shallowPropsAreEqual)

// ── Helpers ──────────────────────────────────────────────────────────

function shallowPropsAreEqual<T extends object>(a: T, b: T): boolean {
  const aKeys = Object.keys(a) as Array<keyof T>
  const bKeys = Object.keys(b) as Array<keyof T>
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}

function handleIdForNode(handleId: string | null, nodeId: AnyNodeId): string | null {
  if (!handleId) return null
  return handleId === nodeId || handleId.startsWith(`${nodeId}:`) ? handleId : null
}

function applyPositionLiveTransform(
  node: AnyNode,
  live: { position: [number, number, number]; rotation: number },
): AnyNode {
  const currentRotation = (node as { rotation?: unknown }).rotation
  const rotation = Array.isArray(currentRotation)
    ? ([
        (currentRotation[0] as number) ?? 0,
        live.rotation,
        (currentRotation[2] as number) ?? 0,
      ] as [number, number, number])
    : typeof currentRotation === 'number'
      ? live.rotation
      : currentRotation

  return {
    ...node,
    position: live.position,
    ...(rotation !== undefined ? { rotation } : {}),
    parentId: null,
  } as AnyNode
}

export function isFloorplanNodeVisible(node: AnyNode, liveOverride?: LiveNodeOverrides): boolean {
  const overrideVisible = liveOverride?.visible
  if (typeof overrideVisible === 'boolean') return overrideVisible
  return (node as { visible?: boolean }).visible !== false
}

function isFloorplanHierarchyVisible(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  liveOverrides: Map<string, LiveNodeOverrides>,
  rootId: AnyNodeId,
): boolean {
  let current: AnyNode | undefined = node
  const seen = new Set<AnyNodeId>()
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    if (!isFloorplanNodeVisible(current, liveOverrides.get(current.id))) return false
    if (current.id === rootId) return true
    const parentId = current.parentId as AnyNodeId | null
    if (!parentId) return true
    current = nodes[parentId]
  }
  return true
}

export function buildContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  viewState: {
    selected: boolean
    highlighted: boolean
    hovered: boolean
    moving: boolean
    palette: FloorplanPalette | undefined
  },
  levelData?: unknown,
): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined

  const childIds = (node as unknown as { children?: AnyNodeId[] }).children
  const children: AnyNode[] = Array.isArray(childIds)
    ? childIds.map((cid) => nodes[cid]).filter((n): n is AnyNode => n !== undefined)
    : []

  const parentId = node.parentId as AnyNodeId | null
  const parent: AnyNode | null = parentId ? (nodes[parentId] ?? null) : null

  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as unknown as { children?: AnyNodeId[] }).children
    if (Array.isArray(parentChildIds)) {
      for (const sid of parentChildIds) {
        if (sid === node.id) continue
        const s = nodes[sid]
        if (s && s.type === node.type) siblings.push(s)
      }
    } else {
      siblings = Object.values(nodes).filter(
        (n) => n !== node && n.type === node.type && n.parentId === parentId,
      )
    }
  }

  return {
    resolve,
    children,
    siblings,
    parent,
    levelData,
    viewState: viewState.palette
      ? {
          selected: viewState.selected,
          highlighted: viewState.highlighted,
          hovered: viewState.hovered,
          moving: viewState.moving,
          palette: viewState.palette,
        }
      : undefined,
  }
}

/**
 * Stable id for a handle on a node, derived from the node id + opaque
 * payload. Used to track hover / active visual state when multiple
 * handles belong to the same node (start vs end endpoint, multiple
 * vertices of a polygon, etc.).
 */
function makeHandleId(nodeId: AnyNodeId, payload: unknown): string {
  if (payload == null) return `${nodeId}`
  if (typeof payload === 'object') {
    // Stable JSON serialisation of common shapes — endpoint discriminator,
    // vertex index, etc. Don't try to handle arbitrarily-deep payloads.
    try {
      return `${nodeId}:${JSON.stringify(payload)}`
    } catch {
      return `${nodeId}`
    }
  }
  return `${nodeId}:${String(payload)}`
}

/**
 * Geometry kinds that always render in the overlay pass — interactive
 * handles and node labels. These need to sit above every kind's base
 * geometry regardless of the owning node's z-bucket so that:
 *   - polygon edit handles on a selected slab don't get hidden by the
 *     walls / items resting on top of the slab,
 *   - a zone's name stays legible above the slab covering the zone, and
 *   - measurement labels never get clipped by structural fills.
 */
const OVERLAY_KINDS = new Set<FloorplanGeometry['kind']>([
  'text',
  'endpoint-handle',
  'midpoint-handle',
  'edge-handle',
  'move-handle',
  'move-arrow',
  'rotate-arrow',
  'dimension',
  'dimension-label',
  'equal-spacing-badge',
])

/**
 * Walk a `FloorplanGeometry` tree and split it into two trees: one with
 * only "base" primitives (polygons, paths, fills, strokes) and one with
 * only "overlay" primitives (handles, labels — see `OVERLAY_KINDS`).
 *
 * Groups recurse: a `kind: 'group'` is split into a base group and an
 * overlay group, both carrying the same `transform` so nested rotations
 * / translations apply in both passes. Empty groups collapse to `null`
 * so the caller can skip emitting an `<g>` when there's nothing to draw.
 */
export function splitFloorplanOverlay(g: FloorplanGeometry): {
  base: FloorplanGeometry | null
  overlay: FloorplanGeometry | null
} {
  if (OVERLAY_KINDS.has(g.kind)) {
    return { base: null, overlay: g }
  }
  if (g.kind === 'group') {
    const baseChildren: FloorplanGeometry[] = []
    const overlayChildren: FloorplanGeometry[] = []
    for (const child of g.children) {
      const split = splitFloorplanOverlay(child)
      if (split.base) baseChildren.push(split.base)
      if (split.overlay) overlayChildren.push(split.overlay)
    }
    const base: FloorplanGeometry | null =
      baseChildren.length > 0
        ? { kind: 'group', children: baseChildren, transform: g.transform }
        : null
    const overlay: FloorplanGeometry | null =
      overlayChildren.length > 0
        ? { kind: 'group', children: overlayChildren, transform: g.transform }
        : null
    return { base, overlay }
  }
  return { base: g, overlay: null }
}

/**
 * Per-node edit chrome hidden while a multi-selection is active: the group is
 * manipulated as one rigid piece (drag to move, R/T to rotate), so individual
 * handles / dimension labels on each member would mislead. `text` stays —
 * zone names are identification, not editing chrome.
 */
const HANDLE_CHROME_KINDS = new Set<FloorplanGeometry['kind']>([
  'endpoint-handle',
  'midpoint-handle',
  'edge-handle',
  'move-handle',
  'move-arrow',
  'rotate-arrow',
  'dimension',
  'dimension-label',
  'equal-spacing-badge',
])

function stripHandleChrome(g: FloorplanGeometry): FloorplanGeometry | null {
  if (HANDLE_CHROME_KINDS.has(g.kind)) return null
  if (g.kind === 'group') {
    const children = g.children
      .map(stripHandleChrome)
      .filter((c): c is FloorplanGeometry => c !== null)
    if (children.length === 0) return null
    return { kind: 'group', children, transform: g.transform }
  }
  return g
}

// Stable string key for a wall endpoint, rounded to 1 mm so floating-point
// drift collapses while distinct corners stay distinct.
function endpointKey(x: number, y: number): string {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)}`
}

// Given the sibling-dependent nodes with a live drag in flight, the set of
// floor-plan geometries that must rebuild this frame. A node's geometry depends
// on more than its own data:
//   - a wall's miters depend on the walls meeting at each of its endpoints, so a
//     dragged wall invalidates the walls at its old AND new junctions, plus its
//     own door/window children (their cuts are drawn into it);
//   - a door/window cut is drawn into its host wall, so it invalidates that wall;
//   - a gutter join depends on sibling gutters under the same roof.
// Everything else stays cached, so dragging one wall/opening rebuilds a handful
// of geometries rather than every wall + opening on the level.
function computeAffectedSiblingIds(
  liveFlaggedIds: readonly AnyNodeId[],
  nodes: Record<string, AnyNode>,
  liveOverrides: Map<string, Record<string, unknown>>,
): Set<AnyNodeId> {
  const affected = new Set<AnyNodeId>()
  if (liveFlaggedIds.length === 0) return affected

  // Junction map (committed wall endpoint → wall ids), built lazily on first use.
  let junctions: Map<string, AnyNodeId[]> | null = null
  const wallsAtPoint = (x: number, y: number): AnyNodeId[] => {
    if (!junctions) {
      junctions = new Map()
      for (const id in nodes) {
        const n = nodes[id]
        if (n?.type !== 'wall') continue
        const w = n as unknown as { start: [number, number]; end: [number, number] }
        for (const [px, py] of [w.start, w.end]) {
          const key = endpointKey(px, py)
          const arr = junctions.get(key)
          if (arr) arr.push(id as AnyNodeId)
          else junctions.set(key, [id as AnyNodeId])
        }
      }
    }
    return junctions.get(endpointKey(x, y)) ?? []
  }

  for (const id of liveFlaggedIds) {
    const node = nodes[id]
    if (!node) continue
    affected.add(id)
    if (node.type === 'wall') {
      const w = node as unknown as {
        start: [number, number]
        end: [number, number]
        children?: AnyNodeId[]
      }
      // Use the live (override-merged) endpoints as well as the committed ones,
      // so walls at both the wall's old and new junctions get fresh miters.
      const ov = liveOverrides.get(id) as
        | { start?: [number, number]; end?: [number, number] }
        | undefined
      const points: [number, number][] = [w.start, w.end]
      if (ov?.start) points.push(ov.start)
      if (ov?.end) points.push(ov.end)
      for (const [px, py] of points) {
        for (const wid of wallsAtPoint(px, py)) affected.add(wid)
      }
      if (Array.isArray(w.children)) {
        for (const cid of w.children) {
          const child = nodes[cid]
          if (child?.type === 'door' || child?.type === 'window') affected.add(cid)
        }
      }
    } else if (node.type === 'door' || node.type === 'window') {
      const hostId = (node as { parentId?: string }).parentId
      if (hostId) affected.add(hostId as AnyNodeId)
      const liveHostId = (liveOverrides.get(id) as { parentId?: string } | undefined)?.parentId
      if (liveHostId) affected.add(liveHostId as AnyNodeId)
    } else if (node.type === 'gutter') {
      const roofId = (node as { parentId?: string }).parentId
      if (roofId) {
        for (const sid in nodes) {
          const s = nodes[sid]
          if (s?.type === 'gutter' && (s as { parentId?: string }).parentId === roofId) {
            affected.add(sid as AnyNodeId)
          }
        }
      }
    }
  }
  return affected
}

function nodeDepsEqual(a: NodeDeps, b: NodeDeps): boolean {
  const keys: Array<keyof NodeDeps> = [
    'node',
    'live',
    'selected',
    'highlighted',
    'hovered',
    'moving',
    'liveOverride',
    'palette',
    'siblingEpoch',
    'committedNodes',
    'interactiveElevators',
  ]
  for (const key of keys) {
    if (!depsValueEqual(a[key], b[key])) return false
  }
  return true
}

function depsValueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false
    }
    return true
  }
  return Object.is(a, b)
}

/**
 * Z-order bucket for floor-plan rendering. Lower rank = painted first =
 * sits under everything with a higher rank. SVG renders in document
 * order, so an earlier entry in the array ends up beneath a later one.
 *
 * Three buckets today:
 *   0 — `zone`: conceptual area regions, always under everything else.
 *   1 — `slab` / `ceiling`: the floor / ceiling surface; sits over the
 *       zone but under any structural / furniture geometry placed on it.
 *   2 — every other kind (walls, items, shelves, columns, stairs, …):
 *       structure + furniture, painted on top.
 *
 * Sort is stable in modern JS engines, so siblings within the same
 * bucket keep their DFS order (= scene tree order).
 */
export function floorplanLayerRank(type: string): number {
  switch (type) {
    case 'zone':
      return 0
    case 'slab':
    case 'ceiling':
      return 1
    default:
      return 2
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }
  return false
}

const ROTATION_WEDGE_COLOR = '#8381ed'
const ROTATION_WEDGE_SEGMENTS = 48

/**
 * Live rotation readout for the floor plan — the 2D twin of the 3D rotate
 * gizmo's wedge. Draws a filled sector + outline swept from the pointer's
 * bearing at grab (`startAngle`) to its current bearing (`endAngle`) around
 * the pivot, plus an upright degree chip at the wedge midpoint. All geometry
 * is in plan coords; the chip counter-rotates `sceneRotationDeg` so it reads
 * horizontally regardless of the building's on-screen orientation.
 */
function RotationAngleOverlay({
  overlay,
  palette,
  unitsPerPixel,
  sceneRotationDeg,
}: {
  overlay: RotationOverlayState
  palette: FloorplanPalette
  unitsPerPixel: number
  sceneRotationDeg: number
}): React.ReactElement {
  const { pivot, startAngle, endAngle, radius, sweep } = overlay
  const span = endAngle - startAngle
  const count = Math.max(8, Math.ceil((Math.abs(span) / Math.PI) * ROTATION_WEDGE_SEGMENTS))
  let d = `M ${pivot[0]} ${pivot[1]}`
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (span * i) / count
    d += ` L ${pivot[0] + Math.cos(a) * radius} ${pivot[1] + Math.sin(a) * radius}`
  }
  d += ' Z'

  const midAngle = startAngle + span / 2
  const labelDist = radius + unitsPerPixel * 14
  const lx = pivot[0] + Math.cos(midAngle) * labelDist
  const ly = pivot[1] + Math.sin(midAngle) * labelDist

  const text = `${Math.round((sweep * 180) / Math.PI)}°`
  const padX = unitsPerPixel * 6
  const padY = unitsPerPixel * 3
  const fontSize = Math.max(unitsPerPixel * 10, 0.08)
  const textWidth = text.length * unitsPerPixel * 6.2
  const plateW = textWidth + padX * 2
  const plateH = fontSize + padY * 2

  return (
    <g className="floorplan-rotation-readout" pointerEvents="none">
      <path d={d} fill={ROTATION_WEDGE_COLOR} fillOpacity={0.18} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke={ROTATION_WEDGE_COLOR}
        strokeLinejoin="round"
        strokeOpacity={0.95}
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
      />
      {/* Counter-rotate the scene transform so the chip stays horizontal. */}
      <g transform={`translate(${lx} ${ly}) rotate(${-sceneRotationDeg})`}>
        <rect
          fill={palette.measurementLabelBackground}
          height={plateH}
          opacity={0.92}
          rx={unitsPerPixel * 3}
          ry={unitsPerPixel * 3}
          stroke={palette.measurementStroke}
          strokeWidth={unitsPerPixel * 0.5}
          vectorEffect="non-scaling-stroke"
          width={plateW}
          x={-plateW / 2}
          y={-plateH / 2}
        />
        <text
          dominantBaseline="middle"
          fill={palette.measurementLabelText}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={fontSize}
          fontWeight={600}
          textAnchor="middle"
          x={0}
          y={0}
        >
          {text}
        </text>
      </g>
    </g>
  )
}

function formatGroupTransform(t?: {
  translate?: readonly [number, number]
  rotate?: number
}): string | undefined {
  if (!t) return undefined
  const parts: string[] = []
  if (t.translate) parts.push(`translate(${t.translate[0]} ${t.translate[1]})`)
  if (t.rotate !== undefined) parts.push(`rotate(${(t.rotate * 180) / Math.PI})`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function swallowNextClick(timeoutMs = 0) {
  const swallowClick = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    window.removeEventListener('click', swallowClick, true)
  }
  window.addEventListener('click', swallowClick, true)
  setTimeout(() => {
    window.removeEventListener('click', swallowClick, true)
  }, timeoutMs)
}
