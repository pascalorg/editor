'use client'

import {
  type AnyNode,
  type AnyNodeId,
  beginSceneHistoryPauseSession,
  createWallBoundSurfaceFollower,
  emitter,
  type GridEvent,
  getPerpendicularWallMoveAxis,
  getPlannedLinkedWallUpdates,
  planWallMoveJunctions,
  resolveMovedWallSupportSlabPatch,
  useLiveNodeOverrides,
  useScene,
  type WallMoveAxis,
  type WallMoveJunctionPlan,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  getSegmentGridStep,
  isSegmentLongEnough,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  snapScalarToGrid,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three'
import {
  buildBridgeWallCreates,
  buildBridgeWallPreviews,
  type GhostWallPreview,
  getLinkedWallSnapshots,
  getWallsAfterUpdates,
  type LinkedWallSnapshot,
  stripWallIsNewMetadata,
} from './move-shared'

/**
 * Phase 5 Stage D — wall whole-move tool (kind-owned).
 *
 * 1:1 port of the legacy `MoveWallTool` (804 LoC, the most complex
 * single tool in the editor). Preserves every behavior:
 *
 *  - **Center-drag with axis lock** — wall stays perpendicular to its
 *    move axis unless rotated via R/T (45° steps).
 *  - **Linked-wall corner cascade** — neighbours sharing endpoints
 *    move with the dragged wall via `planWallMoveJunctions`.
 *  - **Bridge wall ghost previews** — when a corner separates, a
 *    translucent ghost shows the new wall that would be inserted.
 *  - **Auto-slab live preview** — the automatic slabs and ceilings the
 *    moving walls bound follow them through live overrides, from boundary
 *    membership read once at arm time (no room detection per tick).
 *  - **One undo step** — the drag writes no history; the drop writes walls,
 *    supports and the sync's derived rooms as one step, through a pause
 *    session shared with the 2D move overlay (`commitStep`).
 *  - **`isNew` metadata strip** — first commit after a fresh wall
 *    placement clears the placement marker.
 *  - **Activation grace** (150ms).
 *
 * Mounted via `def.affordanceTools.move` from `wall/definition.ts`.
 */
function rotateVector([x, z]: [number, number], angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - z * sin, x * sin + z * cos]
}

function setPreviewGeometryAttributes(
  geometry: BufferGeometry,
  positions: number[],
  normals: number[],
  uvs: number[],
) {
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new Float32BufferAttribute([...uvs], 2))
}

function createWallPreviewGeometry(length: number, height: number) {
  const geometry = new BufferGeometry()
  setPreviewGeometryAttributes(
    geometry,
    [0, 0, 0, length, 0, 0, length, height, 0, 0, height, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 0, 1, 0, 1, 1, 0, 1],
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeBoundingSphere()
  return geometry
}

function GhostWallPreviewMesh({ preview }: { preview: GhostWallPreview }) {
  const dx = preview.end[0] - preview.start[0]
  const dz = preview.end[1] - preview.start[1]
  const length = Math.hypot(dx, dz)
  const angle = -Math.atan2(dz, dx)
  const geometry = useMemo(() => {
    return length < 0.01 ? null : createWallPreviewGeometry(length, preview.height)
  }, [length, preview.height])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) {
    return null
  }

  return (
    <group position={[preview.start[0], 0.02, preview.start[1]]} rotation={[0, angle, 0]}>
      <mesh
        // Pass geometry as a prop so the mesh never renders with R3F's
        // default empty `BufferGeometry`. With `frustumCulled={false}`,
        // the `<primitive attach="geometry">` path emits one frame of
        // `Draw(0, 1, 0, 0)` against an empty buffer and WebGPU flags it
        // (see wall-move-side-handles.tsx).
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        renderOrder={2}
      >
        <meshBasicMaterial
          color={preview.color}
          depthTest={false}
          depthWrite={false}
          opacity={0.32}
          side={DoubleSide}
          transparent
        />
      </mesh>
    </group>
  )
}

