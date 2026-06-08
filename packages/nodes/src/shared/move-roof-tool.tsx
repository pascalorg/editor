import {
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  type RoofNode,
  type RoofSegmentNode,
  resolveAlignment,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearRoofDuplicateMetadata,
  snapFenceDraftPoint,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

/** Figma-style alignment-snap threshold (meters), matching the other tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

export const MoveRoofTool: React.FC<{
  node: RoofNode | RoofSegmentNode | StairNode | StairSegmentNode
}> = ({ node: movingNode }) => {
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previousGridPosRef = useRef<[number, number] | null>(null)

  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>(() => {
    const obj = sceneRegistry.nodes.get(movingNode.id)
    if (obj) {
      const worldPos = obj.getWorldPosition(new THREE.Vector3())
      // Cursor renders inside the building-local ToolManager group, so convert
      // world → building-local to honor any building rotation.
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
      if (buildingObj) buildingObj.worldToLocal(worldPos)
      return [worldPos.x, worldPos.y, worldPos.z]
    }
    // Fallback if not registered (e.g. newly created duplicate without mesh yet)
    if (
      (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
      movingNode.parentId
    ) {
      const parentNode = useScene.getState().nodes[movingNode.parentId as AnyNodeId]
      if (parentNode && 'position' in parentNode && 'rotation' in parentNode) {
        const parentAngle = parentNode.rotation as number
        const px = parentNode.position[0] as number
        const py = parentNode.position[1] as number
        const pz = parentNode.position[2] as number
        const lx = movingNode.position[0]
        const ly = movingNode.position[1]
        const lz = movingNode.position[2]

        const wx = lx * Math.cos(parentAngle) - lz * Math.sin(parentAngle) + px
        const wz = lx * Math.sin(parentAngle) + lz * Math.cos(parentAngle) + pz
        return [wx, py + ly, wz]
      }
    }
    return [movingNode.position[0], movingNode.position[1], movingNode.position[2]]
  })

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingNode.metadata === 'object' && movingNode.metadata !== null
        ? (movingNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew
    const committedMeta: RoofNode['metadata'] = (() => {
      if (
        typeof movingNode.metadata !== 'object' ||
        movingNode.metadata === null ||
        Array.isArray(movingNode.metadata)
      ) {
        return movingNode.metadata
      }

      const nextMeta = { ...movingNode.metadata } as Record<string, unknown>
      delete nextMeta.isNew
      delete nextMeta.isTransient
      return nextMeta as RoofNode['metadata']
    })()

    const original = {
      position: [...movingNode.position] as [number, number, number],
      rotation: movingNode.rotation,
      parentId: movingNode.parentId,
      metadata: movingNode.metadata,
    }

    // Track whether the move was committed so cleanup knows whether to revert.
    // We avoid setting isTransient on the store to prevent RoofSystem from
    // resetting the mesh position (it resets on dirty) and from triggering
    // expensive merged-mesh CSG rebuilds on every frame.
    let wasCommitted = false
    let wasCancelled = false

    // Track pending rotation — no store updates during drag
    let pendingRotation: number = movingNode.rotation as number

    // For roof-segment moves: the selection was cleared before entering move mode,
    // so isSelected=false on the parent roof, hiding individual segment meshes and
    // showing only the merged mesh. We directly flip Three.js visibility so the
    // user sees the individual segment tracking the cursor.
    let segmentWrapperGroup: THREE.Object3D | null = null
    let mergedRoofMesh: THREE.Object3D | null = null
    if (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') {
      const segmentMesh = sceneRegistry.nodes.get(movingNode.id)
      if (segmentMesh?.parent) {
        // segmentMesh.parent = <group visible={isSelected}> wrapper in Roof/StairRenderer
        // segmentMesh.parent.parent = the registered roof/stair group
        segmentWrapperGroup = segmentMesh.parent
        const mergedName = movingNode.type === 'stair-segment' ? 'merged-stair' : 'merged-roof'
        mergedRoofMesh = segmentMesh.parent.parent?.getObjectByName(mergedName) ?? null
        segmentWrapperGroup.visible = true
        if (mergedRoofMesh) mergedRoofMesh.visible = false
      }
    }

    const resolveLevelId = () => {
      if (movingNode.type === 'roof' || movingNode.type === 'stair') {
        return movingNode.parentId ?? null
      }

      if (
        (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
        movingNode.parentId
      ) {
        const parentNode = useScene.getState().nodes[movingNode.parentId as AnyNodeId]
        return parentNode && 'parentId' in parentNode ? (parentNode.parentId ?? null) : null
      }

      return null
    }

    const levelId = resolveLevelId()
    const levelNode =
      levelId && useScene.getState().nodes[levelId as AnyNodeId]?.type === 'level'
        ? (useScene.getState().nodes[levelId as AnyNodeId] as LevelNode)
        : null
    const levelChildren = levelNode?.children ?? []
    const levelWalls = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((node): node is WallNode => node?.type === 'wall')
    const levelFences = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((node): node is FenceNode => node?.type === 'fence')
    const buildingId = useViewer.getState().selection.buildingId
    const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null

    // Alignment for top-level stair / roof only. Segments live in parent-local
    // space (a different frame from the building-local candidate pool / guide
    // layer), so we leave them on the plain grid+corner snap. The moving node
    // is aligned by its ORIGIN point (how this tool positions it), snapped to
    // any other alignable object's anchors.
    const alignTopLevel = movingNode.type === 'stair' || movingNode.type === 'roof'
    const alignmentCandidates = alignTopLevel
      ? collectAlignmentAnchors(useScene.getState().nodes, movingNode.id)
      : []
    const alignLocalPoint = (lx: number, lz: number, bypass: boolean): [number, number] => {
      if (!alignTopLevel || bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [lx, lz]
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: movingNode.id, kind: 'corner', x: lx, z: lz }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      useAlignmentGuides.getState().set(ar.guides)
      return ar.snap ? [lx + ar.snap.dx, lz + ar.snap.dz] : [lx, lz]
    }

    const localToWorldPoint = (localPoint: WallPlanPoint, y: number): [number, number, number] => {
      if (buildingObj) {
        const worldPoint = buildingObj.localToWorld(
          new THREE.Vector3(localPoint[0], y, localPoint[1]),
        )
        return [worldPoint.x, worldPoint.y, worldPoint.z]
      }

      return [localPoint[0], y, localPoint[1]]
    }

    const computeLocal = (
      gridX: number,
      gridZ: number,
      y: number,
      buildingLocalX: number,
      buildingLocalZ: number,
    ): [number, number] => {
      // Segments have a transformed parent (stair/roof). Convert world → parent-local
      // via Three.js hierarchy so the segment's stored position stays parent-relative.
      if (
        (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
        movingNode.parentId
      ) {
        const parentNode = useScene.getState().nodes[movingNode.parentId as AnyNodeId]
        if (parentNode && 'position' in parentNode && 'rotation' in parentNode) {
          const parentObj = sceneRegistry.nodes.get(movingNode.parentId)
          if (parentObj) {
            const worldVec = new THREE.Vector3(gridX, y, gridZ)
            parentObj.worldToLocal(worldVec)
            return [worldVec.x, worldVec.z]
          }
          const dx = gridX - (parentNode.position[0] as number)
          const dz = gridZ - (parentNode.position[2] as number)
          const angle = -(parentNode.rotation as number)
          return [
            dx * Math.cos(angle) - dz * Math.sin(angle),
            dx * Math.sin(angle) + dz * Math.cos(angle),
          ]
        }
      }

      // Stair/roof live directly in the level — their stored position is building-local.
      // event.localPosition is already building-local, so using it handles building rotation.
      return [buildingLocalX, buildingLocalZ]
    }

    const onGridMove = (event: GridEvent) => {
      const y = event.position[1]

      const snappedLocal = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
      })
      // Layer alignment snap on top (top-level stair/roof). Recompute the
      // world point from the aligned building-local point so it stays correct
      // under building rotation.
      const [lx, lz] = alignLocalPoint(
        snappedLocal[0],
        snappedLocal[1],
        event.nativeEvent?.altKey === true,
      )
      const [gridX, , gridZ] = localToWorldPoint([lx, lz], y)

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
      setCursorWorldPos([lx, event.localPosition[1], lz])

      const [localX, localZ] = computeLocal(gridX, gridZ, y, lx, lz)

      // Directly update the Three.js mesh — no store update during drag
      const mesh = sceneRegistry.nodes.get(movingNode.id)
      if (mesh) {
        mesh.position.x = localX
        mesh.position.z = localZ
      }

      // Publish world-space position so the 2D floorplan can track the drag
      useLiveTransforms.getState().set(movingNode.id, {
        position: [gridX, y, gridZ],
        rotation: pendingRotation,
      })
    }

    const onGridClick = (event: GridEvent) => {
      const y = event.position[1]
      const snappedLocal = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
      })
      const [lx, lz] = alignLocalPoint(
        snappedLocal[0],
        snappedLocal[1],
        event.nativeEvent?.altKey === true,
      )
      const [gridX, , gridZ] = localToWorldPoint([lx, lz], y)

      const [localX, localZ] = computeLocal(gridX, gridZ, y, lx, lz)

      useAlignmentGuides.getState().clear()
      wasCommitted = true

      // The store still holds the original values (we didn't update during drag).
      // Resume temporal and apply the final state as a single undoable step.
      useScene.temporal.getState().resume()

      if (isNew && movingNode.type === 'roof') {
        clearRoofDuplicateMetadata(movingNode.id as AnyNodeId, {
          position: [localX, movingNode.position[1], localZ],
          rotation: pendingRotation,
          metadata: committedMeta,
        })
      } else {
        useScene.getState().updateNode(movingNode.id, {
          position: [localX, movingNode.position[1], localZ],
          rotation: pendingRotation,
          metadata: committedMeta,
        })
      }

      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [movingNode.id] })
      useLiveTransforms.getState().clear(movingNode.id)
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      wasCancelled = true
      useLiveTransforms.getState().clear(movingNode.id)
      useAlignmentGuides.getState().clear()
      if (isNew) {
        useScene.getState().deleteNode(movingNode.id)
      } else {
        useScene.getState().updateNode(movingNode.id, {
          position: original.position,
          rotation: original.rotation,
          metadata: original.metadata,
        })
      }
      useScene.temporal.getState().resume()
      exitMoveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        triggerSFX('sfx:item-rotate')

        pendingRotation += rotationDelta

        // Directly update the Three.js mesh — no store update during drag
        const mesh = sceneRegistry.nodes.get(movingNode.id)
        if (mesh) mesh.rotation.y = pendingRotation

        // Update live transform rotation for 2D floorplan
        const currentLive = useLiveTransforms.getState().get(movingNode.id)
        if (currentLive) {
          useLiveTransforms.getState().set(movingNode.id, {
            ...currentLive,
            rotation: pendingRotation,
          })
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      // Restore segment wrapper visibility (React will re-sync on next render)
      if (segmentWrapperGroup) segmentWrapperGroup.visible = false
      if (mergedRoofMesh) mergedRoofMesh.visible = true

      // Clear ephemeral live transform + any alignment guides
      useLiveTransforms.getState().clear(movingNode.id)
      useAlignmentGuides.getState().clear()

      // Skip restore when the 2D floor-plan overlay claimed teardown
      // ownership — same contract `FloorplanRegistryMoveOverlay` uses to
      // decide whether to revert its own apply() writes. Without this,
      // a stair / roof move committed in the floor plan unmounts this
      // tool with `wasCommitted === false` (this tool's own grid-click
      // never fired), and the restore below stomps the just-committed
      // position back to the snapshot.
      const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'

      if (!(wasCommitted || wasCancelled || isNew || finalisedBy2D)) {
        useScene.getState().updateNode(movingNode.id, {
          position: original.position,
          rotation: original.rotation,
          metadata: original.metadata,
        })
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [movingNode, exitMoveMode])

  return (
    <group>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
    </group>
  )
}

export default MoveRoofTool
