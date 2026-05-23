'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanAffordancePoint,
  type FloorplanAffordanceSession,
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  nodeRegistry,
  pauseSceneHistory,
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
import { sfxEmitter } from '../../../lib/sfx-bus'
import { isPlanDragMovableNode, PLAN_DRAG_THRESHOLD_PX } from '../../../lib/plan-drag'
import useEditor from '../../../store/use-editor'
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
}

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

export const FloorplanRegistryLayer = memo(function FloorplanRegistryLayer() {
  const levelId = useViewer((s) => s.selection.levelId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const setHoveredId = useViewer((s) => s.setHoveredId)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const renderCtx = useFloorplanRender()
  const movingNode = useEditor((s) => s.movingNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  // Subscribe to the live-transforms map ref so the layer re-renders
  // whenever a 3D mover publishes a per-frame position (see
  // `usePlacementCoordinator`). Without this the 2D floor plan only
  // updates after 3D commit — the 3D drag would look frozen in 2D.
  const liveTransforms = useLiveTransforms((s) => s.transforms)
  // Same reactivity hook for elevator runtime state — `useInteractive`
  // tracks the current / fallback level + cab travel, `useLiveNode
  // Overrides` carries live-edit overrides from the inspector. Builders
  // read both via `getState()` inside `def.floorplan`; subscribing here
  // is what forces the layer to re-render when they change.
  const liveOverrides = useLiveNodeOverrides((s) => s.overrides)
  const interactiveElevators = useInteractive((s) => s.elevators)

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Marquee preview selection — matches the legacy `highlightedIdSet` use
  // (filter-while-marquee), surfaces selection chrome without keyboard focus.
  const highlightedIdSet = useMemo(() => new Set(previewSelectedIds), [previewSelectedIds])

  // Interactive state lives in refs; only the visible feedback bits go
  // into React state to keep re-renders cheap during drag.
  const dragRef = useRef<ActiveDrag | null>(null)
  const pendingItemDragRef = useRef<{
    nodeId: AnyNodeId
    startX: number
    startY: number
  } | null>(null)
  const [hoveredHandleId, setHoveredHandleId] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  const handleSelect = useCallback(
    (id: AnyNodeId, event: React.PointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      setSelection({ selectedIds: [id] })

      const node = useScene.getState().nodes[id]
      if (node && isPlanDragMovableNode(node) && !movingNode) {
        pendingItemDragRef.current = {
          nodeId: id,
          startX: event.clientX,
          startY: event.clientY,
        }
      }
    },
    [movingNode, setSelection],
  )

  useEffect(() => {
    const tryStartItemDrag = (clientX: number, clientY: number) => {
      const pending = pendingItemDragRef.current
      if (!pending || movingNode) return
      const dx = clientX - pending.startX
      const dy = clientY - pending.startY
      if (Math.hypot(dx, dy) < PLAN_DRAG_THRESHOLD_PX) return

      const node = useScene.getState().nodes[pending.nodeId]
      if (!node || !isPlanDragMovableNode(node)) return

      pendingItemDragRef.current = null
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node as never)
    }

    const clearPendingItemDrag = () => {
      pendingItemDragRef.current = null
    }

    const onPointerMove = (event: PointerEvent) => {
      tryStartItemDrag(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', clearPendingItemDrag)
    window.addEventListener('pointercancel', clearPendingItemDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', clearPendingItemDrag)
      window.removeEventListener('pointercancel', clearPendingItemDrag)
      pendingItemDragRef.current = null
    }
  }, [movingNode, setMovingNode])

  const handleClickStop = useCallback((event: React.MouseEvent<SVGGElement>) => {
    event.stopPropagation()
  }, [])

  // Build the geometry list. `viewState` flows into ctx so kinds can
  // theme their output and conditionally emit selection chrome.
  //
  // Each entry carries TWO trees:
  //   - `base`: filled shapes, strokes, polygons, hatches — anything
  //     that should respect the kind's z-order bucket.
  //   - `overlay`: interactive handles (vertex / midpoint / edge / move)
  //     and labels (text / dimension). These always render on top of
  //     every base entry so selection chrome and node names stay visible
  //     above walls, items, etc.
  //
  // The split is computed by `splitFloorplanOverlay` from the single
  // tree the builder returns. Builders don't need to know about the
  // partition.
  const entries = useMemo(() => {
    if (!levelId) return []
    const out: {
      id: AnyNodeId
      node: AnyNode
      base: FloorplanGeometry | null
      overlay: FloorplanGeometry | null
      selected: boolean
      highlighted: boolean
    }[] = []

    const visit = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return
      const def = nodeRegistry.get(node.type)
      const builder = def?.floorplan
      if (builder) {
        const selected = selectedIdSet.has(id)
        const highlighted = highlightedIdSet.has(id)
        const hovered = hoveredId === id
        const moving = movingNode?.id === id
        // Live-transform override — when a mover is publishing per-frame
        // position/rotation, render that here instead of the committed
        // scene state. Without this the 2D floor plan would only update
        // after commit, making the drag look frozen.
        //
        // The live-transform contract varies per kind (see
        // wiki/architecture/tools.md "useLiveTransforms contract is
        // per-kind, not generic"); we narrow per kind here:
        //   - item: world-plan position frame. Override `position` +
        //     `rotation` and force `parentId: null` so the resolver
        //     treats them as world coords directly.
        //   - slab / ceiling: position is a translation **delta**
        //     (`[Δx, 0, Δz]`). Translate the polygon + holes by the
        //     delta — the floor-plan builder draws the polygon at its
        //     new location, mirroring the 3D `<group position={delta}>`
        //     visual without forcing per-tick CSG scene writes.
        const live = liveTransforms.get(id)
        let effectiveNode: AnyNode = node
        if (live) {
          if (node.type === 'item' || node.type === 'shelf') {
            // World-plan position kinds: the live transform carries the
            // node's intended position/rotation in level-local coords.
            // Override both and force `parentId: null` so the floor-plan
            // resolver treats `position` as world plan coords directly
            // (skipping the parent-chain transform composition).
            effectiveNode = {
              ...node,
              position: live.position,
              rotation: [0, live.rotation, 0] as [number, number, number],
              parentId: null,
            } as AnyNode
          } else if (node.type === 'stair') {
            effectiveNode = {
              ...node,
              position: live.position,
            } as AnyNode
          } else if (node.type === 'slab' || node.type === 'ceiling') {
            const dx = live.position[0]
            const dz = live.position[2]
            if (dx !== 0 || dz !== 0) {
              const surface = node as {
                polygon: Array<[number, number]>
                holes?: Array<Array<[number, number]>>
              }
              effectiveNode = {
                ...node,
                polygon: surface.polygon.map(([x, z]) => [x + dx, z + dz] as [number, number]),
                holes: (surface.holes ?? []).map((h) =>
                  h.map(([x, z]) => [x + dx, z + dz] as [number, number]),
                ),
              } as AnyNode
            }
          }
        }
        const ctx = buildContext(effectiveNode, nodes, {
          selected,
          highlighted,
          hovered,
          moving,
          palette: renderCtx?.palette,
        })
        const geometry = (builder as (n: AnyNode, c: GeometryContext) => FloorplanGeometry | null)(
          effectiveNode,
          ctx,
        )
        if (geometry) {
          const { base, overlay } = splitFloorplanOverlay(geometry)
          out.push({ id, node: effectiveNode, base, overlay, selected, highlighted })
        }
      }
      const childIds = (node as unknown as { children?: AnyNodeId[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(levelId as AnyNodeId)

    // Stable z-order sort. SVG renders in document order — later siblings
    // paint on top of earlier ones — so anything that should sit *under*
    // other floor-plan geometry has to come first in the entries array.
    // Zones are conceptual room/area regions; walls / slabs / furniture
    // all belong on top of them. Within a layer bucket we preserve the
    // DFS visit order (stable sort) so siblings keep their relative
    // priority.
    out.sort((a, b) => floorplanLayerRank(a.node.type) - floorplanLayerRank(b.node.type))
    return out
  }, [
    levelId,
    nodes,
    liveTransforms,
    selectedIdSet,
    highlightedIdSet,
    hoveredId,
    movingNode?.id,
    renderCtx?.palette,
  ])

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

      const session = handler.start({
        node,
        payload,
        nodes: sceneNodes,
        initialPlanPoint,
      })

      const snapshots: NodeSnapshot[] = []
      for (const id of session.affectedIds) {
        const n = sceneNodes[id]
        if (n) snapshots.push(snapshotNode(n))
      }

      pauseSceneHistory(useScene)

      dragRef.current = {
        pointerId: event.pointerId,
        handleId,
        session,
        snapshots,
        historyPaused: true,
      }
      setActiveDragId(handleId)
      setSelection({ selectedIds: [nodeId] })
      ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    },
    [movingNode, setSelection],
  )

  useEffect(() => {
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
    }

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      const commitValid = drag.session.canCommit()

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
        // resume without committing.
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
          drag.historyPaused = false
        }
      }

      dragRef.current = null
      setActiveDragId(null)
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

      dragRef.current = null
      setActiveDragId(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      // Component unmounted mid-drag — restore the baseline and unpause
      // history so we don't leak a paused store across mounts.
      const drag = dragRef.current
      if (drag) {
        useScene.getState().updateNodes(snapshotsToUpdates(drag.snapshots))
        if (drag.historyPaused) {
          resumeSceneHistory(useScene)
        }
        dragRef.current = null
      }
    }
  }, [])

  if (entries.length === 0) return null

  const unitsPerPixel = renderCtx?.unitsPerPixel ?? 1
  const palette = renderCtx?.palette

  const renderEntry = (id: AnyNodeId, geometry: FloorplanGeometry, key: string) => (
    <g
      className="floorplan-registry-entry"
      data-node-id={id}
      key={key}
      onClick={handleClickStop}
      onPointerDown={(e) => handleSelect(id, e)}
      // Mirror the sidebar tree nodes' hover wiring — `useViewer.
      // hoveredId` drives the highlight halo in 3D as well as the
      // wall / fence floor-plan hover stroke. Setting it on
      // pointer-enter and clearing on leave keeps the two views in
      // sync. Without this the registry-driven kinds had hover
      // visuals defined but never reached because the entry `<g>`
      // never updated the store.
      onPointerEnter={() => setHoveredId(id)}
      onPointerLeave={() => {
        // Only clear when this entry is the one we last set —
        // avoids racing with sibling entries during fast-moving
        // pointer scans.
        if (useViewer.getState().hoveredId === id) setHoveredId(null)
      }}
      style={{ cursor: 'pointer' }}
    >
      <InteractiveGeometry
        activeDragId={activeDragId}
        geometry={geometry}
        hatchPatternId={renderCtx?.hatchPatternId}
        hoveredHandleId={hoveredHandleId}
        nodeId={id}
        onHandleHoverChange={setHoveredHandleId}
        onHandlePointerDown={(affordance, payload, event) =>
          startAffordanceDrag(id, makeHandleId(id, payload), affordance, payload, event)
        }
        onMoveHandlePointerDown={(event) => {
          if (event.button !== 0) return
          const node = useScene.getState().nodes[id]
          if (!node) return
          event.preventDefault()
          event.stopPropagation()
          sfxEmitter.emit('sfx:item-pick')
          setMovingNode(node as never)
        }}
        palette={palette}
        unitsPerPixel={unitsPerPixel}
      />
    </g>
  )

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
    <g className="floorplan-registry-layer" onClick={handleClickStop}>
      {/* Base pass — rank-sorted body geometry (polygons, paths, fills,
          strokes, hatches). Lower-rank kinds (zones) paint first so
          higher-rank kinds (slabs, then walls / items / shelves) layer
          on top in the expected document-order z-stack. */}
      <g className="floorplan-registry-base">
        {entries.map(({ id, base }) => (base ? renderEntry(id, base, `base-${id}`) : null))}
      </g>
      {/* Overlay pass — interactive handles (vertex / midpoint / edge /
          move) and labels (text / dimensions). Painted after every base
          entry so polygon-editor chrome on a selected slab stays above
          neighbouring walls, and a zone name stays readable above the
          slab + wall geometry sitting on top of the zone. Each overlay
          still routes through the same selection-handling `<g>` so a
          click on a zone's name selects the zone. */}
      <g className="floorplan-registry-overlay">
        {entries.map(({ id, overlay }) =>
          overlay ? renderEntry(id, overlay, `overlay-${id}`) : null,
        )}
      </g>
    </g>
  )
})

