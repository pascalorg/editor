'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type Cursor,
  type DuctSegmentNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  ARROW_SCALE,
  DimensionPill,
  EDITOR_LAYER,
  HandleArrow,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DoubleSide,
  type Group,
  type Object3D,
  OrthographicCamera,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import {
  detectElbowEndpoint,
  type ElbowEndpoint,
  planElbowEndpointReaim,
} from '../shared/elbow-endpoint-reaim'
import { collectScenePorts, DUCT_PORT_SYSTEMS, findNearestPortXZ } from '../shared/ports'
import { INCHES_TO_METERS } from './geometry'

/** Corner hex-disc radius (meters) — matches the wall corner picker. */
const HANDLE_RADIUS = 0.11
const HANDLE_COLOR = '#818cf8'
const HANDLE_HOVER_COLOR = '#a5b4fc'
/** Port-snap radius for dragged run endpoints (meters, XZ). */
const PORT_SNAP_RADIUS_M = 0.4

// In-world arrow handle layout (meters) — mirrors the wall side handles so
// the duct affordances read as the same UI family.
const SIDE_ARROW_GAP = 0.27
const SIDE_ARROW_MIN_OFFSET = 0.33
const HEIGHT_ARROW_OFFSET = 0.3
/** Below this horizontal segment length (m) a side-move arrow is pointless
 *  (a riser collapses to a point in plan) and is skipped. */
const MIN_PLAN_SEGMENT_LEN = 0.05

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Half the run's cross-section (meters) — the arrow stand-off radius. */
function runRadiusM(duct: DuctSegmentNode): number {
  if (duct.shape === 'round') return (duct.diameter * INCHES_TO_METERS) / 2
  return (Math.max(duct.width, duct.height) * INCHES_TO_METERS) / 2
}

type Point = [number, number, number]

type SideMoveHandle = {
  key: string
  /** Segment whose two vertices both translate along the normal. */
  segmentIndex: number
  /** Unit XZ normal the arrow points along (away from the run body). */
  normal: [number, number]
  /** World-local arrow position (already offset off the body). */
  position: Point
  rotationY: number
}

/**
 * Selection-time editing for committed duct runs: one draggable handle
 * per path point.
 *
 * Handles are PORTALED into the duct's registered scene group so they
 * share its exact frame — path coords are node-local, and the level /
 * building transform above the group applies to the handles for free.
 * Drag raycasts run in world space and convert hits back into the
 * group's local frame before writing the path.
 *
 * Drag model: the point moves FREELY on the horizontal plane at its own
 * height (no axis lock) — like a wall corner. Dragged run endpoints snap
 * onto nearby typed ports so a loose run can be mated onto a fitting after
 * the fact. When the dragged endpoint belongs to a straight run whose OTHER
 * end sits on an elbow collar, the elbow re-aims to follow the drag
 * (junction + far collar fixed, bend angle adapts) instead of port-snapping.
 *
 * Modifiers (mirroring the wall corner drag):
 * - **Alt** detaches: the joint breaks for this drag — the elbow does NOT
 *   re-aim and mated fittings / runs do NOT follow; the endpoint moves on its
 *   own (port re-mate still allowed so it can be reattached elsewhere).
 * - **Cmd / Ctrl** switches to vertical movement (riser editing): XZ holds
 *   and the cursor drives Y.
 * - **Shift** bypasses grid snapping for a perfectly smooth precision drag.
 *
 * History does the single-undo dance: paused during the drag (the live
 * `updateNode` ticks are untracked), then on release the path is
 * reverted, history resumed, and the final path applied as one tracked
 * change.
 */
