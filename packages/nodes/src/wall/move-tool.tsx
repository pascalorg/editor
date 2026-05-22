'use client'

import {
  type AnyNodeId,
  constrainWallMoveDeltaToAxis,
  detectSpacesForLevel,
  emitter,
  type GridEvent,
  getPerpendicularWallMoveAxis,
  getPlannedLinkedWallUpdates,
  pauseSceneHistory,
  planAutoSlabsForLevel,
  planWallMoveJunctions,
  resumeSceneHistory,
  type SlabNode,
  useScene,
  type WallMoveAxis,
  type WallMoveJunctionPlan,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  getWallGridStep,
  isWallLongEnough,
  markToolCancelConsumed,
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
 *  - **Auto-slab live preview** — `planAutoSlabsForLevel` runs every
 *    tick so room slabs adapt to the new wall layout in real time.
 *  - **Single-undo dance** — paused history during drag, restore +
 *    resume + reapply on commit so one Ctrl-Z rolls back the whole
 *    operation.
 *  - **`isNew` metadata strip** — first commit after a fresh wall
 *    placement clears the placement marker.
 *  - **Activation grace** (150ms) + Shift to bypass grid snap.
 *
 * Mounted via `def.affordanceTools.move` from `wall/definition.ts`.
 */
function rotateVector([x, z]: [number, number], angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - z * sin, x * sin + z * cos]
}

function cloneSlabSnapshot(slab: SlabNode): SlabNode {
  return {
    ...slab,
    polygon: slab.polygon.map(([x, z]) => [x, z] as [number, number]),
    holes: slab.holes.map((hole) => hole.map(([x, z]) => [x, z] as [number, number])),
    holeMetadata: slab.holeMetadata.map((metadata) => ({ ...metadata })),
  }
}

function getLevelSlabs(levelId: string, nodes: ReturnType<typeof useScene.getState>['nodes']) {
  return Object.values(nodes).filter(
    (entry): entry is SlabNode => entry?.type === 'slab' && (entry.parentId ?? null) === levelId,
  )
}

function getLevelAutoSlabs(levelId: string, nodes: ReturnType<typeof useScene.getState>['nodes']) {
  return getLevelSlabs(levelId, nodes).filter((slab) => slab.autoFromWalls)
}