// ── Interactive geometry walker ──────────────────────────────────────

function InteractiveGeometry({
  geometry,
  unitsPerPixel,
  palette,
  hatchPatternId,
  hoveredHandleId,
  activeDragId,
  nodeId,
  onHandleHoverChange,
  onHandlePointerDown,
  onMoveHandlePointerDown,
}: {
  geometry: FloorplanGeometry
  unitsPerPixel: number
  palette: FloorplanPalette | undefined
  hatchPatternId: string | undefined
  hoveredHandleId: string | null
  activeDragId: string | null
  nodeId: AnyNodeId
  onHandleHoverChange: (id: string | null) => void
  onHandlePointerDown: (
    affordance: string,
    payload: unknown,
    event: ReactPointerEvent<SVGGElement>,
  ) => void
  onMoveHandlePointerDown: (event: ReactPointerEvent<SVGGElement>) => void
}): React.ReactElement {
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
            pointerEvents="stroke"
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
        // Move dots are visually bigger than endpoint handles — the
        // legacy prod render uses ~13px outer / ~6px dot. Endpoint
        // handles top out at 8/9px because there are usually two per
        // wall + linked walls + curve handle nearby; the move dot is
        // a singleton centerpiece so it can afford the extra weight.
        const baseRadiusPx = 13
        const hoverRadiusPx = 15
        const outerRadius = (isHovered ? hoverRadiusPx : baseRadiusPx) * unitsPerPixel
        const dotRadius = 6 * unitsPerPixel
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
              strokeWidth={ENDPOINT_HOVER_GLOW_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ opacity: isHovered ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={palette.endpointHandleHoverStroke}
              strokeOpacity={0.52}
              strokeWidth={ENDPOINT_HOVER_RING_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ opacity: isHovered ? 1 : 0, transition: HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={palette.endpointHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={palette.endpointHandleStroke}
              strokeWidth="0.05"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill={palette.endpointHandleStroke}
              pointerEvents="none"
              r={dotRadius}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={g.point[0]}
              cy={g.point[1]}
              fill="transparent"
              onPointerDown={(e) => onMoveHandlePointerDown(e as ReactPointerEvent<SVGGElement>)}
              pointerEvents="all"
              r={outerRadius}
              stroke="transparent"
              strokeWidth={ENDPOINT_HIT_STROKE_WIDTH_PX * unitsPerPixel}
              style={{ cursor: 'move' }}
              vectorEffect="non-scaling-stroke"
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
        // Flip the label upright if it would otherwise be upside-down
        // (legacy floorplan-panel.tsx does the same — see line ~2548).
        let degrees = (g.angle * 180) / Math.PI
        if (degrees > 90) degrees -= 180
        else if (degrees <= -90) degrees += 180

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

        let labelDeg = (Math.atan2(dy, dx) * 180) / Math.PI
        if (labelDeg > 90) labelDeg -= 180
        else if (labelDeg <= -90) labelDeg += 180

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
      default:
        return <FloorplanGeometryRenderer geometry={g} key={keyHint} />
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  viewState: {
    selected: boolean
    highlighted: boolean
    hovered: boolean
    moving: boolean
    palette: FloorplanPalette | undefined
  },
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
  'dimension',
  'dimension-label',
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
function splitFloorplanOverlay(g: FloorplanGeometry): {
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
function floorplanLayerRank(type: string): number {
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

function clientToPlan(clientX: number, clientY: number): FloorplanAffordancePoint | null {
  // The registry layer lives under the floor-plan scene `<g>`. The
  // legacy panel computes the same conversion via floorplanSceneRef +
  // getScreenCTM; we replicate it by walking up to the SVG owner.
  const target = document.querySelector('g[data-floorplan-scene]') as SVGGElement | null
  const svg = target?.ownerSVGElement
  if (!(svg && target)) return null
  const ctm = target.getScreenCTM()
  if (!ctm) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const transformed = point.matrixTransform(ctm.inverse())
  // The floor-plan `<g>` maps plan X/Z directly to SVG x/y (Z stored as
  // the Y axis on screen — same convention as `toSvgPlanPoint`).
  return [transformed.x, transformed.y]
}
