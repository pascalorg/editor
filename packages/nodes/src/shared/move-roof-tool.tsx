import {
  type AnyNodeId,
  collectAlignmentAnchors,
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  movingAlignmentAnchors,
  nodeRegistry,
  type RoofNode,
  type RoofSegmentNode,
  resolveAlignment,
  type StairNode,
  type StairSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  commitFreshPlacementSubtree,
  consumePlacementDragRelease,
  DragBoundingBox,
  getFloorStackPreviewPosition,
  isMagneticSnapActive,
  resolvePlanarCursorPosition,
  snapFenceDraftPoint,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFreshPlacementVisibility,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

/** Figma-style alignment-snap threshold (meters), matching the other tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

function disableRaycastDuringDrag(root: THREE.Object3D | undefined): () => void {
  if (!root) return () => {}

  const originals: Array<[THREE.Object3D, THREE.Object3D['raycast']]> = []
  root.traverse((child) => {
    originals.push([child, child.raycast])
    child.raycast = () => {}
  })

  return () => {
    for (const [child, raycast] of originals) {
      child.raycast = raycast
    }
  }
}

function resolvePreviewRotationY(
  node: RoofNode | RoofSegmentNode | StairNode | StairSegmentNode,
  localRotation: number,
): number {
  if ((node.type === 'roof-segment' || node.type === 'stair-segment') && node.parentId) {
    const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
    const parentRotation =
      parentNode && 'rotation' in parentNode && typeof parentNode.rotation === 'number'
        ? parentNode.rotation
        : 0
    return parentRotation + localRotation
  }

  return localRotation
}

export const MoveRoofTool: React.FC<{
  node: RoofNode | RoofSegmentNode | StairNode | StairSegmentNode
}> = ({ node: movingNode }) => {
  const {
    isFreshPlacement,
    previewVisible: cursorVisible,
    revealFreshPlacement,
    useAbsoluteCursorPlacement,
  } = useFreshPlacementVisibility({
    node: movingNode,
    enabled: movingNode.type === 'roof' || movingNode.type === 'stair',
  })
  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  const previousGridPosRef = useRef<[number, number] | null>(null)
  const dragAnchorRef = useRef<[number, number] | null>(null)

  const [previewRotation, setPreviewRotation] = useState<number>(() =>
    resolvePreviewRotationY(movingNode, movingNode.rotation as number),
  )
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
    dragAnchorRef.current = null
    previousGridPosRef.current = null

    const isNew = isFreshPlacement
    const committedMeta = stripPlacementMetadataFlags(movingNode.metadata) as RoofNode['metadata']

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
    let hasMoved = false

    // Track pending rotation — no store updates during drag
    let pendingRotation: number = movingNode.rotation as number
    let lastLocalPosition: [number, number, number] = [
      movingNode.position[0],
      movingNode.position[1],
      movingNode.position[2],
    ]
    const movingObject = sceneRegistry.nodes.get(movingNode.id)
    const restoreRaycasts = disableRaycastDuringDrag(movingObject)

    const syncHostedPreview = (
      patch: Pick<RoofSegmentNode | StairSegmentNode, 'position' | 'rotation'>,
    ) => {
      if (movingNode.type !== 'roof-segment' && movingNode.type !== 'stair-segment') return
      useLiveNodeOverrides.getState().set(movingNode.id, patch as Record<string, unknown>)
    }

    const clearHostedPreview = () => {
      if (movingNode.type !== 'roof-segment' && movingNode.type !== 'stair-segment') return
      useLiveNodeOverrides.getState().clear(movingNode.id)
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
    const isFloorPlaced = nodeRegistry.get(movingNode.type)?.capabilities?.floorPlaced !== undefined
    const getPreviewPosition = (
      position: [number, number, number],
      rotation = pendingRotation,
    ): [number, number, number] => {
      if (!isFloorPlaced) return position
      return getFloorStackPreviewPosition({
        node: movingNode,
        position,
        rotation,
        levelId,
        nodes: useScene.getState().nodes,
      })
    }
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
    // layer), so we leave them on the plain grid+corner snap. Both stair and
    // roof align by their footprint bounding-box corners.
    const alignTopLevel = movingNode.type === 'stair' || movingNode.type === 'roof'
    const alignmentCandidates = alignTopLevel
      ? collectAlignmentAnchors(
          useScene.getState().nodes,
          movingNode.id,
          movingNode.type === 'stair' ? levelId : undefined,
        )
      : []
    const alignLocalPoint = (lx: number, lz: number, bypass: boolean): [number, number] => {
      if (!alignTopLevel || bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [lx, lz]
      }
      const moving =
        movingNode.type === 'stair' || movingNode.type === 'roof'
          ? movingAlignmentAnchors(movingNode, useScene.getState().nodes, lx, lz, pendingRotation)
          : []
      const ar = resolveAlignment({
        moving:
          moving.length > 0 ? moving : [{ nodeId: movingNode.id, kind: 'corner', x: lx, z: lz }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      useAlignmentGuides.getState().set(ar.guides)
      return ar.snap && isMagneticSnapActive() ? [lx + ar.snap.dx, lz + ar.snap.dz] : [lx, lz]
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

    const localPositionToToolLocal = (
      position: [number, number, number],
    ): [number, number, number] => {
      if (
        (movingNode.type === 'roof-segment' || movingNode.type === 'stair-segment') &&
        movingNode.parentId
      ) {
        const parentObj = sceneRegistry.nodes.get(movingNode.parentId)
        if (parentObj) {
          const point = parentObj.localToWorld(new THREE.Vector3(...position))
          if (buildingObj) buildingObj.worldToLocal(point)
          return [point.x, point.y, point.z]
        }
      }

      return position
    }

    const onGridMove = (event: GridEvent) => {
      hasMoved = true
      revealFreshPlacement()

      const y = event.position[1]

      const roofBypassSnap = event.nativeEvent?.shiftKey === true
      const snappedLocal = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
        bypassSnap: roofBypassSnap,
        magnetic: !roofBypassSnap && isMagneticSnapActive(),
      })
      const [rawGridX, , rawGridZ] = localToWorldPoint(snappedLocal, y)
      const [rawLocalX, rawLocalZ] = computeLocal(
        rawGridX,
        rawGridZ,
        y,
        snappedLocal[0],
        snappedLocal[1],
      )
      const resolved = resolvePlanarCursorPosition({
        cursor: [rawLocalX, rawLocalZ],
        original: [movingNode.position[0], movingNode.position[2]],
        anchor: dragAnchorRef.current,
        mode: useAbsoluteCursorPlacement ? 'absolute' : 'relative',
      })
      dragAnchorRef.current = resolved.anchor
      let [localX, localZ] = resolved.point

      if (alignTopLevel) {
        const aligned = alignLocalPoint(
          localX,
          localZ,
          event.nativeEvent?.altKey === true || event.nativeEvent?.shiftKey === true,
        )
        localX = aligned[0]
        localZ = aligned[1]
      }

      if (
        event.nativeEvent?.shiftKey !== true &&
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }

      previousGridPosRef.current = [localX, localZ]

      lastLocalPosition = [localX, movingNode.position[1], localZ]
      const previewPosition = getPreviewPosition(lastLocalPosition)
      setCursorWorldPos(
        isFloorPlaced ? previewPosition : localPositionToToolLocal(lastLocalPosition),
      )

      // Directly update the Three.js mesh — no store update during drag
      const mesh = sceneRegistry.nodes.get(movingNode.id)
      if (mesh) {
        if (isFloorPlaced) {
          mesh.position.set(...previewPosition)
        } else {
          mesh.position.x = localX
          mesh.position.z = localZ
        }
      }

      // Publish canonical position so the 2D floorplan can track the drag.
      // Floor-placed parents (stairs) stay in their committed local frame;
      // the lifted Y remains presentation-only in the 3D view.
      useLiveTransforms.getState().set(movingNode.id, {
        position: lastLocalPosition,
        rotation: pendingRotation,
      })
      syncHostedPreview({
        position: lastLocalPosition,
        rotation: pendingRotation,
      })
    }

    const onGridClick = (event: GridEvent) => {
      if (wasCommitted) return
      if (!hasMoved) return
      const [localX, , localZ] = lastLocalPosition

      useAlignmentGuides.getState().clear()
      wasCommitted = true

      let committedId = movingNode.id as AnyNodeId
      if (isNew) {
        committedId =
          commitFreshPlacementSubtree(movingNode.id as AnyNodeId, {
            position: [localX, movingNode.position[1], localZ],
            rotation: pendingRotation,
            metadata: committedMeta,
            visible: true,
          }) ?? committedId
      } else {
        // The store still holds the original values (we didn't update during drag).
        // Resume temporal and apply the final state as a single undoable step.
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(movingNode.id, {
          position: [localX, movingNode.position[1], localZ],
          rotation: pendingRotation,
          metadata: committedMeta,
        })
        useScene.temporal.getState().pause()
      }

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [committedId] })
      clearHostedPreview()
      useLiveTransforms.getState().clear(movingNode.id)
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      onGridClick({ nativeEvent: event } as unknown as GridEvent)
    }

    const onCancel = () => {
      wasCancelled = true
      clearHostedPreview()
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
        setPreviewRotation(resolvePreviewRotationY(movingNode, pendingRotation))

        // Directly update the Three.js mesh — no store update during drag
        const mesh = sceneRegistry.nodes.get(movingNode.id)
        if (mesh) {
          mesh.rotation.y = pendingRotation
          if (isFloorPlaced) {
            const previewPosition = getPreviewPosition(lastLocalPosition, pendingRotation)
            mesh.position.set(...previewPosition)
            setCursorWorldPos(previewPosition)
          }
        }

        // Update live transform rotation for 2D floorplan
        const currentLive = useLiveTransforms.getState().get(movingNode.id)
        if (currentLive) {
          useLiveTransforms.getState().set(movingNode.id, {
            ...currentLive,
            rotation: pendingRotation,
          })
        }
        syncHostedPreview({
          position: lastLocalPosition,
          rotation: pendingRotation,
        })
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      restoreRaycasts()

      // Clear ephemeral live transform + any alignment guides
      clearHostedPreview()
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
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [movingNode, exitMoveMode, isFreshPlacement, revealFreshPlacement, useAbsoluteCursorPlacement])

  // Show the same green drag box for both top-level roofs/stairs and their
  // segments. Segment cursor positions are converted into the tool's
  // building-local frame above, so the box can now ride the cursor correctly.
  const showBoundingBox =
    movingNode.type === 'stair' ||
    movingNode.type === 'roof' ||
    movingNode.type === 'roof-segment' ||
    movingNode.type === 'stair-segment'

  return (
    <group visible={cursorVisible}>
      <CursorSphere position={cursorWorldPos} showTooltip={false} />
      {showBoundingBox && (
        <DragBoundingBox
          nodeId={movingNode.id}
          position={cursorWorldPos}
          rotationY={previewRotation}
        />
      )}
    </group>
  )
}

export default MoveRoofTool