const DuctSegmentSelectionAffordance = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const duct = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const node = s.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'duct-segment' ? (node as DuctSegmentNode) : null
  })

  // Portal target: the duct's registered group. Resolved with a rAF
  // retry because registration happens on the renderer's mount, which
  // can land a frame after selection.
  const ductId = duct?.id ?? null
  const [target, setTarget] = useState<Object3D | null>(null)
  useEffect(() => {
    if (!ductId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(ductId as AnyNodeId) ?? null
      setTarget((cur) => (cur === next ? cur : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [ductId])

  if (!duct || !target) return null
  // Mount the handles in the duct group's PARENT (a sibling of the duct
  // mesh), NOT inside the duct group itself. The selection outliner
  // (`MergedOutlineNode`) traces every descendant mesh of the SELECTED node,
  // so a hit-area cylinder parented under the duct would get swept into the
  // duct's selection outline — the stray circle around the arrows. Walls /
  // doors / windows dodge this the same way: their handle rig rides the
  // parent, never the selected node. `DuctPointHandles` re-creates the duct
  // group's own pose on an outer group so placements stay node-local.
  const mount = target.parent ?? target
  return createPortal(<DuctPointHandles duct={duct} target={target} />, mount, undefined)
}

const DuctPointHandles = ({ duct, target }: { duct: DuctSegmentNode; target: Object3D }) => {
  const { camera, gl } = useThree()
  // Outer group mirrors the duct group's local pose so handles placed in
  // node-local path coords land exactly where the duct mesh sits, even though
  // they're mounted in the parent (to stay out of the duct's selection
  // outline). Mirrors the wall arrow rig's ride-group.
  const outerRef = useRef<Group>(null)
  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })
  const unit = useViewer((s) => s.unit)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // True while a side-move / height / extend arrow drag is live. The arrows
  // (and the dragged one) hide during the drag — the window pointer handlers
  // own it from pointer-down — exactly like the wall side handles.
  const [arrowDragging, setArrowDragging] = useState(false)
  // Set while a drag is live; null otherwise. Holds everything the window
  // pointer handlers need so they never read stale React state.
  const dragRef = useRef<{
    index: number
    initialPath: Point[]
    current: Point
    cleanup: () => void
    // Connectivity snapshot taken at pointer-down: which fittings / ducts are
    // mated to this run's endpoints, so they follow as the endpoint moves.
    connectivity: PortConnectivity | null
    // Set when the run's OTHER end sits on an elbow collar: the elbow re-aims
    // to follow this drag instead of translating rigidly (mutually exclusive
    // with `connectivity`-driven follow for this endpoint).
    elbowEndpoint: ElbowEndpoint | null
    // True while Alt is held: the joint is detached for this drag, so the
    // final commit must omit elbow / connectivity updates. Tracked live so
    // `onUp` knows what the last frame did.
    detached: boolean
  } | null>(null)

  const makeRay = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new Raycaster()
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray
  }

  const intersect = (clientX: number, clientY: number, plane: Plane): Vector3 | null => {
    const hit = new Vector3()
    return makeRay(clientX, clientY).intersectPlane(plane, hit) ? hit : null
  }

  /**
   * Local-frame Y where the cursor ray meets a vertical plane through
   * `anchorWorld` that faces the camera — drives Alt-vertical (riser) drag.
   * Null when the ray is parallel to the plane.
   */
  const intersectVerticalY = (
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
  ): number | null => {
    // Plane normal: camera forward flattened onto the horizontal plane, so
    // the plane stands upright through the point and faces the viewer.
    const forward = camera.getWorldDirection(new Vector3())
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1)
    forward.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(forward, anchorWorld)
    const hit = intersect(clientX, clientY, plane)
    return hit ? toLocal(hit)[1] : null
  }

  // Build the per-frame update batch for the dragged endpoint at `next`.
  // Detached (Alt): only the duct path moves — no elbow re-aim, no
  // connectivity follow. Elbow mode: the run rides the elbow's re-aimed
  // collar and the elbow swings to fit. Otherwise: the dragged point moves
  // and any mated fittings / runs translate via connectivity.
  const buildDragBatch = (
    drag: NonNullable<typeof dragRef.current>,
    next: Point,
    detached: boolean,
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] | null => {
    if (!detached && drag.elbowEndpoint) {
      const plan = planElbowEndpointReaim(drag.elbowEndpoint, drag.index, next)
      // Out of the elbow's buildable turn range — hold this frame.
      if (!plan) return null
      return [
        { id: duct.id as AnyNodeId, data: { path: plan.path } },
        { id: plan.elbowUpdate.id, data: plan.elbowUpdate.data as Partial<AnyNode> },
      ]
    }
    const path = duct.path.map((p, i) => (i === drag.index ? next : p)) as Point[]
    return [
      { id: duct.id as AnyNodeId, data: { path } },
      ...(detached ? [] : connectivityUpdatesForPath(drag.connectivity, path)),
    ]
  }

  /** World-space position of a local path point. */
  const toWorld = (p: Point): Vector3 => target.localToWorld(new Vector3(p[0], p[1], p[2]))
  /** Convert a world-space hit back into the duct group's local frame. */
  const toLocal = (world: Vector3): Point => {
    const local = target.worldToLocal(world.clone())
    return [local.x, local.y, local.z]
  }

  // Follow-updates for fittings / ducts mated to this run's endpoints, given
  // the run's live path. Endpoints whose position didn't change resolve to a
  // zero delta, so only the dragged endpoint's partner actually moves.
  const connectivityUpdatesForPath = (
    connectivity: PortConnectivity | null,
    path: Point[],
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] => {
    if (!connectivity) return []
    const preview = { ...(duct as Record<string, unknown>), path } as AnyNode
    return resolveConnectivityUpdates(connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }

  const onHandleDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = duct.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    const connectivity = analyzePortConnectivity(duct as AnyNode, useScene.getState().nodes)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'grabbing'
    setDraggingIndex(index)

    const isEndpoint = index === 0 || index === initialPath.length - 1

    // Elbow re-aim: if this is a straight run whose OTHER end sits on an
    // elbow collar, the elbow swings to follow the drag (junction + far
    // collar fixed, bend angle adapts) — so the dragged end moves freely in
    // any direction instead of being locked to the segment's own axis, the
    // way a wall corner drags. Detected once against a drag-start snapshot.
    const elbowEndpoint: ElbowEndpoint | null = isEndpoint
      ? detectElbowEndpoint('duct-segment', initialPath, index, useScene.getState().nodes)
      : null

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const current = drag.current
      // Shift = precision: bypass grid snapping for a perfectly smooth
      // drag (snap() is a no-op at step 0).
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      // Alt = detach: break the joint for this drag — the endpoint moves on
      // its own, no elbow re-aim and no connectivity follow (it can still
      // port-snap to re-mate elsewhere). Mirrors the wall corner drag.
      const detached = event.altKey
      let next: Point | null = null
      if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl = vertical: keep XZ fixed and drive Y off the cursor
        // against a vertical plane through the point (riser editing).
        const y = intersectVerticalY(event.clientX, event.clientY, toWorld(current))
        if (y !== null) next = [current[0], Math.max(0, snap(y, step)), current[2]]
      } else {
        // Default: free movement on the horizontal plane at the point's
        // height (no axis lock). Endpoints can port-snap to mate a fitting.
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(current))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          next = [snap(local[0], step), current[1], snap(local[2], step)]
          // Port re-mate stays available whether detaching or free-dragging;
          // it's only suppressed while the elbow is actively re-aiming.
          if (isEndpoint && (detached || !drag.elbowEndpoint)) {
            const port = findNearestPortXZ(
              [local[0], current[1], local[2]],
              collectScenePorts({ excludeNodeId: duct.id, systems: DUCT_PORT_SYSTEMS }),
              PORT_SNAP_RADIUS_M,
            )
            if (port) next = [port.position[0], port.position[1], port.position[2]]
          }
        }
      }
      if (!next) return
      if (next[0] === current[0] && next[1] === current[1] && next[2] === current[2]) return
      const batch = buildDragBatch(drag, next, detached)
      if (!batch) return
      drag.current = next
      drag.detached = detached
      useScene.getState().updateNodes(batch)
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      drag.cleanup()
      dragRef.current = null
      setDraggingIndex(null)
      // Single-undo dance: revert (still paused), resume, re-apply the final
      // batch as one tracked change. The final batch is built the same way as
      // each live frame (elbow re-aim, rigid connectivity follow, or — when
      // detached — just the duct path).
      const detached = drag.detached
      const finalBatch = buildDragBatch(drag, drag.current, detached)
      // Revert the run AND whatever the drag carried to their pre-drag state
      // while paused so history captures a clean before→after delta. When
      // detached nothing else moved, so only the run needs reverting.
      const revertUpdates: { id: AnyNodeId; data: Partial<AnyNode> }[] = detached
        ? []
        : drag.elbowEndpoint
          ? [
              {
                id: drag.elbowEndpoint.elbow.id as AnyNodeId,
                data: {
                  angle: drag.elbowEndpoint.elbow.angle,
                  rotation: drag.elbowEndpoint.elbow.rotation,
                } as Partial<AnyNode>,
              },
            ]
          : (drag.connectivity?.connections ?? []).map((conn) =>
              conn.kind === 'rigid-node'
                ? { id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }
                : { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> },
            )
      useScene
        .getState()
        .updateNodes([
          { id: duct.id as AnyNodeId, data: { path: drag.initialPath } },
          ...revertUpdates.filter((u) => useScene.getState().nodes[u.id]),
        ])
      resumeSceneHistory(useScene)
      const moved = drag.current.some((v, axis) => v !== drag.initialPath[drag.index]![axis])
      if (moved && finalBatch) {
        useScene.getState().updateNodes(finalBatch)
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
    }

    dragRef.current = {
      index,
      initialPath,
      current: startPoint,
      cleanup,
      connectivity,
      elbowEndpoint,
      detached: false,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /**
   * Shared lifecycle for the in-world arrow handles (side-move / height /
   * extend). Each frame `compute` turns the cursor into a full next path;
   * the duct writes it and any mated fittings / runs follow via port
   * connectivity. `makeCompute` is built at pointer-down so it can capture
   * the grab anchor (height needs the cursor's start Y to avoid a teleport).
   * History does the same single-undo dance as the corner-handle drag.
   */
  const beginArrowDrag =
    (
      cursor: string,
      makeCompute: (
        e: ThreeEvent<PointerEvent>,
      ) => (event: PointerEvent, initialPath: Point[]) => Point[] | null,
    ) =>
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const initialPath = duct.path.map((p) => [...p] as Point)
      const connectivity = analyzePortConnectivity(duct as AnyNode, useScene.getState().nodes)
      const compute = makeCompute(e)
      pauseSceneHistory(useScene)
      useViewer.getState().setInputDragging(true)
      setArrowDragging(true)
      document.body.style.cursor = cursor
      let currentPath = initialPath

      const buildBatch = (path: Point[]): { id: AnyNodeId; data: Partial<AnyNode> }[] => [
        { id: duct.id as AnyNodeId, data: { path } as Partial<AnyNode> },
        ...connectivityUpdatesForPath(connectivity, path),
      ]

      const onMove = (event: PointerEvent) => {
        const next = compute(event, initialPath)
        if (!next) return
        const same = next.every(
          (p, i) =>
            p[0] === currentPath[i]![0] &&
            p[1] === currentPath[i]![1] &&
            p[2] === currentPath[i]![2],
        )
        if (same) return
        currentPath = next
        useScene.getState().updateNodes(buildBatch(next))
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        useViewer.getState().setInputDragging(false)
        setArrowDragging(false)
        if (document.body.style.cursor === cursor) document.body.style.cursor = ''
      }

      const onUp = () => {
        cleanup()
        const moved = currentPath.some((p, i) => p.some((v, axis) => v !== initialPath[i]![axis]))
        // Single-undo dance: revert the run AND its followers to their
        // pre-drag state while history is still paused, resume, then re-apply
        // the final batch as one tracked change.
        const revertUpdates: { id: AnyNodeId; data: Partial<AnyNode> }[] = (
          connectivity?.connections ?? []
        ).map((conn) =>
          conn.kind === 'rigid-node'
            ? { id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }
            : { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> },
        )
        useScene
          .getState()
          .updateNodes([
            { id: duct.id as AnyNodeId, data: { path: initialPath } },
            ...revertUpdates.filter((u) => useScene.getState().nodes[u.id]),
          ])
        resumeSceneHistory(useScene)
        if (moved) useScene.getState().updateNodes(buildBatch(currentPath))
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

  // Side-move: slide one segment perpendicular to itself. Both its vertices
  // translate by the same plan-normal offset; neighbours stretch and any
  // mated joint follows via connectivity. Grid-snapped (Shift bypasses).
  const sideMoveCompute =
    (handle: SideMoveHandle) =>
    () =>
    (event: PointerEvent, initialPath: Point[]): Point[] | null => {
      const a = initialPath[handle.segmentIndex]!
      const b = initialPath[handle.segmentIndex + 1]!
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
      const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(mid))
      const hit = intersect(event.clientX, event.clientY, plane)
      if (!hit) return null
      const local = toLocal(hit)
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      const signed = snap(
        (local[0] - mid[0]) * handle.normal[0] + (local[2] - mid[2]) * handle.normal[1],
        step,
      )
      const ox = handle.normal[0] * signed
      const oz = handle.normal[1] * signed
      return initialPath.map((p, i) =>
        i === handle.segmentIndex || i === handle.segmentIndex + 1
          ? ([p[0] + ox, p[1], p[2] + oz] as Point)
          : p,
      )
    }

  // Height: raise / lower the WHOLE run uniformly. Anchored to the cursor's
  // start Y so the run doesn't jump on grab; clamped so the lowest vertex
  // never drops below the level floor. 3D-only — plan editing never changes
  // elevation (see the floor-plan path-point affordance).
  const heightCompute = (anchor: Point) => (e: ThreeEvent<PointerEvent>) => {
    const anchorWorld = toWorld(anchor)
    const startY = intersectVerticalY(e.nativeEvent.clientX, e.nativeEvent.clientY, anchorWorld)
    return (event: PointerEvent, initialPath: Point[]): Point[] | null => {
      if (startY === null) return null
      const y = intersectVerticalY(event.clientX, event.clientY, anchorWorld)
      if (y === null) return null
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      let dy = snap(y - startY, step)
      const minY = Math.min(...initialPath.map((p) => p[1]))
      if (dy < -minY) dy = -minY
      return initialPath.map((p) => [p[0], p[1] + dy, p[2]] as Point)
    }
  }

  const sideHandles = useMemo(() => getSideMoveHandles(duct), [duct])
  const heightHandle = useMemo(() => getHeightHandle(duct), [duct])

  return (
    <group ref={outerRef}>
      {duct.path.map((p, i) => (
        <HexHandle
          active={draggingIndex === i}
          hovered={hoverIndex === i}
          key={`duct-handle-${i}`}
          onPointerDown={onHandleDown(i)}
          onPointerEnter={(e) => {
            e.stopPropagation()
            setHoverIndex(i)
            if (draggingIndex === null) document.body.style.cursor = 'grab'
          }}
          onPointerLeave={() => {
            setHoverIndex((prev) => (prev === i ? null : prev))
            if (draggingIndex === null) document.body.style.cursor = ''
          }}
          position={p as Point}
        />
      ))}
      {/* In-world move arrows — hidden while any handle drag is live (the
          window pointer handlers own the gesture from pointer-down), exactly
          like the wall side handles hide mid-drag. */}
      {draggingIndex === null && !arrowDragging && (
        <>
          {sideHandles.map((h) => (
            <ArrowHandle
              key={h.key}
              onPointerDown={beginArrowDrag('grabbing', sideMoveCompute(h))}
              position={h.position}
              rotationY={h.rotationY}
            />
          ))}
          {heightHandle && (
            <ArrowHandle
              cursor="ns-resize"
              onPointerDown={beginArrowDrag('ns-resize', heightCompute(heightHandle.anchor))}
              position={heightHandle.position}
              upright
            />
          )}
        </>
      )}
      {draggingIndex !== null &&
        duct.path[draggingIndex] &&
        (() => {
          // Same pill as the draw tool: signed per-axis deltas from the
          // drag-start position, dominant axis emphasised.
          const point = duct.path[draggingIndex]!
          const origin = dragRef.current?.initialPath[draggingIndex] ?? point
          const deltas = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]
          const axes = ['x', 'y', 'z'] as const
          const primary = axes.reduce((best, axis, i) =>
            Math.abs(deltas[i]!) > Math.abs(deltas[axes.indexOf(best)]!) ? axis : best,
          )
          return (
            <Html
              center
              position={[point[0], point[1] + 0.35, point[2]]}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
              zIndexRange={[100, 0]}
            >
              <DimensionPill
                parts={axes.map((axis, i) => ({
                  key: axis,
                  prefix: axis.toUpperCase(),
                  value: deltas[i]!,
                  signed: true,
                }))}
                primary={primary}
                unit={unit}
              />
            </Html>
          )
        })()}
    </group>
  )
}

