'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type DuctSegmentNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { DimensionPill, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { collectScenePorts, DUCT_PORT_SYSTEMS, findNearestPortXZ } from '../shared/ports'

/** Handle pip radius (meters). */
const HANDLE_RADIUS = 0.09
/** Port-snap radius for dragged run endpoints (meters, XZ). */
const PORT_SNAP_RADIUS_M = 0.4

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

type Point = [number, number, number]

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
 * Drag model: by default the point is CONSTRAINED to the axis the
 * segment was drawn along — a horizontal duct's endpoint slides along
 * its own length, a riser's endpoint slides vertically. Holding **Alt**
 * releases the constraint into free horizontal-plane movement (at the
 * point's height); in free mode dragged run endpoints (first / last
 * point) also snap onto nearby typed ports so a loose run can be mated
 * onto a fitting after the fact. Holding **Shift** bypasses grid
 * snapping in either mode for a perfectly smooth precision drag.
 *
 * History does the single-undo dance: paused during the drag (the live
 * `updateNode` ticks are untracked), then on release the path is
 * reverted, history resumed, and the final path applied as one tracked
 * change.
 */
const DuctSegmentSystem = () => {
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
  return createPortal(<DuctPointHandles duct={duct} target={target} />, target, undefined)
}

const DuctPointHandles = ({ duct, target }: { duct: DuctSegmentNode; target: Object3D }) => {
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
    // Connectivity snapshot taken at pointer-down: which fittings / ducts are
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
              collectScenePorts({ excludeNodeId: duct.id, systems: DUCT_PORT_SYSTEMS }),
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
      const path = duct.path.map((p, i) => (i === drag.index ? next! : p)) as Point[]
      // Drag the run + any fittings mated to the moved endpoint as one batch.
      useScene
        .getState()
        .updateNodes([
          { id: duct.id as AnyNodeId, data: { path } },
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
          { id: duct.id as AnyNodeId, data: { path: drag.initialPath } },
          ...revertUpdates.filter((u) => useScene.getState().nodes[u.id]),
        ])
      resumeSceneHistory(useScene)
      const moved = finalPath[drag.index]!.some(
        (v, axis) => v !== drag.initialPath[drag.index]![axis],
      )
      if (moved) {
        useScene
          .getState()
          .updateNodes([{ id: duct.id as AnyNodeId, data: { path: finalPath } }, ...finalUpdates])
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
      {duct.path.map((p, i) => {
        const active = draggingIndex === i
        const hovered = hoverIndex === i
        return (
          <mesh
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
          >
            <sphereGeometry args={[HANDLE_RADIUS, 16, 12]} />
            <meshBasicMaterial
              color={active || hovered ? '#a5b4fc' : '#818cf8'}
              depthTest={false}
              opacity={active ? 1 : 0.85}
              transparent
            />
          </mesh>
        )
      })}
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

export default DuctSegmentSystem
