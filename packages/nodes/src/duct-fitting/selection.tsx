'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type Cursor,
  type DuctFittingNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { swallowNextClick, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
  Euler,
  type Group,
  type Object3D,
  Plane,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import {
  AXIS_VECTORS,
  cycleRotationAxis,
  ROTATE_STEP_RAD,
  type RotationAxis,
} from '../shared/fitting-rotation'
import { HandleCube, MoveChevron, RotateArc } from '../shared/selection-handles'
import { fittingLegLength } from './ports'

type Point = [number, number, number]

/** Stand-off (meters) from the fitting body to each arrow. */
const ARROW_GAP = 0.14

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Rough body radius (meters) — the larger of the fitting's two collar reaches,
 *  used to stand the handles clear of the geometry. */
function fittingExtentM(node: DuctFittingNode): number {
  const d2 = (node as { diameter2?: number }).diameter2 ?? node.diameter
  return Math.max(fittingLegLength(node.diameter), fittingLegLength(d2))
}

/** The transform a drag frame writes onto the fitting. */
type FittingTransform = { position?: Point; rotation?: Point }

/**
 * Selection-time affordances for a placed duct fitting — the 3D twin of the
 * duct-segment selection rig. A single CLICK-to-latch cube sits at the fitting
 * center; clicking it opens (click again to close) a cluster of:
 *
 *  - **Six move arrows** (±X / ±Y / ±Z): translate the whole fitting along one
 *    world axis. Connected runs follow via port connectivity.
 *  - **Three rotation arcs** (X / Y / Z): spin the fitting about each world
 *    axis. Connected runs re-aim via port follow.
 *
 * The handle rig is PORTALED into the fitting group's PARENT — never the
 * fitting group itself — because the selection outliner (`MergedOutlineNode`)
 * traces every descendant mesh of the SELECTED node, so a hit-area cylinder
 * parented under the fitting would be swept into its selection outline. Walls /
 * doors / windows dodge it the same way. The fitting's local `position` is
 * expressed in the parent's frame, so an identity group under the parent lets
 * us place handles at absolute level-local coords with world-aligned axes.
 *
 * History does the single-undo dance: paused during the drag (live ticks are
 * untracked), reverted on release, resumed, then the final transform re-applied
 * as one tracked change so the whole joint is one undo step.
 */
const DuctFittingSelectionAffordance = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const fitting = useScene((s) => {
    if (selectedIds.length !== 1) return null
    const node = s.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'duct-fitting' ? (node as DuctFittingNode) : null
  })

  // Alt cycles the active rotation axis for the R / T keyboard rotate while a
  // single fitting is selected (the gizmo's three arcs cover every axis on
  // their own; this only keeps the keyboard action meaningful).
  const hasSelectedFitting = !!fitting
  useEffect(() => {
    if (!hasSelectedFitting) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.repeat) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      cycleRotationAxis()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasSelectedFitting])

  // Portal target: the fitting's registered group. Resolved with a rAF retry
  // because registration lands on the renderer's mount, a frame after select.
  const fittingId = fitting?.id ?? null
  const [target, setTarget] = useState<Object3D | null>(null)
  useEffect(() => {
    if (!fittingId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(fittingId as AnyNodeId) ?? null
      setTarget((cur) => (cur === next ? cur : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [fittingId])

  if (!fitting || !target) return null
  const mount = target.parent ?? target
  return createPortal(<FittingHandles fitting={fitting} target={target} />, mount, undefined)
}

const FittingHandles = ({ fitting, target }: { fitting: DuctFittingNode; target: Object3D }) => {
  const { camera, gl } = useThree()
  const [frame, setFrame] = useState<Group | null>(null)
  // True while the cluster is latched open. Click the center cube to toggle.
  const [open, setOpen] = useState(false)
  // True while a move / rotate drag is live — the arrows hide (the window
  // pointer handlers own the gesture), exactly like the duct-segment rig.
  const [dragging, setDragging] = useState(false)

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
  /** World hit on a vertical, camera-facing plane through `anchorWorld`,
   *  returned as a level-local Y (the frame is axis-aligned to the parent). */
  const intersectVerticalY = (
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
  ): number | null => {
    if (!frame) return null
    const forward = camera.getWorldDirection(new Vector3())
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1)
    forward.normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(forward, anchorWorld)
    const hit = intersect(clientX, clientY, plane)
    return hit ? frame.worldToLocal(hit.clone()).y : null
  }

  const toWorld = (p: Point): Vector3 =>
    frame ? frame.localToWorld(new Vector3(p[0], p[1], p[2])) : new Vector3(p[0], p[1], p[2])

  /** Cursor's coordinate on one world axis, in the frame's local space. For Y
   *  it rides a camera-facing vertical plane; for X / Z it projects onto the
   *  horizontal plane through the fitting and reads back the local component. */
  const sampleAxis = (
    axis: RotationAxis,
    clientX: number,
    clientY: number,
    anchorWorld: Vector3,
  ): number | null => {
    if (axis === 'y') return intersectVerticalY(clientX, clientY, anchorWorld)
    const plane = new Plane().setFromNormalAndCoplanarPoint(UP, anchorWorld)
    const hit = intersect(clientX, clientY, plane)
    if (!hit || !frame) return null
    const local = frame.worldToLocal(hit.clone())
    return axis === 'x' ? local.x : local.z
  }

  // Follow-updates for runs / fittings mated to this fitting, given a preview
  // transform. Endpoints whose ports didn't move resolve to a zero delta.
  const connectivityUpdates = (
    connectivity: PortConnectivity | null,
    transform: FittingTransform,
  ): { id: AnyNodeId; data: Partial<AnyNode> }[] => {
    if (!connectivity) return []
    const preview = { ...(fitting as Record<string, unknown>), ...transform } as AnyNode
    return resolveConnectivityUpdates(connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }

  /**
   * Shared lifecycle for the move / rotate drags. `makeCompute` is built at
   * pointer-down so it can capture the grab anchor (cursor's start coord /
   * bearing) and avoid a teleport. Each frame `compute` turns the cursor into
   * the fitting's next transform; the fitting writes it and any mated runs
   * follow via port connectivity. Lands as one undo step.
   */
  const beginDrag =
    (
      cursor: Cursor,
      makeCompute: (
        e: ThreeEvent<PointerEvent>,
      ) => (event: PointerEvent) => FittingTransform | null,
    ) =>
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      const initialPosition = [...fitting.position] as Point
      const initialRotation = [...fitting.rotation] as Point
      const connectivity = analyzePortConnectivity(fitting as AnyNode, useScene.getState().nodes)
      const compute = makeCompute(e)
      pauseSceneHistory(useScene)
      useViewer.getState().setInputDragging(true)
      setDragging(true)
      document.body.style.cursor = cursor
      let current: FittingTransform | null = null

      const buildBatch = (t: FittingTransform): { id: AnyNodeId; data: Partial<AnyNode> }[] => [
        { id: fitting.id as AnyNodeId, data: t as Partial<AnyNode> },
        ...connectivityUpdates(connectivity, t),
      ]

      const onMove = (event: PointerEvent) => {
        const next = compute(event)
        if (!next) return
        current = next
        useScene.getState().updateNodes(buildBatch(next))
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        useViewer.getState().setInputDragging(false)
        setDragging(false)
        if (document.body.style.cursor === cursor) document.body.style.cursor = ''
      }

      const onUp = () => {
        // Swallow the trailing synthetic click so it doesn't reach the
        // background-click deselect handler (cleanup drops `inputDragging`
        // synchronously here).
        swallowNextClick()
        cleanup()
        // Single-undo dance: revert the fitting AND its followers to the
        // pre-drag state while history is still paused, resume, then re-apply
        // the final transform as one tracked change.
        const reverts: { id: AnyNodeId; data: Partial<AnyNode> }[] = (
          connectivity?.connections ?? []
        ).map((conn) =>
          conn.kind === 'rigid-node'
            ? { id: conn.nodeId, data: { position: conn.startPosition } as Partial<AnyNode> }
            : { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> },
        )
        useScene.getState().updateNodes([
          {
            id: fitting.id as AnyNodeId,
            data: { position: initialPosition, rotation: initialRotation } as Partial<AnyNode>,
          },
          ...reverts.filter((u) => useScene.getState().nodes[u.id]),
        ])
        resumeSceneHistory(useScene)
        if (current) useScene.getState().updateNodes(buildBatch(current))
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

  // Move: translate the fitting along one world axis, anchored to the cursor's
  // start coord so it doesn't jump on grab. Y is clamped at the floor; Shift
  // bypasses grid snapping.
  const moveCompute =
    (axis: RotationAxis) =>
    (e: ThreeEvent<PointerEvent>): ((event: PointerEvent) => FittingTransform | null) => {
      const anchorWorld = toWorld(fitting.position as Point)
      const start = sampleAxis(axis, e.nativeEvent.clientX, e.nativeEvent.clientY, anchorWorld)
      const base = [...fitting.position] as Point
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      let lastDelta = Number.NaN
      return (event: PointerEvent): FittingTransform | null => {
        if (start === null) return null
        const s = sampleAxis(axis, event.clientX, event.clientY, anchorWorld)
        if (s === null) return null
        const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
        const delta = snap(s - start, step)
        if (delta === lastDelta) return null
        lastDelta = delta
        if (step > 0) triggerSFX('sfx:grid-snap')
        const next = [...base] as Point
        next[axisIndex] = (
          axis === 'y' ? Math.max(0, base[axisIndex] + delta) : base[axisIndex] + delta
        ) as number
        return { position: next }
      }
    }

  // Rotate: spin the fitting about one world axis. The cursor's bearing in the
  // plane perpendicular to that axis (through the body center) drives the
  // angle; world-frame premultiply so the axis means the screen X/Y/Z the user
  // expects regardless of how the fitting is already turned.
  const rotateCompute =
    (axis: RotationAxis) =>
    (e: ThreeEvent<PointerEvent>): ((event: PointerEvent) => FittingTransform | null) => {
      const normal = AXIS_VECTORS[axis].clone()
      const center = toWorld(fitting.position as Point)
      const ref = axis === 'y' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
      const u = ref
        .clone()
        .sub(normal.clone().multiplyScalar(ref.dot(normal)))
        .normalize()
      const v = new Vector3().crossVectors(normal, u)
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center)
      const bearing = (clientX: number, clientY: number): number | null => {
        const hit = intersect(clientX, clientY, plane)
        if (!hit) return null
        const d = hit.sub(center)
        return Math.atan2(d.dot(v), d.dot(u))
      }
      const startBearing = bearing(e.nativeEvent.clientX, e.nativeEvent.clientY)
      const startQuat = new Quaternion().setFromEuler(
        new Euler(fitting.rotation[0], fitting.rotation[1], fitting.rotation[2]),
      )
      return (event: PointerEvent): FittingTransform | null => {
        if (startBearing === null) return null
        const b = bearing(event.clientX, event.clientY)
        if (b === null) return null
        // Snap the turn to 45° steps; Shift = smooth (no snap).
        const raw = b - startBearing
        const delta = event.shiftKey ? raw : Math.round(raw / ROTATE_STEP_RAD) * ROTATE_STEP_RAD
        const turn = new Quaternion().setFromAxisAngle(normal, delta)
        const euler = new Euler().setFromQuaternion(turn.multiply(startQuat))
        return { rotation: [euler.x, euler.y, euler.z] }
      }
    }

  const extent = useMemo(() => fittingExtentM(fitting), [fitting])
  const p = fitting.position as Point
  const base = extent + ARROW_GAP

  // Six whole-fitting move arrows, one per ± world axis.
  const moveArrows: {
    key: string
    axis: RotationAxis
    position: Point
    rotationY: number
    vertical?: 'up' | 'down'
    cursor: Cursor
  }[] = [
    { key: '+x', axis: 'x', position: [p[0] + base, p[1], p[2]], rotationY: 0, cursor: 'grab' },
    {
      key: '-x',
      axis: 'x',
      position: [p[0] - base, p[1], p[2]],
      rotationY: Math.PI,
      cursor: 'grab',
    },
    {
      key: '+z',
      axis: 'z',
      position: [p[0], p[1], p[2] + base],
      rotationY: -Math.PI / 2,
      cursor: 'grab',
    },
    {
      key: '-z',
      axis: 'z',
      position: [p[0], p[1], p[2] - base],
      rotationY: Math.PI / 2,
      cursor: 'grab',
    },
    {
      key: '+y',
      axis: 'y',
      position: [p[0], p[1] + base, p[2]],
      rotationY: 0,
      vertical: 'up',
      cursor: 'ns-resize',
    },
    {
      key: '-y',
      axis: 'y',
      position: [p[0], p[1] - base, p[2]],
      rotationY: 0,
      vertical: 'down',
      cursor: 'ns-resize',
    },
  ]

  // Three rotation arcs, one per world axis. Each arc wraps its axis (the
  // shared `curved-arrow` wraps world +Y by default; `setFromUnitVectors`
  // re-aims it) and sits at a diagonal offset in the plane it spins, so the
  // three don't pile onto the move arrows.
  const d = base * Math.SQRT1_2
  const rotateArcs: { key: string; axis: RotationAxis; position: Point; rotation: Point }[] = (
    ['x', 'y', 'z'] as RotationAxis[]
  ).map((axis) => {
    const q = new Quaternion().setFromUnitVectors(UP, AXIS_VECTORS[axis])
    // Spin the arc in place about its own axis so the grip sits where we want
    // it without moving its position.
    if (axis === 'z') {
      q.premultiply(new Quaternion().setFromAxisAngle(AXIS_VECTORS.z, Math.PI / 4))
    } else if (axis === 'x') {
      q.premultiply(new Quaternion().setFromAxisAngle(AXIS_VECTORS.x, (-145 * Math.PI) / 180))
    } else if (axis === 'y') {
      q.premultiply(new Quaternion().setFromAxisAngle(AXIS_VECTORS.y, (-45 * Math.PI) / 180))
    }
    const e = new Euler().setFromQuaternion(q)
    const position: Point =
      axis === 'x'
        ? [p[0], p[1] + d, p[2] + d]
        : axis === 'y'
          ? [p[0] + d, p[1], p[2] + d]
          : [p[0] + d, p[1] + d, p[2]]
    return { key: `r${axis}`, axis, position, rotation: [e.x, e.y, e.z] }
  })

  if (dragging) {
    return <group ref={setFrame} />
  }
  return (
    <group ref={setFrame}>
      <HandleCube active={open} onClick={() => setOpen((o) => !o)} position={p} />
      {open && (
        <>
          {moveArrows.map((a) => (
            <MoveChevron
              cursor={a.cursor}
              key={a.key}
              onPointerDown={beginDrag(
                a.axis === 'y' ? 'ns-resize' : 'grabbing',
                moveCompute(a.axis),
              )}
              position={a.position}
              rotationY={a.rotationY}
              vertical={a.vertical}
            />
          ))}
          {rotateArcs.map((arc) => (
            <RotateArc
              key={arc.key}
              onPointerDown={beginDrag('grabbing', rotateCompute(arc.axis))}
              position={arc.position}
              rotation={arc.rotation}
            />
          ))}
        </>
      )}
    </group>
  )
}

export default DuctFittingSelectionAffordance
