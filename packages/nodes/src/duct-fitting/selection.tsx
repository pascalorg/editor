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
import { ARROW_SCALE, HandleArrow, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
  Euler,
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
  AXIS_VECTORS,
  cycleRotationAxis,
  getRotationAxis,
  type RotationAxis,
} from '../shared/fitting-rotation'
import { fittingLegLength } from './ports'

type Point = [number, number, number]

/** Stand-off (meters) from the fitting body to each arrow. */
const ARROW_GAP = 0.3

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Rough body radius (meters) — the larger of the fitting's two collar reaches,
 *  used to stand the arrows clear of the geometry. */
function fittingExtentM(node: DuctFittingNode): number {
  const d2 = (node as { diameter2?: number }).diameter2 ?? node.diameter
  return Math.max(fittingLegLength(node.diameter), fittingLegLength(d2))
}

/** The transform a drag frame writes onto the fitting. */
type FittingTransform = { position?: Point; rotation?: Point }

/**
 * Selection-time affordances for a placed duct fitting — the 3D twin of the
 * wall side handles, mirroring the duct-segment selection rig:
 *
 *  - **Height** (upright chevron above the body): raise / lower the fitting on
 *    a camera-facing vertical plane (riser editing). Connected runs follow.
 *  - **Move** (ground cross): hands off to `MoveDuctFittingTool` — the same
 *    click-to-place ghost move the floating Move button engages, with its own
 *    alignment guides, Ctrl-vertical, and Alt-detach.
 *  - **Rotate** (curved arrow): spin the fitting about the active rotation axis
 *    (Alt cycles it; R / T step it). Connected runs re-aim via port follow.
 *
 * The handle rig is PORTALED into the fitting group's PARENT — never the
 * fitting group itself — because the selection outliner (`MergedOutlineNode`)
 * traces every descendant mesh of the SELECTED node, so a hit-area cylinder
 * parented under the fitting would be swept into its selection outline (the
 * stray circle around the arrows). Walls / doors / windows dodge it the same
 * way. The fitting's local `position` is expressed in the parent's frame, so
 * an identity group under the parent lets us place arrows at absolute
 * level-local coords with world-aligned axes (height = world up, rotate on the
 * world horizontal plane).
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

  // Alt cycles the active rotation axis while a single fitting is selected —
  // the piece `def.keyboardActions` (R / T rotate) can't contribute. The pill
  // above the fitting reads `useEditor.rotationAxis` to show it.
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
  const [hover, setHover] = useState<'height' | 'move' | 'rotate' | null>(null)
  // True while a height / rotate drag is live — the arrows hide (the window
  // pointer handlers own the gesture), exactly like the wall side handles.
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
   * Shared lifecycle for the height / rotate arrow drags. `makeCompute` is
   * built at pointer-down so it can capture the grab anchor (the cursor's
   * start Y / bearing) and avoid a teleport. Each frame `compute` turns the
   * cursor into the fitting's next transform; the fitting writes it and any
   * mated runs follow via port connectivity.
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

  // Height: raise / lower the fitting. Anchored to the cursor's start Y so the
  // fitting doesn't jump on grab; clamped so it never drops below the floor.
  const heightCompute = (e: ThreeEvent<PointerEvent>) => {
    const anchorWorld = toWorld(fitting.position as Point)
    const startY = intersectVerticalY(e.nativeEvent.clientX, e.nativeEvent.clientY, anchorWorld)
    const baseY = fitting.position[1]
    const fx = fitting.position[0]
    const fz = fitting.position[2]
    return (event: PointerEvent): FittingTransform | null => {
      if (startY === null) return null
      const y = intersectVerticalY(event.clientX, event.clientY, anchorWorld)
      if (y === null) return null
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      const ny = Math.max(0, baseY + snap(y - startY, step))
      return { position: [fx, ny, fz] }
    }
  }

  // Rotate: spin the fitting about the active rotation axis. The cursor's
  // bearing in the plane perpendicular to that axis (through the body center)
  // drives the angle; world-frame premultiply so the axis means the screen
  // X/Y/Z the user expects regardless of how the fitting is already turned.
  const rotateCompute = (e: ThreeEvent<PointerEvent>) => {
    const axis: RotationAxis = getRotationAxis()
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
      const turn = new Quaternion().setFromAxisAngle(normal, b - startBearing)
      const euler = new Euler().setFromQuaternion(turn.multiply(startQuat))
      return { rotation: [euler.x, euler.y, euler.z] }
    }
  }

  // Move: hand off to the ghost move tool the same way the floating drag
  // engages it — `placementDragMode: true`. That flag (a) makes every handle
  // hit-area inert (`handle-arrow.tsx`'s `hitAreaRaycast`) so this rig's own
  // arrows stop swallowing the cursor's grid raycast, and (b) switches
  // `MoveDuctFittingTool` to commit on pointer-release instead of a second
  // click — press-drag-release, mid-air markup out of the way.
  const onMoveDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const editor = useEditor.getState()
    editor.setPlacementDragMode(true)
    // `setMovingNode`'s param union doesn't list duct-fitting, but the move
    // tool is resolved by `movingNode.type` at runtime — the floating Move
    // button engages a fitting the same way (`setMovingNode(node as any)`).
    editor.setMovingNode(fitting as never)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  const extent = useMemo(() => fittingExtentM(fitting), [fitting])
  const p = fitting.position as Point
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE

  if (dragging) {
    return <group ref={setFrame} />
  }
  return (
    <group ref={setFrame}>
      <HandleArrow
        cursor="ns-resize"
        hover={hover === 'height'}
        indicatorRotation={[0, Math.PI / 2, Math.PI / 2]}
        onHoverChange={(h) => setHover(h ? 'height' : null)}
        onPointerDown={beginDrag('ns-resize', heightCompute)}
        placement={{ position: [p[0], p[1] + extent + ARROW_GAP, p[2]], baseScale }}
        shape="chevron"
      />
      <HandleArrow
        cursor="move"
        hover={hover === 'move'}
        onHoverChange={(h) => setHover(h ? 'move' : null)}
        onPointerDown={onMoveDown}
        placement={{ position: p, baseScale }}
        shape="cross"
      />
      <HandleArrow
        cursor="grab"
        hover={hover === 'rotate'}
        onHoverChange={(h) => setHover(h ? 'rotate' : null)}
        onPointerDown={beginDrag('grabbing', rotateCompute)}
        placement={{ position: [p[0] + extent + ARROW_GAP, p[1], p[2]], baseScale }}
        shape="curved-arrow"
      />
    </group>
  )
}

export default DuctFittingSelectionAffordance