function getLevelAutoSlabSnapshots(levelId: string) {
  return getLevelAutoSlabs(levelId, useScene.getState().nodes).map(cloneSlabSnapshot)
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
  const activatedAtRef = useRef<number>(Date.now())
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
  const originalAutoSlabsRef = useRef<SlabNode[]>(
    node.parentId ? getLevelAutoSlabSnapshots(node.parentId) : [],
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const nodeIdRef = useRef(node.id)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)
  const pendingRotationRef = useRef(0)
  const shiftPressedRef = useRef(false)

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
    const originalAutoSlabs = originalAutoSlabsRef.current

    pauseSceneHistory(useScene)
    let shouldRestoreOnCleanup = true

    const applyNodePreview = (
      updates: Array<{ id: WallNode['id']; start: [number, number]; end: [number, number] }>,
    ) => {
      useScene.getState().updateNodes(
        updates.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { start: entry.start, end: entry.end },
        })),
      )
      for (const entry of updates) {
        useScene.getState().markDirty(entry.id as AnyNodeId)
      }
    }

    const applyLiveAutoSlabPreview = (walls: WallNode[]) => {
      if (!levelId) {
        return
      }

      const levelWalls = walls.filter((wall) => (wall.parentId ?? null) === levelId)
      const sceneState = useScene.getState()
      const { roomPolygons } = detectSpacesForLevel(levelId, levelWalls)
      const slabPlan = planAutoSlabsForLevel(roomPolygons, getLevelSlabs(levelId, sceneState.nodes))

      if (
        slabPlan.create.length === 0 &&
        slabPlan.update.length === 0 &&
        slabPlan.delete.length === 0
      ) {
        return
      }

      sceneState.applyNodeChanges({
        update: slabPlan.update.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: entry.data,
        })),
        create: slabPlan.create.map((slab) => ({
          node: slab,
          parentId: levelId as AnyNodeId,
        })),
        delete: slabPlan.delete.map((id) => id as AnyNodeId),
      })
    }

    const restoreAutoSlabPreview = () => {
      if (!levelId) {
        return
      }

      const sceneState = useScene.getState()
      const originalIds = new Set(originalAutoSlabs.map((slab) => slab.id))
      const currentAutoSlabs = getLevelAutoSlabs(levelId, sceneState.nodes)
      const update = originalAutoSlabs
        .filter((slab) => sceneState.nodes[slab.id as AnyNodeId])
        .map((slab) => ({
          id: slab.id as AnyNodeId,
          data: cloneSlabSnapshot(slab),
        }))
      const create = originalAutoSlabs
        .filter((slab) => !sceneState.nodes[slab.id as AnyNodeId])
        .map((slab) => ({
          node: cloneSlabSnapshot(slab),
          parentId: levelId as AnyNodeId,
        }))
      const deleteIds = currentAutoSlabs
        .filter((slab) => !originalIds.has(slab.id))
        .map((slab) => slab.id as AnyNodeId)

      if (update.length === 0 && create.length === 0 && deleteIds.length === 0) {
        return
      }

      sceneState.applyNodeChanges({
        update,
        create,
        delete: deleteIds,
      })
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
          .filter((entry) => entry.id !== nodeId && !isWallLongEnough(entry.start, entry.end))
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
      const virtualBridgeWalls = bridgePreviews.map((preview) => preview.wall)
      setGhostWallPreviews(nextGhostWalls)
      applyNodePreview(previewUpdates)
      applyLiveAutoSlabPreview([...previewSceneWalls, ...virtualBridgeWalls])
    }

    const restoreOriginal = () => {
      setGhostWallPreviews([])
      applyNodePreview([
        { id: nodeId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])
      restoreAutoSlabPreview()
    }

    const onGridMove = (event: GridEvent) => {
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      const snapStep = getWallGridStep()
      const localX = shiftPressedRef.current ? rawX : snapScalarToGrid(rawX, snapStep)
      const localZ = shiftPressedRef.current ? rawZ : snapScalarToGrid(rawZ, snapStep)

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const [deltaX, deltaZ] = constrainWallMoveDeltaToAxis(
        localX - anchor[0],
        localZ - anchor[1],
        moveAxisRef.current,
      )
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

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }

      shouldRestoreOnCleanup = false

      // Restore original baseline while paused so the next resume+update
      // registers as a single tracked change (undo reverts to original).
      setGhostWallPreviews([])
      applyNodePreview([
        { id: nodeId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])
      restoreAutoSlabPreview()

      resumeSceneHistory(useScene)
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
          .filter((entry) => !isWallLongEnough(entry.start, entry.end))
          .map((entry) => entry.id as AnyNodeId),
        ...commitPlan.wallsToDelete.map((wall) => wall.id as AnyNodeId),
      ])

      const commitUpdates = [
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
      sceneState.applyNodeChanges({
        update: commitUpdates,
        create: bridgeCreates,
        delete: Array.from(collapsedLinkedWallIds),
      })

      pauseSceneHistory(useScene)

      // Claim teardown ownership so the 2D overlay's cleanup skips its
      // own revert when split-view has both mounted — see
      // `movingNodeOrigin` in `use-editor.tsx`.
      useEditor.getState().setMovingNodeOrigin('3d')

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'Shift') {
        shiftPressedRef.current = true
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

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = false
      }
    }

    const onCancel = () => {
      shouldRestoreOnCleanup = false
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      // Claim teardown ownership so the 2D overlay doesn't redundantly
      // revert the same baseline on its own cleanup.
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      if (shouldRestoreOnCleanup) {
        // `shouldRestoreOnCleanup` is only true if neither `onGridClick`
        // nor `onCancel` ran in this tool — i.e., the unmount came from
        // outside (typically the 2D overlay finalising in split view).
        // The origin flag tells us whether the 2D side committed (skip
        // restore — its write is the live state) or the unmount has no
        // claimed owner (restore to baseline).
        const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'
        if (!finalisedBy2D) {
          restoreOriginal()
        }
      }
      shiftPressedRef.current = false
      resumeSceneHistory(useScene)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
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
