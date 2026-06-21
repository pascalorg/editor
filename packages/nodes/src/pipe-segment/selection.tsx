'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type PipeSegmentNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { DimensionPill, EDITOR_LAYER, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DoubleSide,
  type Group,
  type Object3D,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import {
  detectFittingEndpoint,
  type FittingEndpoint,
  planFittingEndpointReaim,
} from '../shared/fitting-endpoint-reaim'
import { collectScenePorts, DWV_PORT_SYSTEMS, findNearestPortXZ } from '../shared/ports'

/** Corner hex-disc radius (meters) — matches the duct corner handle. */
const HANDLE_RADIUS = 0.11
const HANDLE_COLOR = '#818cf8'
const HANDLE_HOVER_COLOR = '#a5b4fc'
/** Port-snap radius for dragged run endpoints (meters, XZ). */
const PORT_SNAP_RADIUS_M = 0.4

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

type Point = [number, number, number]

/**
 * Selection-time editing for committed DWV pipe runs: one draggable handle
 * per path point. The plumbing sibling of the duct-segment affordance —
 * same portal / free-drag / single-undo model, snapping to DWV ports
 * instead of duct ports.
 *
 * Handles are PORTALED into the pipe's registered scene group so they
 * share its exact frame — path coords are node-local, and the level /
 * building transform above the group applies to the handles for free.
 * Drag raycasts run in world space and convert hits back into the
 * group's local frame before writing the path.
 *
 * Drag model: the point moves FREELY on the horizontal plane at its own
 * height (no axis lock) — like a wall corner. Dragged run endpoints snap
 * onto nearby typed DWV ports so a loose run can be mated onto a fitting
 * after the fact. When the dragged endpoint belongs to a straight run whose
 * OTHER end sits on an elbow collar, the elbow re-aims to follow the drag
 * (junction + far collar fixed, bend angle adapts) instead of port-snapping.
 *
 * Modifiers (mirroring the duct corner drag):
 * - **Alt** detaches: the joint breaks for this drag — the elbow does NOT
 *   re-aim and mated fittings / runs do NOT follow; the endpoint moves on its
 *   own (port re-mate still allowed so it can be reattached elsewhere).
 * - **Cmd / Ctrl** switches to vertical movement (stack / riser editing): XZ
 *   holds and the cursor drives Y.
 * - **Shift** bypasses grid snapping for a perfectly smooth precision drag.
 *
 * History does the single-undo dance: paused during the drag (the live
 * `updateNode` ticks are untracked), then on release the path is
 * reverted, history resumed, and the final path applied as one tracked
 * change.
 */