/**
 * Billboarded hexagon disc handle for a duct path vertex — the same visual
 * the wall corner picker uses, so corner editing reads consistently across
 * kinds. A flat `CircleGeometry` with 6 segments is the click target; an
 * outer hex ring frames it. The group copies the camera's WORLD rotation
 * (compensating for the rotated duct/level parent) so the hex stays
 * face-on at any viewing angle.
 */
function HexHandle({
  position,
  active,
  hovered,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: {
  position: Point
  active: boolean
  hovered: boolean
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onPointerEnter: (e: ThreeEvent<PointerEvent>) => void
  onPointerLeave: () => void
}) {
  const { camera } = useThree()
  const groupRef = useRef<Group>(null)
  const parentWorldQuat = useMemo(() => new Quaternion(), [])
  const invParentWorldQuat = useMemo(() => new Quaternion(), [])
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    if (group.parent) {
      group.parent.getWorldQuaternion(parentWorldQuat)
      invParentWorldQuat.copy(parentWorldQuat).invert()
      group.quaternion.copy(invParentWorldQuat).multiply(camera.quaternion)
    } else {
      group.quaternion.copy(camera.quaternion)
    }
  })

  const color = active || hovered ? HANDLE_HOVER_COLOR : HANDLE_COLOR
  const scale = hovered || active ? 1.25 : 1

  return (
    <group position={position} ref={groupRef} scale={scale}>
      <mesh
        layers={EDITOR_LAYER}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        renderOrder={1002}
      >
        <circleGeometry args={[HANDLE_RADIUS, 6]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={active ? 1 : 0.95}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <mesh renderOrder={1003}>
        <ringGeometry args={[HANDLE_RADIUS, HANDLE_RADIUS * 1.18, 6]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          side={DoubleSide}
          transparent
        />
      </mesh>
    </group>
  )
}

/**
 * In-world chevron arrow handle — a thin wrapper over the editor's shared
 * `HandleArrow` so the duct side-move / height arrows render as the exact
 * same solid violet plate (depth-written, ink-edge outlined) the wall
 * arrows use, instead of a parallel flat reimplementation. Lays flat in the
 * XZ plane pointing along +X (yawed by `rotationY`); `upright` tips the
 * chevron vertical for the height handle, matching the wall height arrow's
 * `indicatorRotation`. Scales with ortho zoom for a constant on-screen size.
 */
function ArrowHandle({
  position,
  rotationY = 0,
  upright = false,
  cursor = 'grab',
  onPointerDown,
}: {
  position: Point
  rotationY?: number
  upright?: boolean
  cursor?: Cursor
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE

  return (
    <HandleArrow
      cursor={cursor}
      hover={hovered}
      // Upright (height): tip the flat chevron up to point along +Y — the
      // same inner-rotation chain the wall height arrow uses.
      indicatorRotation={upright ? [0, Math.PI / 2, Math.PI / 2] : undefined}
      onHoverChange={setHovered}
      onPointerDown={onPointerDown}
      placement={{ position, rotation: [0, rotationY, 0], baseScale }}
      shape="chevron"
    />
  )
}

// Per-segment side-move arrows: a front / back pair at each segment midpoint
// that has a non-trivial plan length. Vertical risers (which collapse to a
// point in plan) are skipped. The arrows sit one run-radius + gap off the
// segment body along its plan normal; `rotationY` orients the flat chevron
// to point outward (matching `buildWallMoveHandle`).
function getSideMoveHandles(duct: DuctSegmentNode): SideMoveHandle[] {
  const handles: SideMoveHandle[] = []
  const offset = runRadiusM(duct) + SIDE_ARROW_GAP
  const effOffset = Math.max(offset, SIDE_ARROW_MIN_OFFSET)
  for (let i = 0; i < duct.path.length - 1; i++) {
    const a = duct.path[i]!
    const b = duct.path[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz)
    if (len < MIN_PLAN_SEGMENT_LEN) continue
    const normal: [number, number] = [-dz / len, dx / len]
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    for (const side of [1, -1] as const) {
      const n: [number, number] = [normal[0] * side, normal[1] * side]
      handles.push({
        key: `side-${i}-${side}`,
        segmentIndex: i,
        normal: n,
        position: [mid[0] + n[0] * effOffset, mid[1], mid[2] + n[1] * effOffset],
        rotationY: Math.atan2(-n[1], n[0]),
      })
    }
  }
  return handles
}

// Height arrow: a single upright chevron above the run's centroid. `anchor`
// is the centroid in node-local coords — the drag reads the cursor's start Y
// against a vertical plane through it so the run doesn't teleport on grab.
function getHeightHandle(duct: DuctSegmentNode): { position: Point; anchor: Point } | null {
  if (duct.path.length < 2) return null
  let x = 0
  let y = 0
  let z = 0
  for (const p of duct.path) {
    x += p[0]
    y += p[1]
    z += p[2]
  }
  const count = duct.path.length
  const anchor: Point = [x / count, y / count, z / count]
  const top = Math.max(...duct.path.map((p) => p[1]))
  return {
    anchor,
    position: [anchor[0], top + runRadiusM(duct) + HEIGHT_ARROW_OFFSET, anchor[2]],
  }
}

export default DuctSegmentSelectionAffordance
