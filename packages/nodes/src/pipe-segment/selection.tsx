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
 * Selection-time editing for committed DWV pipe runs: one draggable
 * handle per path point. The plumbing sibling of the duct-segment
 * affordance — same portal / constrained-drag / single-undo model, snapping
 * to DWV ports instead of duct ports.
 *
 * Handles are PORTALED into the pipe's registered scene group so they
 * share its exact frame — path coords are node-local, and the level /
 * building transform above the group applies to the handles for free.
 *
 * Drag model: by default the point is CONSTRAINED to the axis the
 * segment was drawn along. Holding **Alt** releases it into free
 * horizontal-plane movement (endpoints port-snap onto nearby DWV ports).
 * Holding **Shift** bypasses grid snapping for a precision drag.
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
   * Signed distance along `axisWorld` (unit, through `anchorWorld`) of the
   * point on that line closest to the cursor ray. Null when the ray runs
   * (near-)parallel to the axis and the projection is unstable.
   */
  const projectOntoAxis = (
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
    axisWorld: Vector3,
  ): number | null => {
    const ray = makeRay(clientX, clientY)
    const w0 = new Vector3().subVectors(ray.origin, anchorWorld)
    const b = ray.direction.dot(axisWorld)
    const denom = 1 - b * b
    if (Math.abs(denom) < 1e-6) return null
    const d0 = ray.direction.dot(w0)
    const e0 = axisWorld.dot(w0)
    return (e0 - b * d0) / denom
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

    // Axis the segment was drawn along, at this point: from the
    // neighbouring path point toward the dragged one. The default drag
    // is constrained to this line.
    const neighbor = initialPath[index === 0 ? 1 : index - 1]!
    const axisLocal = new Vector3(
      startPoint[0] - neighbor[0],
      startPoint[1] - neighbor[1],
      startPoint[2] - neighbor[2],
    )
    if (axisLocal.lengthSq() < 1e-9) axisLocal.set(1, 0, 0)
    axisLocal.normalize()
    // World-space anchor + axis, derived once — the constraint line is
    // fixed for the whole drag regardless of where the point currently is.
    const anchorWorldStart = toWorld(startPoint)
    const axisWorld = toWorld([
      startPoint[0] + axisLocal.x,
      startPoint[1] + axisLocal.y,
      startPoint[2] + axisLocal.z,
    ])
      .sub(anchorWorldStart)
      .normalize()

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const current = drag.current
      // Shift = precision: bypass grid snapping for a perfectly smooth
      // drag (snap() is a no-op at step 0).
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      let next: Point | null = null
      if (event.altKey) {
        // Alt = freedom: slide on the horizontal plane at the point's
        // height. Endpoints can port-snap here to mate onto a fitting.
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(current))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          next = [snap(local[0], step), current[1], snap(local[2], step)]
          if (isEndpoint) {
            const port = findNearestPortXZ(
              [local[0], current[1], local[2]],
              collectScenePorts({ excludeNodeId: pipe.id, systems: DWV_PORT_SYSTEMS }),
              PORT_SNAP_RADIUS_M,
            )
            if (port) next = [port.position[0], port.position[1], port.position[2]]
          }
        }
      } else {
        // Default: constrained to the axis the segment was drawn along —
        // slide the point closer / further along its own line.
        const t = projectOntoAxis(event.clientX, event.clientY, anchorWorldStart, axisWorld)
        if (t !== null) {
          const dist = snap(t, step)
          next = [
            startPoint[0] + axisLocal.x * dist,
            Math.max(0, startPoint[1] + axisLocal.y * dist),
            startPoint[2] + axisLocal.z * dist,
          ]
        }
      }
      if (!next) return
      if (next[0] === current[0] && next[1] === current[1] && next[2] === current[2]) return
      drag.current = next
      const path = pipe.path.map((p, i) => (i === drag.index ? next! : p)) as Point[]
      // Drag the run + any fittings mated to the moved endpoint as one batch.
      useScene
        .getState()
        .updateNodes([
          { id: pipe.id as AnyNodeId, data: { path } },
          ...connectivityUpdatesForPath(drag.connectivity, path),
        ])
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      drag.cleanup()
      dragRef.current = null
      setDraggingIndex(null)
      // Single-undo dance: revert (still paused), resume, re-apply the
      // final path — plus any connected fitting moves — as one tracked batch.
      const finalPath = drag.initialPath.map((p, i) =>
        i === drag.index ? drag.current : p,
      ) as Point[]
      const finalUpdates = connectivityUpdatesForPath(drag.connectivity, finalPath)
      // Revert the run AND the followers to their pre-drag state while paused
      // so history captures a clean before→after delta.
      const revertUpdates = (drag.connectivity?.connections ?? []).flatMap((conn) =>
        conn.kind === 'rigid-node'
          ? [{ id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }]
          : [{ id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> }],
      )
      useScene
        .getState()
        .updateNodes([
          { id: pipe.id as AnyNodeId, data: { path: drag.initialPath } },
          ...revertUpdates.filter((u) => useScene.getState().nodes[u.id]),
        ])
      resumeSceneHistory(useScene)
      const moved = finalPath[drag.index]!.some(
        (v, axis) => v !== drag.initialPath[drag.index]![axis],
      )
      if (moved) {
        useScene
          .getState()
          .updateNodes([{ id: pipe.id as AnyNodeId, data: { path: finalPath } }, ...finalUpdates])
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
    }

    dragRef.current = { index, initialPath, current: startPoint, cleanup, connectivity }
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