const PipeSegmentSelectionAffordance = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const pipe = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const node = s.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'pipe-segment' ? (node as PipeSegmentNode) : null
  })

  // Portal target: the pipe's registered group. Resolved with a rAF
  // retry because registration happens on the renderer's mount, which
  // can land a frame after selection.
  const pipeId = pipe?.id ?? null
  const [target, setTarget] = useState<Object3D | null>(null)
  useEffect(() => {
    if (!pipeId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(pipeId as AnyNodeId) ?? null
      setTarget((cur) => (cur === next ? cur : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [pipeId])

  if (!pipe || !target) return null
  return createPortal(<PipePointHandles pipe={pipe} target={target} />, target, undefined)
}

const PipePointHandles = ({ pipe, target }: { pipe: PipeSegmentNode; target: Object3D }) => {
  const { camera, gl } = useThree()
  const unit = useViewer((s) => s.unit)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  // Set while a drag is live; null otherwise. Holds everything the window
  // pointer handlers need so they never read stale React state.
  const dragRef = useRef<{
    index: number
    initialPath: Point[]
    current: Point
    cleanup: () => void
    // Connectivity snapshot taken at pointer-down: which fittings / pipes are
    // mated to this run's endpoints, so they follow as the endpoint moves.
    connectivity: PortConnectivity | null
    // Set when the run's OTHER end sits on an elbow collar: the elbow re-aims
    // to follow this drag instead of translating rigidly (mutually exclusive
    // with `connectivity`-driven follow for this endpoint).
    fittingEndpoint: FittingEndpoint | null
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
   * `anchorWorld` that faces the camera — drives Cmd/Ctrl-vertical (riser) drag.
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
  // Detached (Alt): only the pipe path moves — no elbow re-aim, no
  // connectivity follow. Elbow mode: the run rides the elbow's re-aimed
  // collar and the elbow swings to fit. Otherwise: the dragged point moves
  // and any mated fittings / runs translate via connectivity.
  const buildDragBatch = (
    drag: NonNullable<typeof dragRef.current>,
    next: Point,
    detached: boolean,
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] | null => {
    if (!detached && drag.fittingEndpoint) {
      const plan = planFittingEndpointReaim(drag.fittingEndpoint, drag.index, next)
      // Out of the elbow's buildable turn range — hold this frame.
      if (!plan) return null
      return [
        { id: pipe.id as AnyNodeId, data: { path: plan.path } },
        { id: plan.fittingUpdate.id, data: plan.fittingUpdate.data },
      ]
    }
    const path = pipe.path.map((p, i) => (i === drag.index ? next : p)) as Point[]
    return [
      { id: pipe.id as AnyNodeId, data: { path } },
      ...(detached ? [] : connectivityUpdatesForPath(drag.connectivity, path)),
    ]
  }

  /** World-space position of a local path point. */
  const toWorld = (p: Point): Vector3 => target.localToWorld(new Vector3(p[0], p[1], p[2]))
  /** Convert a world-space hit back into the pipe group's local frame. */
  const toLocal = (world: Vector3): Point => {
    const local = target.worldToLocal(world.clone())
    return [local.x, local.y, local.z]
  }

  // Follow-updates for fittings / pipes mated to this run's endpoints, given
  // the run's live path. Endpoints whose position didn't change resolve to a
  // zero delta, so only the dragged endpoint's partner actually moves.
  const connectivityUpdatesForPath = (
    connectivity: PortConnectivity | null,
    path: Point[],
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] => {
    if (!connectivity) return []
    const preview = { ...(pipe as Record<string, unknown>), path } as AnyNode
    return resolveConnectivityUpdates(connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }

  const onHandleDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = pipe.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    const connectivity = analyzePortConnectivity(pipe as AnyNode, useScene.getState().nodes)
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
    const fittingEndpoint: FittingEndpoint | null = isEndpoint
      ? detectFittingEndpoint('pipe-segment', initialPath, index, useScene.getState().nodes)
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
        // against a vertical plane through the point (stack / riser editing).
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
          if (isEndpoint && (detached || !drag.fittingEndpoint)) {
            const port = findNearestPortXZ(
              [local[0], current[1], local[2]],
              collectScenePorts({ excludeNodeId: pipe.id, systems: DWV_PORT_SYSTEMS }),
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
      // detached — just the pipe path).
      const detached = drag.detached
      const finalBatch = buildDragBatch(drag, drag.current, detached)
      // Revert the run AND whatever the drag carried to their pre-drag state
      // while paused so history captures a clean before→after delta. When
      // detached nothing else moved, so only the run needs reverting.
      const revertUpdates: { id: AnyNodeId; data: Partial<AnyNode> }[] = detached
        ? []
        : drag.fittingEndpoint
          ? [drag.fittingEndpoint.revert]
          : (drag.connectivity?.connections ?? []).map((conn) =>
              conn.kind === 'rigid-node'
                ? { id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }
                : { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> },
            )
      useScene
        .getState()
        .updateNodes([
          { id: pipe.id as AnyNodeId, data: { path: drag.initialPath } },
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
      fittingEndpoint,
      detached: false,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <group>
      {pipe.path.map((p, i) => (
        <HexHandle
          active={draggingIndex === i}
          hovered={hoverIndex === i}
          key={`pipe-handle-${i}`}
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
      {draggingIndex !== null &&
        pipe.path[draggingIndex] &&
        (() => {
          // Same pill as the draw tool: signed per-axis deltas from the
          // drag-start position, dominant axis emphasised.
          const point = pipe.path[draggingIndex]!
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
 * Billboarded hexagon disc handle for a pipe path vertex — the same visual
 * the duct corner handle uses, so corner editing reads consistently across
 * kinds. A flat `CircleGeometry` with 6 segments is the click target; an
 * outer hex ring frames it. The group copies the camera's WORLD rotation
 * (compensating for the rotated pipe/level parent) so the hex stays
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

export default PipeSegmentSelectionAffordance
