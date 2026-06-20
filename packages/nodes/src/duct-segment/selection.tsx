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
import { DimensionPill, swallowNextClick, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Euler,
  type Group,
  Matrix4,
  type Object3D,
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
import { HandleCube, MoveChevron, RotateArc } from '../shared/selection-handles'
import { INCHES_TO_METERS } from './geometry'

/** Port-snap radius for dragged run endpoints (meters, XZ). */
const PORT_SNAP_RADIUS_M = 0.4

// In-world arrow handle layout (meters) — the arrows stand off the run body so
// they clear thick trunks.
const CORNER_ARROW_GAP = 0.18
const CORNER_ARROW_MIN_OFFSET = 0.24

/** Roll snap increment — 45°, matching the fitting rotate step. Shift bypasses. */
const ROLL_STEP_RAD = Math.PI / 4

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

// What a corner arrow constrains its drag to: the vertical world axis, or a
// horizontal line along a run-relative direction (node-local XZ unit vector) —
// so a duct drawn at any angle keeps along-run / across-run arrows instead of
// world ±X / ±Z. `along` marks the pair that lies ON the run axis (lengthen /
// shorten) vs the across pair (swing); the up / down pair swings too.
type DragKind = { axis: 'y' } | { axis: 'horizontal'; dir: [number, number]; along: boolean }

// What a run-center arrow translates the WHOLE run along: the vertical world
// axis, or a horizontal line down a run-relative direction (node-local XZ unit
// vector) — so the along-/across-run arrows align with the run instead of
// world ±X / ±Z. Unlike a corner drag there's no pivot, so no swing: every
// path point shifts by the same delta.
type RunMoveKind = { axis: 'y' } | { axis: 'horizontal'; dir: [number, number] }

type CornerArrow = {
  key: string
  /** Path point this arrow drives. */
  index: number
  kind: DragKind
  /** World-local arrow position (offset off the point along its direction). */
  position: Point
  rotationY: number
  /** Set for the vertical pair — tips the flat chevron up / down. */
  vertical?: 'up' | 'down'
  cursor: Cursor
}

/**
 * Selection-time editing for committed duct runs: each path point shows a
 * cluster of directional arrows instead of a free-drag handle — four XZ
 * chevrons (±X / ±Z) plus an up / down vertical pair.
 *
 * Handles are PORTALED into the duct's registered scene group so they
 * share its exact frame — path coords are node-local, and the level /
 * building transform above the group applies to the handles for free.
 * Drag raycasts run in world space and convert hits back into the
 * group's local frame before writing the path.
 *
 * Drag model: the along-run arrow lengthens / shortens the run (locked to the
 * run axis). The across-run (side) and up / down arrows instead SWING the
 * grabbed endpoint around its neighbour at a fixed radius — the run pivots like
 * a compass arm, keeping its length, rather than stretching. Dragged run
 * endpoints still snap onto nearby typed ports (along-run drag) so a loose run
 * can be mated onto a fitting after the fact, and when the dragged endpoint
 * belongs to a straight run whose OTHER end sits on an elbow collar, the elbow
 * re-aims to follow the drag (junction + far collar fixed, bend angle adapts).
 *
 * Modifiers (mirroring the wall corner drag):
 * - **Alt** detaches: the joint breaks for this drag — the elbow does NOT
 *   re-aim and mated fittings / runs do NOT follow; the endpoint moves on its
 *   own (port re-mate still allowed so it can be reattached elsewhere).
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
  const [rolling, setRolling] = useState(false)
  const [runMoving, setRunMoving] = useState(false)
  // Which cube's arrow cluster is open. Hover proved too fiddly (the cursor has
  // to bridge the gap between the dot and its offset arrows), so the cubes are
  // CLICK-to-latch instead: clicking a cube opens its cluster and closes any
  // other; clicking the same cube again closes it. A vertex cluster is keyed by
  // its index, the run-center cluster by 'center'. Cleared on deselect (the
  // whole rig unmounts) and after a drag commits.
  type OpenCluster = number | 'center' | null
  const [openCluster, setOpenCluster] = useState<OpenCluster>(null)
  const toggleCluster = (key: Exclude<OpenCluster, null>) =>
    setOpenCluster((cur) => (cur === key ? null : key))
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
   * `anchorWorld` that faces the camera — drives the up / down vertical drag.
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

  /**
   * Length-preserving HORIZONTAL swing: the unit direction from `pivot` toward
   * a point sharing the cursor's heading but keeping the run's current pitch
   * (vertical component). Caller re-extends it to the fixed radius. Sweeping
   * the end around the pivot in the horizontal plane (a yaw) without changing
   * length. Null when the cursor sits on the pivot's vertical axis (no
   * heading) or the ray misses.
   */
  const swingHorizontal = (event: PointerEvent, pivot: Point, startPoint: Point): Point | null => {
    const r = Math.hypot(
      startPoint[0] - pivot[0],
      startPoint[1] - pivot[1],
      startPoint[2] - pivot[2],
    )
    if (r < 1e-6) return null
    const verticalN = (startPoint[1] - pivot[1]) / r
    const horizN = Math.sqrt(Math.max(0, 1 - verticalN * verticalN))
    const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(pivot))
    const hit = intersect(event.clientX, event.clientY, plane)
    if (!hit) return null
    const local = toLocal(hit)
    const bx = local[0] - pivot[0]
    const bz = local[2] - pivot[2]
    const blen = Math.hypot(bx, bz)
    if (blen < 1e-6) return null
    return [(bx / blen) * horizN, verticalN, (bz / blen) * horizN]
  }

  /**
   * Length-preserving VERTICAL swing: the unit direction from `pivot` toward
   * the cursor within the vertical plane that contains the run's current
   * horizontal heading — so the end tilts up / down (changing pitch) while its
   * heading and length stay fixed. Falls back to a camera-facing vertical plane
   * for a pure riser (no horizontal heading). Null when the ray misses.
   */
  const swingVertical = (event: PointerEvent, pivot: Point, startPoint: Point): Point | null => {
    let hx = startPoint[0] - pivot[0]
    let hz = startPoint[2] - pivot[2]
    let hlen = Math.hypot(hx, hz)
    if (hlen < 1e-6) {
      // Pure riser: no heading — sweep in the plane facing the camera.
      const forward = camera.getWorldDirection(new Vector3())
      hx = forward.x
      hz = forward.z
      hlen = Math.hypot(hx, hz)
      if (hlen < 1e-6) {
        hx = 0
        hz = 1
        hlen = 1
      }
    }
    const headingWorld = new Vector3(hx / hlen, 0, hz / hlen)
    // Plane normal: horizontal, perpendicular to the heading — the plane stands
    // upright and contains both the heading and world-up through the pivot.
    const normal = new Vector3().crossVectors(UP, headingWorld).normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, toWorld(pivot))
    const hit = intersect(event.clientX, event.clientY, plane)
    if (!hit) return null
    const local = toLocal(hit)
    const ax = local[0] - pivot[0]
    const ay = local[1] - pivot[1]
    const az = local[2] - pivot[2]
    const len = Math.hypot(ax, ay, az)
    if (len < 1e-6) return null
    return [ax / len, ay / len, az / len]
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

  // A corner arrow drag: the point is locked to one axis (X / Z / Y). All the
  // rich behaviour — port-snap, elbow re-aim, connectivity follow, single-undo
  // — is shared with every arrow; only the
  // cursor→point projection differs per `kind`.
  const onHandleDown = (index: number, kind: DragKind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = duct.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    const connectivity = analyzePortConnectivity(duct as AnyNode, useScene.getState().nodes)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = kind.axis === 'y' ? 'ns-resize' : 'grabbing'
    setDraggingIndex(index)

    const isEndpoint = index === 0 || index === initialPath.length - 1

    // Swing pivot: the across-run (side) and up / down arrows DON'T stretch the
    // run — they sweep the grabbed point around its neighbour at a fixed radius
    // (the segment's current length), so the run pivots like a compass arm
    // instead of lengthening. The along-run pair keeps the plain lengthen /
    // shorten. The pivot is the adjacent vertex; null when there's no neighbour
    // (a lone point) or the grabbed segment has zero length.
    const swings = kind.axis === 'y' || (kind.axis === 'horizontal' && !kind.along)
    // Pivot only at an endpoint (its single neighbour is the unambiguous "other
    // end"); interior vertices keep the plain per-axis drag.
    const neighborIndex = index === 0 ? 1 : index === initialPath.length - 1 ? index - 1 : null
    const pivot = neighborIndex !== null ? initialPath[neighborIndex]! : null
    const radius = pivot
      ? Math.hypot(startPoint[0] - pivot[0], startPoint[1] - pivot[1], startPoint[2] - pivot[2])
      : 0
    const canSwing = swings && isEndpoint && pivot !== null && radius > 1e-6

    // Elbow re-aim: if this is a straight run whose OTHER end sits on an
    // elbow collar, the elbow swings to follow the drag (junction + far
    // collar fixed, bend angle adapts). Detected once against a drag-start
    // snapshot.
    const elbowEndpoint: ElbowEndpoint | null = isEndpoint
      ? detectElbowEndpoint('duct-segment', initialPath, index, useScene.getState().nodes)
      : null

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // Shift = precision: bypass grid snapping (snap() is a no-op at step 0).
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      // Alt = detach: break the joint for this drag (it can still port-snap to
      // re-mate elsewhere). Mirrors the wall corner drag.
      const detached = event.altKey
      let next: Point | null = null
      if (canSwing && pivot) {
        // Length-preserving swing: aim from the pivot toward the cursor and
        // re-extend to the fixed radius. The up / down arrow swings in the
        // vertical plane that contains the run (so it tilts the run up / down
        // without changing its length); the side arrow swings in the
        // horizontal plane (a yaw about the pivot).
        const aim =
          kind.axis === 'y'
            ? swingVertical(event, pivot, startPoint)
            : swingHorizontal(event, pivot, startPoint)
        if (aim) {
          // The swung endpoint follows the grid snap points by default; Shift
          // sets step 0 so it sweeps smoothly. Snapping the landed coords (not
          // the arc angle) keeps the endpoint on the grid like every other
          // arrow, trading a hair of the fixed radius for grid alignment.
          next = [
            snap(pivot[0] + aim[0] * radius, step),
            Math.max(0, snap(pivot[1] + aim[1] * radius, step)),
            snap(pivot[2] + aim[2] * radius, step),
          ]
        }
      } else if (kind.axis === 'y') {
        // Vertical (riser): keep XZ pinned to the start and drive Y off the
        // cursor against a vertical plane through the point.
        const y = intersectVerticalY(event.clientX, event.clientY, toWorld(startPoint))
        if (y !== null) next = [startPoint[0], Math.max(0, snap(y, step)), startPoint[2]]
      } else {
        // Horizontal: project the cursor onto the plane at the point's height,
        // then lock to the arrow's run-relative line (node-local XZ direction)
        // through the point — so an angled run drags along / across itself, not
        // world ±X / ±Z.
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(startPoint))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          const [dx, dz] = kind.dir
          // Signed displacement of the cursor along the lock direction, snapped.
          const t = snap((local[0] - startPoint[0]) * dx + (local[2] - startPoint[2]) * dz, step)
          next = [startPoint[0] + t * dx, startPoint[1], startPoint[2] + t * dz]
        }
      }
      if (!next) return
      // Port re-mate for any endpoint arrow — the along-/across-run drags AND
      // the length-preserving swings all snap onto a nearby typed port so a
      // loose run can be mated onto a fitting after the fact (the swing's fixed
      // radius yields to the port). Stays available while detaching or
      // free-dragging; suppressed only while the elbow is actively re-aiming.
      if (isEndpoint && (detached || !drag.elbowEndpoint)) {
        const port = findNearestPortXZ(
          [next[0], next[1], next[2]],
          collectScenePorts({ excludeNodeId: duct.id, systems: DUCT_PORT_SYSTEMS }),
          PORT_SNAP_RADIUS_M,
        )
        if (port) next = [port.position[0], port.position[1], port.position[2]]
      }
      if (next[0] === drag.current[0] && next[1] === drag.current[1] && next[2] === drag.current[2])
        return
      const batch = buildDragBatch(drag, next, detached)
      if (!batch) return
      drag.current = next
      drag.detached = detached
      // Tick on each new snapped position — the same grid-snap SFX the draw
      // tools fire; the player debounces rapid repeats (minIntervalMs). Only
      // when the grid is live (step > 0): Shift-precision has nothing to snap.
      if (step > 0) triggerSFX('sfx:grid-snap')
      useScene.getState().updateNodes(batch)
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      // Swallow the trailing synthetic click so it doesn't reach the
      // background-click deselect handler — `cleanup()` drops `inputDragging`
      // synchronously here, so without this the click that fires after
      // pointerup would land with the drag gate already down and clear the
      // selection. Mirrors `useHandleDrag`'s onUp.
      swallowNextClick()
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

  // Roll: spin the rect / oval cross-section about the run (length) axis. The
  // cursor's bearing in the plane perpendicular to the run direction (taken in
  // the cross-section's own width / height basis so the angle maps 1:1 to the
  // visible profile) drives the `roll` field. Round runs look identical at any
  // roll, so the gizmo isn't rendered for them. Roll doesn't move the ports
  // (they sit on the path, whose positions are unchanged), so mated runs /
  // fittings need no follow — just the single-undo dance on the scalar field.
  const onRollDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const axis = runAxisAndCenter(duct)
    if (!axis) return
    const startRoll = duct.roll
    const dir = new Vector3(axis.dir[0], axis.dir[1], axis.dir[2])
    const worldDir = target.localToWorld(dir.clone()).sub(target.localToWorld(new Vector3()))
    worldDir.normalize()
    const center = toWorld(axis.center)
    // Width / height axes at roll 0, mapped to world — the bearing basis. This
    // is the same construction `rectSectionAxes` uses, so a turn of the cursor
    // by θ rolls the section by θ.
    const xBase = new Vector3().crossVectors(UP, dir)
    if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
    xBase.normalize()
    const zBase = new Vector3().crossVectors(xBase, dir).normalize()
    const u = target.localToWorld(xBase.clone()).sub(target.localToWorld(new Vector3())).normalize()
    const v = target.localToWorld(zBase.clone()).sub(target.localToWorld(new Vector3())).normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(worldDir, center)
    const bearing = (clientX: number, clientY: number): number | null => {
      const hit = intersect(clientX, clientY, plane)
      if (!hit) return null
      const d = hit.sub(center)
      return Math.atan2(d.dot(v), d.dot(u))
    }
    const startBearing = bearing(e.nativeEvent.clientX, e.nativeEvent.clientY)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'grabbing'
    setRolling(true)
    let current = startRoll

    const onMove = (event: PointerEvent) => {
      if (startBearing === null) return
      const b = bearing(event.clientX, event.clientY)
      if (b === null) return
      // Snap the roll to 45° steps; Shift = smooth (no snap).
      const raw = b - startBearing
      const delta = event.shiftKey ? raw : Math.round(raw / ROLL_STEP_RAD) * ROLL_STEP_RAD
      const next = startRoll + delta
      if (next === current) return
      current = next
      useScene.getState().updateNode(duct.id, { roll: next })
    }

    const onUp = () => {
      swallowNextClick()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setRolling(false)
      // Single-undo dance: revert to the pre-drag roll while paused, resume,
      // then re-apply the final roll as one tracked change.
      useScene.getState().updateNode(duct.id, { roll: startRoll })
      resumeSceneHistory(useScene)
      if (current !== startRoll) useScene.getState().updateNode(duct.id, { roll: current })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Move the WHOLE run, locked to one direction: the vertical world axis, or a
  // run-relative horizontal line (node-local XZ unit dir) so the along-/across-
  // run arrows track the run instead of world ±X / ±Z. Every path point shifts
  // by the same delta; mated fittings / runs follow via connectivity, and the
  // gesture lands as a single undo step (the same dance the per-point drag
  // uses). The center arrows each bind one direction; the projection is the
  // only thing that differs.
  const onRunMoveDown = (kind: RunMoveKind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = duct.path.map((p) => [...p] as Point)
    const center = runAxisAndCenter(duct)?.center ?? initialPath[0]!
    const connectivity = analyzePortConnectivity(duct as AnyNode, useScene.getState().nodes)
    const anchorWorld = toWorld(center)
    // Grab offset: cursor's start coordinate along the locked direction (signed
    // distance for the horizontal run-relative line), so the run doesn't jump
    // on grab.
    const sample = (clientX: number, clientY: number): number | null => {
      if (kind.axis === 'y') return intersectVerticalY(clientX, clientY, anchorWorld)
      const plane = new Plane().setFromNormalAndCoplanarPoint(UP, anchorWorld)
      const hit = intersect(clientX, clientY, plane)
      if (!hit) return null
      const local = toLocal(hit)
      return local[0] * kind.dir[0] + local[2] * kind.dir[1]
    }
    const startSample = sample(e.nativeEvent.clientX, e.nativeEvent.clientY)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = kind.axis === 'y' ? 'ns-resize' : 'grabbing'
    setRunMoving(true)
    let delta = 0

    const shiftedPath = (d: number): Point[] =>
      initialPath.map((p) => {
        const next = [...p] as Point
        if (kind.axis === 'y') {
          next[1] = Math.max(0, p[1] + d)
        } else {
          next[0] = p[0] + d * kind.dir[0]
          next[2] = p[2] + d * kind.dir[1]
        }
        return next
      })
    const batchFor = (path: Point[]): { id: AnyNodeId; data: Partial<AnyNode> }[] => [
      { id: duct.id as AnyNodeId, data: { path } },
      ...connectivityUpdatesForPath(connectivity, path),
    ]

    const onMove = (event: PointerEvent) => {
      if (startSample === null) return
      const s = sample(event.clientX, event.clientY)
      if (s === null) return
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      const next = snap(s - startSample, step)
      if (next === delta) return
      delta = next
      if (step > 0) triggerSFX('sfx:grid-snap')
      useScene.getState().updateNodes(batchFor(shiftedPath(next)))
    }

    const onUp = () => {
      swallowNextClick()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setRunMoving(false)
      // Single-undo dance: revert run + followers while paused, resume, re-apply
      // the final shift as one tracked change.
      const reverts: { id: AnyNodeId; data: Partial<AnyNode> }[] = (
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
          ...reverts.filter((u) => useScene.getState().nodes[u.id]),
        ])
      resumeSceneHistory(useScene)
      if (delta !== 0) useScene.getState().updateNodes(batchFor(shiftedPath(delta)))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const cornerArrows = useMemo(() => getCornerArrows(duct), [duct])
  const rollGizmo = useMemo(() => (duct.shape === 'round' ? null : runAxisAndCenter(duct)), [duct])
  // Run-center cube position (centroid centerline). The six whole-run move
  // arrows + the roll arc are revealed on hover, like the per-vertex clusters.
  const runCenter = useMemo<Point | null>(() => runAxisAndCenter(duct)?.center ?? null, [duct])
  // Yaw the center cube to the run's horizontal heading so it stays aligned
  // with the run (matching the per-vertex cubes). A pure riser has no heading.
  const runCenterYaw = useMemo<number>(() => {
    const axis = runAxisAndCenter(duct)
    if (!axis || Math.hypot(axis.dir[0], axis.dir[2]) < 1e-6) return 0
    return Math.atan2(-axis.dir[2], axis.dir[0])
  }, [duct])
  // Six whole-run move arrows offset off the center: four horizontal (along-run
  // ± and across-run ±, aligned to the run's XZ tangent so they track the run
  // instead of world ±X / ±Z) plus the up / down vertical pair. All shift every
  // path point rigidly — no swing (the whole run has no pivot).
  const centerArrows = useMemo(() => {
    if (!runCenter) return []
    const base = Math.max(runRadiusM(duct) + CORNER_ARROW_GAP, CORNER_ARROW_MIN_OFFSET)
    // Run's horizontal heading (node-local XZ). A pure riser has none → fall
    // back to world +X so the arrows stay usable.
    const axis = runAxisAndCenter(duct)
    const t: [number, number] =
      axis && Math.hypot(axis.dir[0], axis.dir[2]) > 1e-6
        ? (() => {
            const len = Math.hypot(axis.dir[0], axis.dir[2])
            return [axis.dir[0] / len, axis.dir[2] / len]
          })()
        : [1, 0]
    const runYaw = Math.atan2(-t[1], t[0])
    const horiz: { key: string; dir: [number, number] }[] = [
      { key: 'along+', dir: [t[0], t[1]] },
      { key: 'along-', dir: [-t[0], -t[1]] },
      { key: 'across+', dir: [-t[1], t[0]] },
      { key: 'across-', dir: [t[1], -t[0]] },
    ]
    const arrows: {
      key: string
      kind: RunMoveKind
      position: Point
      rotationY: number
      vertical?: 'up' | 'down'
      cursor: Cursor
    }[] = horiz.map(({ key, dir }) => ({
      key,
      kind: { axis: 'horizontal', dir },
      position: [runCenter[0] + dir[0] * base, runCenter[1], runCenter[2] + dir[1] * base],
      rotationY: Math.atan2(-dir[1], dir[0]),
      cursor: 'grab',
    }))
    arrows.push(
      {
        key: '+y',
        kind: { axis: 'y' },
        position: [runCenter[0], runCenter[1] + base, runCenter[2]],
        rotationY: runYaw,
        vertical: 'up',
        cursor: 'ns-resize',
      },
      {
        key: '-y',
        kind: { axis: 'y' },
        position: [runCenter[0], runCenter[1] - base, runCenter[2]],
        rotationY: runYaw,
        vertical: 'down',
        cursor: 'ns-resize',
      },
    )
    return arrows
  }, [duct, runCenter])

  return (
    <group ref={outerRef}>
      {/* Per-vertex affordances — hidden while a drag / roll is live (the window
          pointer handlers own the gesture). Each vertex shows a small cube;
          CLICKING the cube latches its directional cluster open (click again to
          close), so a multi-bend run isn't a thicket of darts and the reveal
          doesn't depend on a finicky hover. */}
      {draggingIndex === null &&
        !rolling &&
        !runMoving &&
        duct.path.map((p, i) => (
          <group key={`vtx${i}`}>
            <HandleCube
              active={openCluster === i}
              onClick={() => toggleCluster(i)}
              position={p as Point}
              rotationY={vertexYaw(duct, i)}
            />
            {openCluster === i &&
              cornerArrows
                .filter((a) => a.index === i)
                .map((a) => (
                  <MoveChevron
                    cursor={a.cursor}
                    key={a.key}
                    onPointerDown={onHandleDown(a.index, a.kind)}
                    position={a.position}
                    rotationY={a.rotationY}
                    vertical={a.vertical}
                  />
                ))}
          </group>
        ))}
      {/* Run-center cube — clicking it latches the whole-run cluster open: six
          axis-locked move arrows (±X / ±Y / ±Z) plus the roll arc (rect / oval
          only). The six arrows shift every path point by the same delta; the
          roll arc spins the cross-section about the run axis. */}
      {draggingIndex === null && !rolling && !runMoving && runCenter && (
        <group>
          <HandleCube
            active={openCluster === 'center'}
            onClick={() => toggleCluster('center')}
            position={runCenter}
            rotationY={runCenterYaw}
          />
          {openCluster === 'center' && (
            <>
              {centerArrows.map((a) => (
                <MoveChevron
                  cursor={a.cursor}
                  key={a.key}
                  onPointerDown={onRunMoveDown(a.kind)}
                  position={a.position}
                  rotationY={a.rotationY}
                  vertical={a.vertical}
                />
              ))}
              {rollGizmo && (
                <RollHandle
                  center={rollGizmo.center}
                  dir={rollGizmo.dir}
                  onPointerDown={onRollDown}
                  radius={runRadiusM(duct) + CORNER_ARROW_GAP}
                />
              )}
            </>
          )}
        </group>
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
 * Roll gizmo — the shared `RotateArc` re-oriented to wrap the run's length
 * axis, seated at a FIXED corner of the section frame. It does NOT track
 * `roll`, so the grip stays still while the user spins the duct (otherwise it
 * chases the cursor and is hard to keep hold of).
 *
 * The `curved-arrow` geometry wraps its LOCAL +Y (the spin axis) and bulges
 * its arc apex along LOCAL +X. Orienting with a single `setFromUnitVectors`
 * only pins the spin axis and leaves the apex pointing an arbitrary way, so the
 * arc faced inconsistently across run directions. Instead we build a FULLY
 * determined basis: +Y → run direction (the roll axis), +X → the top-outer 45°
 * corner direction (so the apex always bulges outward at that corner), +Z the
 * derived right-handed third axis. Position rides the same corner direction off
 * the centre, so the grip and its curve always agree.
 */
function RollHandle({
  center,
  dir,
  radius,
  onPointerDown,
}: {
  center: Point
  dir: Point
  radius: number
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { position, rotation } = useMemo<{
    position: Point
    rotation: [number, number, number]
  }>(() => {
    const runDir = new Vector3(dir[0], dir[1], dir[2]).normalize()
    const xBase = new Vector3().crossVectors(UP, runDir)
    if (xBase.lengthSq() < 1e-8) xBase.set(1, 0, 0)
    xBase.normalize()
    const zBase = new Vector3().crossVectors(xBase, runDir).normalize()
    const a = Math.PI / 4
    // Top-outer 45° corner of the section frame (between the top and a side
    // face) — both the position offset and the arc apex ride this direction.
    const cornerDir = xBase
      .clone()
      .multiplyScalar(Math.sin(a))
      .addScaledVector(zBase, -Math.cos(a))
      .normalize()
    const pos: Point = [
      center[0] + cornerDir.x * radius,
      center[1] + cornerDir.y * radius,
      center[2] + cornerDir.z * radius,
    ]
    // Basis: X = apex/corner, Y = roll axis (run dir), Z = right-handed third.
    const zAxis = new Vector3().crossVectors(cornerDir, runDir).normalize()
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(cornerDir, runDir, zAxis),
    )
    const e = new Euler().setFromQuaternion(q)
    return { position: pos, rotation: [e.x, e.y, e.z] }
  }, [center, dir, radius])

  return <RotateArc onPointerDown={onPointerDown} position={position} rotation={rotation} />
}

// Per-point directional arrows: at every path vertex, four horizontal chevrons
// (along-run ± and across-run ±) plus an up / down vertical pair. The
// horizontal pair is aligned to the run's node-local TANGENT at that vertex,
// not world ±X / ±Z, so a duct drawn at any angle (or rotated) keeps
// along-/across-run arrows. `rotationY` orients each flat chevron to point
// along its direction (the same `atan2(-z, x)` mapping the wall move handles
// use). Arrows stand off the run body so they clear thick trunks. At an
// endpoint the chevron pointing back INTO the run (toward the neighbour) is
// dropped — its outward twin already shortens / lengthens that end either way.
function getCornerArrows(duct: DuctSegmentNode): CornerArrow[] {
  const arrows: CornerArrow[] = []
  const base = Math.max(runRadiusM(duct) + CORNER_ARROW_GAP, CORNER_ARROW_MIN_OFFSET)
  const last = duct.path.length - 1
  duct.path.forEach((p, i) => {
    // Run tangent at this vertex (node-local XZ). A pure-riser vertex has no
    // horizontal extent → fall back to world +X so the arrows stay usable.
    const t = vertexTangentXZ(duct, i) ?? [1, 0]
    // Yaw that aligns a handle's local +X with the run tangent — shared by the
    // up / down chevrons so their flat plates align with the run (the ±Y tip
    // is added on top, and yawing about Y keeps them pointing up / down).
    const runYaw = Math.atan2(-t[1], t[0])
    // along the run (lengthen / shorten), then across it (swing — tangent
    // rotated ±90°).
    const dirs: { dir: [number, number]; along: boolean }[] = [
      { dir: [t[0], t[1]], along: true },
      { dir: [-t[0], -t[1]], along: true },
      { dir: [-t[1], t[0]], along: false },
      { dir: [t[1], -t[0]], along: false },
    ]
    // Inward (toward the run body) at an endpoint: i=0 the tangent points at
    // the neighbour, i=last it points away — so inward is ∓tangent. Interior
    // points keep all four arrows.
    const inward: [number, number] | null =
      i === 0 ? [t[0], t[1]] : i === last ? [-t[0], -t[1]] : null
    for (const { dir, along } of dirs) {
      const [dx, dz] = dir
      if (inward && dx * inward[0] + dz * inward[1] > 0.999) continue
      arrows.push({
        key: `pt${i}-${dx.toFixed(3)}:${dz.toFixed(3)}`,
        index: i,
        kind: { axis: 'horizontal', dir: [dx, dz], along },
        position: [p[0] + dx * base, p[1], p[2] + dz * base],
        rotationY: Math.atan2(-dz, dx),
        cursor: 'grab',
      })
    }
    arrows.push({
      key: `pt${i}-up`,
      index: i,
      kind: { axis: 'y' },
      position: [p[0], p[1] + base, p[2]],
      rotationY: runYaw,
      vertical: 'up',
      cursor: 'ns-resize',
    })
    arrows.push({
      key: `pt${i}-down`,
      index: i,
      kind: { axis: 'y' },
      position: [p[0], p[1] - base, p[2]],
      rotationY: runYaw,
      vertical: 'down',
      cursor: 'ns-resize',
    })
  })
  return arrows
}

/**
 * Node-local XZ unit tangent of the run at vertex `i`: toward the neighbour at
 * an endpoint, the averaged direction of the two adjacent segments at an
 * interior corner. Null when the run has no horizontal extent there (a pure
 * riser vertex), so the caller falls back to a world-aligned arrow.
 */
function vertexTangentXZ(duct: DuctSegmentNode, i: number): [number, number] | null {
  const path = duct.path
  const last = path.length - 1
  if (last < 1) return null
  const seg = (a: number, b: number): [number, number] | null => {
    const dx = path[b]![0] - path[a]![0]
    const dz = path[b]![2] - path[a]![2]
    const len = Math.hypot(dx, dz)
    return len < 1e-6 ? null : [dx / len, dz / len]
  }
  if (i === 0) return seg(0, 1)
  if (i === last) return seg(last - 1, last)
  const inc = seg(i - 1, i)
  const out = seg(i, i + 1)
  if (!inc) return out
  if (!out) return inc
  const sx = inc[0] + out[0]
  const sz = inc[1] + out[1]
  const len = Math.hypot(sx, sz)
  return len < 1e-6 ? inc : [sx / len, sz / len]
}

/** Y-yaw that aligns a handle's local +X with the run tangent at vertex `i`. */
function vertexYaw(duct: DuctSegmentNode, i: number): number {
  const t = vertexTangentXZ(duct, i)
  return t ? Math.atan2(-t[1], t[0]) : 0
}

/**
 * Overall run direction and midpoint (node-local), for the roll gizmo. The
 * direction is path[0]→last (the run's gross axis), falling back to the first
 * segment when the ends coincide; the centre is their midpoint. Null when the
 * run has no length to roll about.
 */
function runAxisAndCenter(duct: DuctSegmentNode): { dir: Point; center: Point } | null {
  const path = duct.path
  if (path.length < 2) return null
  const a = path[0]!
  const b = path[path.length - 1]!
  let dx = b[0] - a[0]
  let dy = b[1] - a[1]
  let dz = b[2] - a[2]
  let len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) {
    const c = path[1]!
    dx = c[0] - a[0]
    dy = c[1] - a[1]
    dz = c[2] - a[2]
    len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return null
  }
  return {
    dir: [dx / len, dy / len, dz / len],
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  }
}

export default DuctSegmentSelectionAffordance
