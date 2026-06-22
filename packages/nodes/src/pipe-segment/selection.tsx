'use client'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type Cursor,
  type PipeFittingNode,
  PipeSegmentNode,
  type PortConnectivity,
  pauseSceneHistory,
  resolveConnectivityUpdates,
  resumeSceneHistory,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { DimensionPill, swallowNextClick, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import {
  detectFittingEndpoint,
  type FittingEndpoint,
  planFittingEndpointReaim,
} from '../shared/fitting-endpoint-reaim'
import { PipeFittingGhost, PipeSegmentGhost } from '../shared/mep-ghost'
import { planPipeRunTranslationOffsets } from '../shared/pipe-run-translation-offset'
import { planVerticalOffsets, type VerticalOffsetResult } from '../shared/pipe-vertical-offset'
import { collectScenePorts, DWV_PORT_SYSTEMS, findNearestPortXZ } from '../shared/ports'
import { HandleCube, MoveChevron } from '../shared/selection-handles'

/** Port-snap radius for dragged run endpoints (meters, XZ). */
const PORT_SNAP_RADIUS_M = 0.4
const CENTER_ARROW_GAP = 0.28
const CENTER_ARROW_MIN_OFFSET = 0.4
const INCHES_TO_METERS = 0.0254

const UP = new Vector3(0, 1, 0)

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

type Point = [number, number, number]
type DragKind =
  | { axis: 'y'; along?: boolean }
  | { axis: 'horizontal'; dir: [number, number]; along: boolean }
type RunMoveKind = { axis: 'y' } | { axis: 'horizontal'; dir: [number, number] }
type CornerArrow = {
  key: string
  index: number
  kind: DragKind
  position: Point
  rotationY: number
  vertical?: 'up' | 'down'
  cursor: Cursor
}

function pipeRadiusM(pipe: PipeSegmentNode): number {
  return (pipe.diameter * INCHES_TO_METERS) / 2
}

/**
 * Selection-time editing for committed DWV pipe runs: every path point gets
 * the same click-to-open directional cube used by duct runs, with DWV port
 * snapping and pipe elbow re-aim.
 *
 * Handles are PORTALED into the pipe's registered scene group so they
 * share its exact frame — path coords are node-local, and the level /
 * building transform above the group applies to the handles for free.
 * Drag raycasts run in world space and convert hits back into the
 * group's local frame before writing the path.
 *
 * Drag model: along-run arrows lengthen / shorten; across-run and vertical
 * arrows swing endpoint vertices around their neighbour at a fixed radius,
 * matching duct corner UX. Dragged endpoints still snap onto nearby typed DWV
 * ports, and a straight run whose other end sits on a pipe elbow collar
 * re-aims that elbow to follow the drag.
 *
 * Modifiers (mirroring the duct corner drag):
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
  const mount = target.parent ?? target
  return createPortal(<PipePointHandles pipe={pipe} target={target} />, mount, undefined)
}

const PipePointHandles = ({ pipe, target }: { pipe: PipeSegmentNode; target: Object3D }) => {
  const { camera, gl } = useThree()
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
  const [runMoving, setRunMoving] = useState(false)
  const [verticalGhost, setVerticalGhost] = useState<{
    tint: 'valid' | 'invalid'
    fittings: PipeFittingNode[]
    risers: PipeSegmentNode[]
  } | null>(null)
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

  const swingVertical = (event: PointerEvent, pivot: Point, startPoint: Point): Point | null => {
    let hx = startPoint[0] - pivot[0]
    let hz = startPoint[2] - pivot[2]
    let hlen = Math.hypot(hx, hz)
    if (hlen < 1e-6) {
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

  const onHandleDown = (index: number, kind: DragKind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const initialPath = pipe.path.map((p) => [...p] as Point)
    const startPoint = initialPath[index]!
    const connectivity = analyzePortConnectivity(pipe as AnyNode, useScene.getState().nodes)
    pauseSceneHistory(useScene)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = kind.axis === 'y' ? 'ns-resize' : 'grabbing'
    setDraggingIndex(index)

    const isEndpoint = index === 0 || index === initialPath.length - 1
    const swings = kind.axis === 'y' ? kind.along !== true : !kind.along
    const neighborIndex = index === 0 ? 1 : index === initialPath.length - 1 ? index - 1 : null
    const pivot = neighborIndex !== null ? initialPath[neighborIndex]! : null
    const radius = pivot
      ? Math.hypot(startPoint[0] - pivot[0], startPoint[1] - pivot[1], startPoint[2] - pivot[2])
      : 0
    const canSwing = swings && isEndpoint && pivot !== null && radius > 1e-6

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
      // Shift = precision: bypass grid snapping for a perfectly smooth
      // drag (snap() is a no-op at step 0).
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      // Alt = detach: break the joint for this drag — the endpoint moves on
      // its own, no elbow re-aim and no connectivity follow (it can still
      // port-snap to re-mate elsewhere). Mirrors the wall corner drag.
      const detached = event.altKey
      let next: Point | null = null
      if (canSwing && pivot) {
        const aim =
          kind.axis === 'y'
            ? swingVertical(event, pivot, startPoint)
            : swingHorizontal(event, pivot, startPoint)
        if (aim) {
          next = [
            snap(pivot[0] + aim[0] * radius, step),
            snap(pivot[1] + aim[1] * radius, step),
            snap(pivot[2] + aim[2] * radius, step),
          ]
        }
      } else if (kind.axis === 'y') {
        const y = intersectVerticalY(event.clientX, event.clientY, toWorld(startPoint))
        if (y !== null) next = [startPoint[0], snap(y, step), startPoint[2]]
      } else {
        const plane = new Plane().setFromNormalAndCoplanarPoint(UP, toWorld(startPoint))
        const hit = intersect(event.clientX, event.clientY, plane)
        if (hit) {
          const local = toLocal(hit)
          const [dx, dz] = kind.dir
          const t = snap((local[0] - startPoint[0]) * dx + (local[2] - startPoint[2]) * dz, step)
          next = [startPoint[0] + t * dx, startPoint[1], startPoint[2] + t * dz]
        }
      }
      if (!next) return
      if (isEndpoint && (detached || !drag.fittingEndpoint)) {
        const port = findNearestPortXZ(
          [next[0], next[1], next[2]],
          collectScenePorts({ excludeNodeId: pipe.id, systems: DWV_PORT_SYSTEMS }),
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
      if (step > 0) triggerSFX('sfx:grid-snap')
      useScene.getState().updateNodes(batch)
    }

    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      swallowNextClick()
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

  const onRunMoveDown = (kind: RunMoveKind) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const parentId = (pipe.parentId ?? undefined) as AnyNodeId | undefined
    const initialPath = pipe.path.map((p) => [...p] as Point)
    const center = runAxisAndCenter(pipe)?.center ?? initialPath[0]!
    const anchorWorld = toWorld(center)
    const profile = { diameter: pipe.diameter, pipeMaterial: pipe.pipeMaterial }
    const nodesById: Record<string, AnyNode> = { ...useScene.getState().nodes }
    const connectivity = analyzePortConnectivity(pipe as AnyNode, nodesById)
    const scenePorts = collectScenePorts({
      excludeNodeId: pipe.id as AnyNodeId,
      systems: DWV_PORT_SYSTEMS,
    })
    const previewDeletedSnapshots = new Map<AnyNodeId, AnyNode>()

    pauseSceneHistory(useScene)

    const ensureSceneObjectsVisible = (ids: Iterable<AnyNodeId>) => {
      const scene = useScene.getState()
      for (const id of ids) {
        const obj = sceneRegistry.nodes.get(id)
        if (obj) {
          obj.visible = true
          obj.traverse((child) => {
            child.visible = true
          })
        }
        if (scene.nodes[id]) scene.markDirty(id)
      }
    }
    const livePreviewIds = new Set<AnyNodeId>()
    const publishLivePreview = (updates: { id: AnyNodeId; data: Partial<AnyNode> }[]) => {
      const scene = useScene.getState()
      const entries = updates
        .filter((update) => scene.nodes[update.id])
        .map((update) => [update.id, update.data as Record<string, unknown>] as const)
      if (entries.length === 0) return
      useLiveNodeOverrides.getState().setMany(entries)
      for (const [id] of entries) {
        livePreviewIds.add(id)
        scene.markDirty(id)
      }
    }
    const clearLivePreview = () => {
      const overrides = useLiveNodeOverrides.getState()
      for (const id of livePreviewIds) overrides.clear(id)
      livePreviewIds.clear()
    }
    const restorePreviewDeleted = (keepDeleted: readonly AnyNodeId[] = []) => {
      const keep = new Set<AnyNodeId>(keepDeleted)
      const scene = useScene.getState()
      const create: { node: AnyNode; parentId?: AnyNodeId }[] = []
      for (const [id, node] of previewDeletedSnapshots) {
        if (keep.has(id)) continue
        if (!scene.nodes[id]) {
          create.push({
            node,
            parentId: (node.parentId ?? undefined) as AnyNodeId | undefined,
          })
        }
        previewDeletedSnapshots.delete(id)
      }
      if (create.length > 0) {
        scene.applyNodeChanges({ create })
        ensureSceneObjectsVisible(create.map(({ node }) => node.id as AnyNodeId))
      }
    }

    const sample = (clientX: number, clientY: number): number | null => {
      if (kind.axis === 'y') return intersectVerticalY(clientX, clientY, anchorWorld)
      const plane = new Plane().setFromNormalAndCoplanarPoint(UP, anchorWorld)
      const hit = intersect(clientX, clientY, plane)
      if (!hit) return null
      const local = toLocal(hit)
      return local[0] * kind.dir[0] + local[2] * kind.dir[1]
    }
    const startSample = sample(e.nativeEvent.clientX, e.nativeEvent.clientY)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = kind.axis === 'y' ? 'ns-resize' : 'grabbing'
    setRunMoving(true)
    let delta = 0
    let offsetResult: VerticalOffsetResult = null

    const shiftedPath = (d: number): Point[] =>
      initialPath.map((p) => {
        const next = [...p] as Point
        if (kind.axis === 'y') {
          next[1] = p[1] + d
        } else {
          next[0] = p[0] + d * kind.dir[0]
          next[2] = p[2] + d * kind.dir[1]
        }
        return next
      })
    const batchFor = (path: Point[]): { id: AnyNodeId; data: Partial<AnyNode> }[] => [
      { id: pipe.id as AnyNodeId, data: { path } },
      ...connectivityUpdatesForPath(connectivity, path),
    ]
    const partnerReverts = (): { id: AnyNodeId; data: Partial<AnyNode> }[] =>
      (connectivity?.connections ?? [])
        .map((conn) => {
          if (conn.kind !== 'rigid-node') {
            return { id: conn.nodeId, data: { path: conn.startPath } as Partial<AnyNode> }
          }
          const start = nodesById[conn.nodeId] as Record<string, unknown> | undefined
          const data: Record<string, unknown> = { position: conn.startPosition }
          if (start?.rotation !== undefined) data.rotation = start.rotation
          if (start?.angle !== undefined) data.angle = start.angle
          return { id: conn.nodeId, data: data as Partial<AnyNode> }
        })
        .filter((u) => useScene.getState().nodes[u.id])

    const onMove = (event: PointerEvent) => {
      if (startSample === null) return
      const s = sample(event.clientX, event.clientY)
      if (s === null) return
      const step = event.shiftKey ? 0 : useEditor.getState().gridSnapStep
      const next = snap(s - startSample, step)
      if (next === delta) return
      delta = next
      if (step > 0) triggerSFX('sfx:grid-snap')
      offsetResult =
        kind.axis === 'y' && next !== 0
          ? planVerticalOffsets({
              pipe,
              dy: next,
              profile,
              connections: connectivity?.connections ?? [],
              scenePorts,
              nodesById,
            })
          : null

      if (offsetResult?.status === 'valid') {
        const plan = offsetResult.plan
        const scene = useScene.getState()
        const deletePreview = (plan.delete ?? []).filter((id) => scene.nodes[id])
        for (const id of deletePreview) {
          const node = scene.nodes[id]
          if (node) previewDeletedSnapshots.set(id, node)
        }
        restorePreviewDeleted(plan.delete ?? [])
        const followUpdates = connectivityUpdatesForPath(connectivity, plan.followPath)
        const updates = [
          { id: pipe.id as AnyNodeId, data: { path: plan.pipePath } },
          ...plan.updates.filter((u) => scene.nodes[u.id]),
          ...followUpdates,
        ]
        publishLivePreview(updates)
        scene.applyNodeChanges({ delete: deletePreview, update: updates })
        ensureSceneObjectsVisible(updates.map((update) => update.id))
        setVerticalGhost({ tint: 'valid', fittings: plan.fittings, risers: plan.risers })
      } else if (offsetResult?.status === 'invalid') {
        restorePreviewDeleted()
        const updates = [
          { id: pipe.id as AnyNodeId, data: { path: pipe.path } },
          ...partnerReverts(),
        ]
        publishLivePreview(updates)
        useScene.getState().updateNodes(updates)
        const lifted = PipeSegmentNode.parse({ ...pipe, path: shiftedPath(next) })
        setVerticalGhost({ tint: 'invalid', fittings: [], risers: [lifted] })
      } else {
        restorePreviewDeleted()
        setVerticalGhost(null)
        const updates = batchFor(shiftedPath(next))
        publishLivePreview(updates)
        useScene.getState().updateNodes(updates)
        ensureSceneObjectsVisible(updates.map((update) => update.id))
      }
    }

    const onUp = () => {
      swallowNextClick()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setRunMoving(false)
      setVerticalGhost(null)
      clearLivePreview()

      const restore = useScene.getState()
      const restoredPreviewNodes = Array.from(previewDeletedSnapshots.values()).filter(
        (node) => !restore.nodes[node.id],
      )
      const restoreUpdates = [
        { id: pipe.id as AnyNodeId, data: { path: initialPath } as Partial<AnyNode> },
        ...partnerReverts(),
      ]
      restore.applyNodeChanges({
        create: restoredPreviewNodes.map((node) => ({
          node,
          parentId: (node.parentId ?? undefined) as AnyNodeId | undefined,
        })),
        update: restoreUpdates,
      })
      ensureSceneObjectsVisible([
        ...restoredPreviewNodes.map((node) => node.id as AnyNodeId),
        ...restoreUpdates.map((update) => update.id),
      ])
      resumeSceneHistory(useScene)
      if (delta === 0) return
      const result = offsetResult
      if (result?.status === 'invalid') return
      const scene = useScene.getState()
      if (result?.status === 'valid') {
        const plan = result.plan
        const minted = [...plan.fittings, ...plan.risers]
        const followUpdates = connectivityUpdatesForPath(connectivity, plan.followPath)
        const updates = [
          { id: pipe.id as AnyNodeId, data: { path: plan.pipePath } },
          ...plan.updates.filter((u) => scene.nodes[u.id]),
          ...followUpdates,
        ]
        scene.applyNodeChanges({
          create: minted.map((node) => ({ node: node as AnyNode, parentId })),
          delete: (plan.delete ?? []).filter((id) => scene.nodes[id]),
          update: updates,
        })
        ensureSceneObjectsVisible([
          ...minted.map((node) => node.id as AnyNodeId),
          ...updates.map((update) => update.id),
        ])
        return
      }
      const finalPath = shiftedPath(delta)
      const translationPlan =
        kind.axis !== 'y' && connectivity
          ? planPipeRunTranslationOffsets({
              pipe,
              translatedPath: finalPath,
              profile,
              connections: connectivity.connections,
              scenePorts,
              nodesById,
            })
          : null
      if (translationPlan) {
        const created = [...translationPlan.fittings, ...translationPlan.connectors]
        const updates = [
          { id: pipe.id as AnyNodeId, data: { path: translationPlan.pipePath } },
          ...translationPlan.updates,
        ]
        scene.applyNodeChanges({
          create: created.map((node) => ({ node: node as AnyNode, parentId })),
          update: updates,
        })
        ensureSceneObjectsVisible([
          ...created.map((node) => node.id as AnyNodeId),
          ...updates.map((update) => update.id),
        ])
        return
      }
      const updates = batchFor(finalPath)
      useScene.getState().updateNodes(updates)
      ensureSceneObjectsVisible(updates.map((update) => update.id))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const cornerArrows = useMemo(() => getCornerArrows(pipe), [pipe])
  const runCenter = useMemo<Point | null>(() => runAxisAndCenter(pipe)?.center ?? null, [pipe])
  const runCenterYaw = useMemo<number>(() => {
    const axis = runAxisAndCenter(pipe)
    if (!axis || Math.hypot(axis.dir[0], axis.dir[2]) < 1e-6) return 0
    return Math.atan2(-axis.dir[2], axis.dir[0])
  }, [pipe])
  const centerArrows = useMemo(() => {
    if (!runCenter) return []
    const base = Math.max(pipeRadiusM(pipe) + CENTER_ARROW_GAP, CENTER_ARROW_MIN_OFFSET)
    const axis = runAxisAndCenter(pipe)
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
  }, [pipe, runCenter])

  return (
    <group ref={outerRef}>
      {verticalGhost?.fittings.map((f) => (
        <PipeFittingGhost fitting={f} key={`pipe-vghost-fit-${f.id}`} tint={verticalGhost.tint} />
      ))}
      {verticalGhost?.risers.map((r) => (
        <PipeSegmentGhost key={`pipe-vghost-riser-${r.id}`} pipe={r} tint={verticalGhost.tint} />
      ))}
      {draggingIndex === null &&
        !runMoving &&
        pipe.path.map((p, i) => (
          <group key={`pipe-vtx${i}`}>
            <HandleCube
              active={openCluster === i}
              onClick={() => toggleCluster(i)}
              position={p as Point}
              rotationY={vertexYaw(pipe, i)}
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
      {draggingIndex === null && !runMoving && runCenter && (
        <group>
          <HandleCube
            active={openCluster === 'center'}
            onClick={() => toggleCluster('center')}
            position={runCenter}
            rotationY={runCenterYaw}
          />
          {openCluster === 'center' &&
            centerArrows.map((a) => (
              <MoveChevron
                cursor={a.cursor}
                key={a.key}
                onPointerDown={onRunMoveDown(a.kind)}
                position={a.position}
                rotationY={a.rotationY}
                vertical={a.vertical}
              />
            ))}
        </group>
      )}
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

function getCornerArrows(pipe: PipeSegmentNode): CornerArrow[] {
  const arrows: CornerArrow[] = []
  const base = Math.max(pipeRadiusM(pipe) + CENTER_ARROW_GAP, CENTER_ARROW_MIN_OFFSET)
  const last = pipe.path.length - 1
  pipe.path.forEach((p, i) => {
    const tangentXZ = vertexTangentXZ(pipe, i)
    const verticalTangentY = tangentXZ ? null : vertexTangentY(pipe, i)
    const t = tangentXZ ?? ([1, 0] as [number, number])
    const runYaw = Math.atan2(-t[1], t[0])
    const dirs: { dir: [number, number]; along: boolean }[] = tangentXZ
      ? [
          { dir: [t[0], t[1]], along: true },
          { dir: [-t[0], -t[1]], along: true },
          { dir: [-t[1], t[0]], along: false },
          { dir: [t[1], -t[0]], along: false },
        ]
      : [
          { dir: [1, 0], along: false },
          { dir: [-1, 0], along: false },
          { dir: [0, 1], along: false },
          { dir: [0, -1], along: false },
        ]
    const inward: [number, number] | null =
      tangentXZ && i === 0 ? [t[0], t[1]] : tangentXZ && i === last ? [-t[0], -t[1]] : null
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
    const inwardY =
      verticalTangentY && i === 0
        ? verticalTangentY
        : verticalTangentY && i === last
          ? -verticalTangentY
          : null
    for (const sign of [1, -1] as const) {
      if (inwardY === sign) continue
      arrows.push({
        key: `pt${i}-${sign > 0 ? 'up' : 'down'}`,
        index: i,
        kind: { axis: 'y', along: verticalTangentY !== null },
        position: [p[0], p[1] + sign * base, p[2]],
        rotationY: runYaw,
        vertical: sign > 0 ? 'up' : 'down',
        cursor: 'ns-resize',
      })
    }
  })
  return arrows
}

function vertexTangentXZ(pipe: PipeSegmentNode, i: number): [number, number] | null {
  const path = pipe.path
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

function vertexTangentY(pipe: PipeSegmentNode, i: number): 1 | -1 | null {
  const path = pipe.path
  const last = path.length - 1
  if (last < 1) return null
  const seg = (a: number, b: number): 1 | -1 | null => {
    const dx = path[b]![0] - path[a]![0]
    const dy = path[b]![1] - path[a]![1]
    const dz = path[b]![2] - path[a]![2]
    if (Math.hypot(dx, dz) > 1e-6 || Math.abs(dy) < 1e-6) return null
    return dy > 0 ? 1 : -1
  }
  if (i === 0) return seg(0, 1)
  if (i === last) return seg(last - 1, last)
  const inc = seg(i - 1, i)
  const out = seg(i, i + 1)
  if (!inc) return out
  if (!out) return inc
  return inc === out ? inc : null
}

function vertexYaw(pipe: PipeSegmentNode, i: number): number {
  const t = vertexTangentXZ(pipe, i)
  return t ? Math.atan2(-t[1], t[0]) : 0
}

function runAxisAndCenter(pipe: PipeSegmentNode): { dir: Point; center: Point } | null {
  const path = pipe.path
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

export default PipeSegmentSelectionAffordance