export const MoveWallTool: React.FC<{ node: WallNode }> = ({ node }) => {
  const meta =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew
  const hasDraggedRef = useRef(false)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const originalCenterRef = useRef<[number, number]>([
    (node.start[0] + node.end[0]) / 2,
    (node.start[1] + node.end[1]) / 2,
  ])
  const originalHalfVectorRef = useRef<[number, number]>([
    (node.end[0] - node.start[0]) / 2,
    (node.end[1] - node.start[1]) / 2,
  ])
  const moveAxisRef = useRef<WallMoveAxis | null>(
    getPerpendicularWallMoveAxis(node.start, node.end),
  )
  const linkedOriginalsRef = useRef<LinkedWallSnapshot[]>(
    isNew
      ? []
      : getLinkedWallSnapshots({
          wallId: node.id,
          wallParentId: node.parentId ?? null,
          originalStart: node.start,
          originalEnd: node.end,
        }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const nodeIdRef = useRef(node.id)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)
  const pendingRotationRef = useRef(0)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })
  const [ghostWallPreviews, setGhostWallPreviews] = useState<GhostWallPreview[]>([])

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const originalCenter = originalCenterRef.current
    const originalHalfVector = originalHalfVectorRef.current
    const levelId = node.parentId ?? null
    let shouldRestoreOnCleanup = true
    let active = true

    // Wall ids that currently carry a live position override. Cleared on commit
    // (after the final store write lands) and on cancel / external unmount.
    const touchedWallIds = new Set<AnyNodeId>()

    const applyNodePreview = (
      updates: Array<{ id: WallNode['id']; start: [number, number]; end: [number, number] }>,
    ) => {
      // Publish the preview to `useLiveNodeOverrides` rather than writing the
      // scene store. The 3D wall system (`getEffectiveWall`) and the 2D floor
      // plan (`wallFloorplanSiblingOverrides`) both merge these overrides, so
      // the mesh + miters track the cursor with NO `useScene` churn during the
      // drag. A store write would hand a fresh `nodes` reference to every
      // `useScene(s => s.nodes)` subscriber each frame (catalog tiles, panels,
      // selection) and rebuild them all. Mirrors the wall's own 2D drag pattern;
      // the final plan is written once, atomically, on commit.
      const overrides = useLiveNodeOverrides.getState()
      const sceneState = useScene.getState()
      overrides.setMany(
        updates.map(
          (entry) =>
            [entry.id, { start: entry.start, end: entry.end }] as [string, Record<string, unknown>],
        ),
      )
      for (const entry of updates) {
        touchedWallIds.add(entry.id as AnyNodeId)
        sceneState.markDirty(entry.id as AnyNodeId)
      }
    }

    // Live auto-slab / auto-ceiling preview: polygon overrides for the
    // surfaces the moving walls bound, so `GeometrySystem` / `CeilingSystem`
    // rebuild them through the `getEffectiveNode` merge while the store stays
    // at pre-drag values. Membership is read once here, so a tick costs a few
    // line intersections instead of a level-wide room detection. Surfaces a
    // new, merged or split room needs appear at commit.
    // The drag writes nothing to the store, so a new `nodes` reference means someone else
    // changed the scene (a collaborator, an agent): membership is read again from it.
    const movingWallIds = new Set([nodeId, ...linkedOriginalsRef.current.map((wall) => wall.id)])
    let followerNodes = useScene.getState().nodes
    let followSurfaces = levelId
      ? createWallBoundSurfaceFollower(levelId, followerNodes, movingWallIds)
      : null
    const touchedSurfaceIds = new Set<AnyNodeId>()

    const publishLiveSurfaceOverrides = (
      updates: Array<{ id: WallNode['id']; start: [number, number]; end: [number, number] }>,
      bridges: Array<{ start: [number, number]; end: [number, number] }>,
    ) => {
      if (!levelId) return
      const sceneState = useScene.getState()
      if (sceneState.nodes !== followerNodes) {
        followerNodes = sceneState.nodes
        followSurfaces = createWallBoundSurfaceFollower(levelId, followerNodes, movingWallIds)
      }
      const entries = followSurfaces!(new Map(updates.map((entry) => [entry.id, entry])), bridges)
      const followed = new Set(entries.map(([id]) => id))
      const overrides = useLiveNodeOverrides.getState()
      for (const id of touchedSurfaceIds) {
        if (followed.has(id)) continue
        overrides.clear(id)
        if (sceneState.nodes[id]) sceneState.markDirty(id)
        touchedSurfaceIds.delete(id)
      }
      if (entries.length === 0) return
      overrides.setMany(
        entries.map(([id, polygon]) => [id, { polygon }] as [string, Record<string, unknown>]),
      )
      for (const [id] of entries) {
        touchedSurfaceIds.add(id)
        sceneState.markDirty(id)
      }
    }

    const clearSurfaceOverrides = () => {
      const overrides = useLiveNodeOverrides.getState()
      const sceneState = useScene.getState()
      for (const id of touchedSurfaceIds) {
        overrides.clear(id)
        // A surface the commit deleted (rooms merged) has nothing left to rebuild.
        if (sceneState.nodes[id]) sceneState.markDirty(id)
      }
      touchedSurfaceIds.clear()
    }

    // Drop the wall position overrides and mark the walls dirty so they rebuild
    // from the now-authoritative store value (after commit) or the unchanged
    // pre-drag value (after cancel).
    const clearWallOverrides = () => {
      const overrides = useLiveNodeOverrides.getState()
      const sceneState = useScene.getState()
      for (const id of touchedWallIds) {
        overrides.clear(id)
        if (sceneState.nodes[id]) sceneState.markDirty(id)
      }
      touchedWallIds.clear()
    }

    const buildWallFromCenter = (center: [number, number]) => {
      const rotatedHalf = rotateVector(originalHalfVector, pendingRotationRef.current)
      const nextStart: [number, number] = [center[0] - rotatedHalf[0], center[1] - rotatedHalf[1]]
      const nextEnd: [number, number] = [center[0] + rotatedHalf[0], center[1] + rotatedHalf[1]]
      return { start: nextStart, end: nextEnd }
    }

    const getMovePlan = (nextStart: [number, number], nextEnd: [number, number]) =>
      planWallMoveJunctions(
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )

    const getLinkedPreviewUpdates = (
      plan: WallMoveJunctionPlan<LinkedWallSnapshot>,
      nextStart: [number, number],
      nextEnd: [number, number],
    ) => {
      const movedUpdates = getPlannedLinkedWallUpdates(
        plan,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )
      const movedById = new Map(movedUpdates.map((entry) => [entry.id, entry]))

      return linkedOriginalsRef.current.map(
        (wall) => movedById.get(wall.id) ?? { id: wall.id, start: wall.start, end: wall.end },
      )
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      const previous = previewRef.current ?? { start: originalStart, end: originalEnd }
      if (
        nextStart[0] === previous.start[0] &&
        nextStart[1] === previous.start[1] &&
        nextEnd[0] === previous.end[0] &&
        nextEnd[1] === previous.end[1]
      )
        return
      hasDraggedRef.current = true
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      const previewPlan = getMovePlan(nextStart, nextEnd)
      const previewUpdates = [
        { id: nodeId, start: nextStart, end: nextEnd },
        ...getLinkedPreviewUpdates(previewPlan, nextStart, nextEnd),
      ]
      const previewCollapsedWallIds = new Set([
        ...previewUpdates
          .filter((entry) => entry.id !== nodeId && !isSegmentLongEnough(entry.start, entry.end))
          .map((entry) => entry.id as AnyNodeId),
        ...previewPlan.wallsToDelete.map((wall) => wall.id as AnyNodeId),
      ])
      const previewSceneWalls = getWallsAfterUpdates(
        useScene.getState().nodes,
        previewUpdates.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { start: entry.start, end: entry.end },
        })),
      ).filter((wall) => !previewCollapsedWallIds.has(wall.id as AnyNodeId))
      const bridgePreviews = buildBridgeWallPreviews({
        bridgePlans: previewPlan.bridgePlans,
        nextStart,
        nextEnd,
        existingWalls: previewSceneWalls,
      })
      const nextGhostWalls = bridgePreviews.map((preview) => preview.ghost)
      setGhostWallPreviews(nextGhostWalls)
      applyNodePreview(previewUpdates)
      publishLiveSurfaceOverrides(
        previewUpdates,
        bridgePreviews.map(({ wall }) => ({ start: wall.start, end: wall.end })),
      )
    }

    const restoreOriginal = () => {
      setGhostWallPreviews([])
      // Nothing was written to the scene store during the drag — the preview
      // was override-driven — so dropping the wall + surface overrides reveals
      // the unchanged pre-drag state.
      clearWallOverrides()
      clearSurfaceOverrides()
    }

    const onGridMove = (event: GridEvent) => {
      if (!active) return
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      const snapStep = getSegmentGridStep()

      // Anchor at the raw cursor so the displacement is measured in
      // continuous space.
      const anchor = dragAnchorRef.current ?? [rawX, rawZ]
      const firstMove = dragAnchorRef.current === null
      dragAnchorRef.current = anchor
      // Seeding a controller grab is not movement; don't snap an off-grid wall
      // to the lattice before the user has moved their hand.
      if (firstMove) return

      const rawDeltaX = rawX - anchor[0]
      const rawDeltaZ = rawZ - anchor[1]
      if (!hasDraggedRef.current && Math.hypot(rawDeltaX, rawDeltaZ) < 1e-6) return

      // When the move is axis-locked (side-handle drag), snap the wall
      // center's absolute perpendicular offset to a multiple of
      // `snapStep`. For axis-aligned walls this puts the wall on grid
      // lines along its normal regardless of the wall's starting
      // position; for diagonal walls the wall steps in exact
      // `snapStep` increments along its normal.
      //
      // Why absolute (perp · centre) rather than `delta` snap: snapping
      // the displacement alone preserves any pre-existing off-grid
      // offset, so the wall could only ever sit at `originalCentre ±
      // k·snapStep` — never on actual grid lines. Snapping the wall's
      // own perpendicular coordinate fixes that.
      const axis = moveAxisRef.current
      let deltaX: number
      let deltaZ: number
      if (axis) {
        const originalProj = originalCenter[0] * axis[0] + originalCenter[1] * axis[1]
        const rawProj = originalProj + rawDeltaX * axis[0] + rawDeltaZ * axis[1]
        const snappedProj = snapScalarToGrid(rawProj, snapStep)
        const perpDelta = snappedProj - originalProj
        deltaX = axis[0] * perpDelta
        deltaZ = axis[1] * perpDelta
      } else {
        // Snap the resulting wall center to the WORLD XZ grid (projected
        // back into building-local), then express the result as a delta
        // from the original centre. Without this, a rotated building
        // dragged the wall along its local axes instead of world ones.
        const targetLocal: [number, number] = [
          originalCenter[0] + rawDeltaX,
          originalCenter[1] + rawDeltaZ,
        ]
        const snappedLocal = snapBuildingLocalToWorldGrid(targetLocal, snapStep)
        deltaX = snappedLocal[0] - originalCenter[0]
        deltaZ = snappedLocal[1] - originalCenter[1]
      }

      const constrainedGridPos: [number, number] = [anchor[0] + deltaX, anchor[1] + deltaZ]

      if (
        previousGridPosRef.current &&
        (constrainedGridPos[0] !== previousGridPosRef.current[0] ||
          constrainedGridPos[1] !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = constrainedGridPos

      const nextCenter: [number, number] = [originalCenter[0] + deltaX, originalCenter[1] + deltaZ]
      const nextWall = buildWallFromCenter(nextCenter)
      applyPreview(nextWall.start, nextWall.end)
    }

    const commitPreview = () => {
      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }

      shouldRestoreOnCleanup = false
      setGhostWallPreviews([])

      const commitPlan = getMovePlan(preview.start, preview.end)
      const linkedWallUpdates = getPlannedLinkedWallUpdates(
        commitPlan,
        originalStart,
        originalEnd,
        preview.start,
        preview.end,
      )
      const collapsedLinkedWallIds = new Set([
        ...linkedWallUpdates
          .filter((entry) => !isSegmentLongEnough(entry.start, entry.end))
          .map((entry) => entry.id as AnyNodeId),
        ...commitPlan.wallsToDelete.map((wall) => wall.id as AnyNodeId),
      ])

      const commitUpdates: Array<{ id: AnyNodeId; data: Partial<WallNode> }> = [
        {
          id: nodeId as AnyNodeId,
          data: isNew
            ? {
                start: preview.start,
                end: preview.end,
                metadata: stripWallIsNewMetadata(node.metadata),
              }
            : { start: preview.start, end: preview.end },
        },
        ...linkedWallUpdates
          .filter((entry) => !collapsedLinkedWallIds.has(entry.id as AnyNodeId))
          .map((entry) => ({
            id: entry.id as AnyNodeId,
            data: { start: entry.start, end: entry.end },
          })),
      ]
      const sceneState = useScene.getState()
      const existingWalls = getWallsAfterUpdates(sceneState.nodes, commitUpdates).filter(
        (wall) => !collapsedLinkedWallIds.has(wall.id as AnyNodeId),
      )
      const bridgeCreates = buildBridgeWallCreates({
        bridgePlans: commitPlan.bridgePlans,
        nextStart: preview.start,
        nextEnd: preview.end,
        existingWalls,
        wallCount: Object.values(sceneState.nodes).filter((entry) => entry?.type === 'wall').length,
      })

      // Elect each moved wall's support from its final line (keeping its current
      // slab while that still carries it) and put any change in the same batch,
      // so the live sync reconciles the drop in one pass.
      const withSupport = <T extends WallNode>(wall: T): Partial<WallNode> => {
        const patch = resolveMovedWallSupportSlabPatch(wall, sceneState.nodes)
        return patch.supportSlabId === wall.supportSlabId ? {} : patch
      }
      const wallUpdates = commitUpdates.map((entry) => ({
        id: entry.id,
        data: {
          ...entry.data,
          ...withSupport({ ...(sceneState.nodes[entry.id] as WallNode), ...entry.data }),
        } as Partial<AnyNode>,
      }))
      const wallCreates = bridgeCreates.map((entry) => ({
        ...entry,
        node: {
          ...entry.node,
          ...withSupport({ ...entry.node, parentId: entry.parentId ?? null }),
        } as WallNode,
      }))

      // One history step, one write. The live space-detection sync reconciles
      // sides, zones, slabs and ceilings inside it (once, incrementally), and
      // its derived writes join the step.
      // The drag writes nothing to the store (the preview is live overrides), so history is
      // paused only for this drop. Keyed by the moving wall: in split view the 2D move overlay
      // co-owns the gesture, and commitStep lifts its pause too.
      const drop = beginSceneHistoryPauseSession(useScene, { gesture: nodeId })
      try {
        drop.commitStep(() =>
          useScene.getState().applyNodeChanges({
            update: wallUpdates,
            create: wallCreates,
            delete: Array.from(collapsedLinkedWallIds),
          }),
        )
      } finally {
        drop.end()
      }
      clearSurfaceOverrides()
      clearWallOverrides()

      // Claim teardown ownership so the 2D overlay's cleanup skips its
      // own revert when split-view has both mounted — see
      // `movingNodeOrigin` in `use-editor.tsx`.
      useEditor.getState().setMovingNodeOrigin('3d')

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
    }

    const onPointerUp = () => {
      if (!active) return
      active = false
      // Press-release without drag: dismiss the tool without committing.
      // This is the same UX as MoveWallEndpointTool / WallHeightArrowHandle
      // — pointer-down on the affordance starts the move, drag updates the
      // preview, release commits if the cursor actually moved.
      if (!hasDraggedRef.current) {
        useViewer.getState().setSelection({ selectedIds: [nodeId] })
        exitMoveMode()
        return
      }
      commitPreview()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta === 0) {
        return
      }

      event.preventDefault()
      pendingRotationRef.current += rotationDelta
      triggerSFX('sfx:item-rotate')

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }
      const currentCenter: [number, number] = [
        (preview.start[0] + preview.end[0]) / 2,
        (preview.start[1] + preview.end[1]) / 2,
      ]
      const nextWall = buildWallFromCenter(currentCenter)
      moveAxisRef.current = getPerpendicularWallMoveAxis(nextWall.start, nextWall.end)
      applyPreview(nextWall.start, nextWall.end)
    }

    const onCancel = () => {
      if (!active) return
      active = false
      shouldRestoreOnCleanup = false
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      markToolCancelConsumed()
      // Claim teardown ownership so the 2D overlay doesn't redundantly
      // revert the same baseline on its own cleanup.
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      if (shouldRestoreOnCleanup) {
        // `shouldRestoreOnCleanup` is only true if neither `onPointerUp`
        // (commit branch) nor `onCancel` ran — i.e., the unmount came
        // from outside (typically the 2D overlay finalising in split
        // view). The origin flag tells us whether the 2D side committed
        // (skip restore — its write is the live state) or the unmount
        // has no claimed owner (restore to baseline).
        const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'
        if (!finalisedBy2D) {
          restoreOriginal()
        }
      }
      emitter.off('grid:move', onGridMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [exitMoveMode, isNew, node.metadata, node.parentId])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
      {ghostWallPreviews.map((preview) => (
        <GhostWallPreviewMesh key={preview.id} preview={preview} />
      ))}
    </group>
  )
}

export default MoveWallTool
