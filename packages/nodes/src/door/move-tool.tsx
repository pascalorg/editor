import {
  type AnyNodeId,
  clampRectToRoofWallFace,
  collectAlignmentAnchors,
  DoorNode,
  emitter,
  isCurvedWall,
  type RoofEvent,
  type RoofNode,
  roofFacePointToSegment,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  hasRoofFaceChildOverlap,
  isValidWallSideFace,
  resolveRoofWallHit,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const roofCursorPoint = new Vector3()

const MoveDoorTool: React.FC<{ node: DoorNode }> = ({ node: movingDoorNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingDoorNode.metadata === 'object' && movingDoorNode.metadata !== null
        ? (movingDoorNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    const original = {
      position: [...movingDoorNode.position] as [number, number, number],
      rotation: [...movingDoorNode.rotation] as [number, number, number],
      side: movingDoorNode.side,
      parentId: movingDoorNode.parentId,
      wallId: movingDoorNode.wallId,
      // Doors can be hosted on a roof-segment wall face. Moving onto a
      // wall re-anchors as wall-hosted (roofSegmentId cleared); reverts
      // must restore the roof host.
      roofSegmentId: movingDoorNode.roofSegmentId,
      roofFace: movingDoorNode.roofFace,
      metadata: movingDoorNode.metadata,
    }

    if (!isNew) {
      useScene.getState().updateNode(movingDoorNode.id, {
        metadata: { ...meta, isTransient: true },
      })
    }

    let currentWallId: string | null = movingDoorNode.parentId
    let dragAnchor: { wallId: string; rawX: number; startX: number } | null = null
    let lastTarget: {
      wallNode: WallEvent['node']
      wallId: string
      side: DoorNode['side']
      itemRotation: number
      cursorRotation: number
      clampedX: number
      clampedY: number
      valid: boolean
      event: WallEvent
    } | null = null

    const markWallDirty = (wallId: string | null) => {
      if (wallId) useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }
    const lastWallDirtyAt = new Map<string, number>()
    const markWallDirtyThrottled = (wallId: string | null) => {
      if (!wallId) return
      const now = globalThis.performance?.now?.() ?? Date.now()
      const last = lastWallDirtyAt.get(wallId) ?? 0
      // Wall rebuilds can trigger expensive CSG; throttle live previews to avoid FPS collapse.
      if (now - last > 120) {
        lastWallDirtyAt.set(wallId, now)
        markWallDirty(wallId)
      }
    }

    const getLevelId = () => useViewer.getState().selection.levelId
    const getLevelYOffset = () => {
      const id = getLevelId()
      return id ? (sceneRegistry.nodes.get(id as AnyNodeId)?.position.y ?? 0) : 0
    }
    const getSlabElevation = (wallEvent: WallEvent) =>
      spatialGridManager.getSlabElevationForWall(
        wallEvent.node.parentId ?? '',
        wallEvent.node.start,
        wallEvent.node.end,
      )

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
    }

    // Alignment candidates — anchors of every OTHER alignable object (the
    // moving door is excluded so it never aligns to itself).
    const alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      movingDoorNode.id,
    )

    const updateCursor = (
      worldPosition: [number, number, number],
      cursorRotationY: number,
      valid: boolean,
    ) => {
      const group = cursorGroupRef.current
      if (!group) return
      group.visible = true
      group.position.set(...worldPosition)
      group.rotation.y = cursorRotationY
      edgeMaterial.color.setHex(valid ? 0x22_c5_5e : 0xef_44_44)
    }

    const getPlacementOrientation = (event: WallEvent) => {
      const faceSide = getSideFromNormal(event.normal)
      const side = movingDoorNode.side ?? faceSide
      const rotationOffset = side !== faceSide ? Math.PI : 0
      return {
        side,
        itemRotation: calculateItemRotation(event.normal) + rotationOffset,
        cursorRotation:
          calculateCursorRotation(event.normal, event.node.start, event.node.end) + rotationOffset,
      }
    }

    const resolveMoveTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const { side, itemRotation, cursorRotation } = getPlacementOrientation(event)

      const rawLocalX = event.localPosition[0]
      if (!dragAnchor || dragAnchor.wallId !== event.node.id) {
        dragAnchor = {
          wallId: event.node.id,
          rawX: rawLocalX,
          startX: event.node.id === original.parentId ? original.position[0] : rawLocalX,
        }
      }
      const targetLocalX = dragAnchor.startX + (rawLocalX - dragAnchor.rawX)
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: targetLocalX,
        width: movingDoorNode.width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        movingDoorNode.width,
        movingDoorNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        movingDoorNode.width,
        movingDoorNode.height,
        movingDoorNode.id,
      )

      return {
        wallNode: event.node,
        wallId: event.node.id,
        side,
        itemRotation,
        cursorRotation,
        clampedX,
        clampedY,
        valid,
        event,
      }
    }

    const applyPreview = (target: NonNullable<typeof lastTarget>) => {
      if (currentWallId !== target.wallId) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
          roofSegmentId: undefined,
          roofFace: undefined,
        })
        markWallDirty(currentWallId)
        currentWallId = target.wallId
      } else {
        const doorMesh = sceneRegistry.nodes.get(movingDoorNode.id as AnyNodeId)
        if (doorMesh) {
          doorMesh.position.set(target.clampedX, target.clampedY, 0)
          doorMesh.rotation.set(0, target.itemRotation, 0)
          doorMesh.updateMatrixWorld(true)
        }
      }
      useLiveTransforms.getState().set(movingDoorNode.id, {
        position: [target.clampedX, target.clampedY, 0],
        rotation: target.itemRotation,
      })
      markWallDirtyThrottled(target.wallId)

      updateCursor(
        wallLocalToWorld(
          target.wallNode,
          target.clampedX,
          target.clampedY,
          getLevelYOffset(),
          getSlabElevation(target.event),
        ),
        target.cursorRotation,
        target.valid,
      )
    }

    const onWallEnter = (event: WallEvent) => {
      const target = resolveMoveTarget(event)
      if (!target) return
      lastTarget = target
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const target = resolveMoveTarget(event)
      if (!target) return
      lastTarget = target
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) return
      if (event.node.parentId !== getLevelId()) return

      const target = lastTarget?.wallId === event.node.id ? lastTarget : resolveMoveTarget(event)
      if (!target?.valid) return

      let placedId: string

      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingDoorNode) as any
        delete cloned.id
        cloned.metadata = stripPlacementMetadataFlags(cloned.metadata)
        const node = DoorNode.parse({
          ...cloned,
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          wallId: target.wallId,
          parentId: target.wallId,
          roofSegmentId: undefined,
          roofFace: undefined,
        })
        useScene.getState().createNode(node, target.wallId as AnyNodeId)
        placedId = node.id
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          roofSegmentId: original.roofSegmentId,
          roofFace: original.roofFace,
          metadata: original.metadata,
        })
        useScene.temporal.getState().resume()

        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
          roofSegmentId: undefined,
          metadata: {},
        })

        if (original.parentId && original.parentId !== target.wallId) {
          markWallDirty(original.parentId)
        }
        placedId = movingDoorNode.id
      }

      markWallDirty(target.wallId)
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onWallLeave = () => {
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      dragAnchor = null
      lastTarget = null
      if (isNew) return
      if (currentWallId && currentWallId !== original.parentId) {
        markWallDirty(currentWallId)
      }
      currentWallId = original.parentId
      useScene.getState().updateNode(movingDoorNode.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        wallId: original.wallId,
        roofSegmentId: original.roofSegmentId,
        roofFace: original.roofFace,
      })
      if (original.parentId) markWallDirty(original.parentId)
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // Mirrors the wall flow for the segments' vertical wall faces (base
    // walls under the roof + coplanar gable ends). This is also the
    // placement path preset tiles take (`metadata.isNew` clones).

    const worldToBuildingLocal = (point: Vector3): [number, number, number] => {
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : undefined
      if (buildingObj) buildingObj.worldToLocal(point)
      return [point.x, point.y, point.z]
    }

    const resolveRoofMoveTarget = (event: RoofEvent) => {
      const hit = resolveRoofWallHit(
        event.node as RoofNode,
        event.position,
        event.normal,
        event.object,
      )
      if (!hit) return null
      // Doors sit on the segment base: v locked to height/2, only u slides.
      const clamped = clampRectToRoofWallFace(
        hit.face,
        hit.u,
        movingDoorNode.height / 2,
        movingDoorNode.width,
        movingDoorNode.height,
        { lockV: true },
      )
      if (!clamped) return null
      // FACE-LOCAL storage (u, v, z = 0 → wall mid-plane): the renderer
      // mounts the node inside the live face frame, so it tracks segment
      // resizes without any re-anchoring.
      const position: [number, number, number] = [clamped.u, clamped.v, 0]
      const valid = !hasRoofFaceChildOverlap(
        hit.segment,
        hit.face.id,
        clamped.u,
        clamped.v,
        movingDoorNode.width,
        movingDoorNode.height,
        movingDoorNode.id,
      )
      return { hit, position, valid, roof: event.node as RoofNode }
    }

    const updateRoofCursor = (target: NonNullable<ReturnType<typeof resolveRoofMoveTarget>>) => {
      const segObj = sceneRegistry.nodes.get(target.hit.segment.id as AnyNodeId)
      if (!segObj) return
      segObj.updateWorldMatrix(true, false)
      const segLocal = roofFacePointToSegment(
        target.hit.segment,
        target.hit.face.id,
        target.position,
      )
      roofCursorPoint.set(segLocal[0], segLocal[1], segLocal[2])
      segObj.localToWorld(roofCursorPoint)
      updateCursor(
        worldToBuildingLocal(roofCursorPoint),
        (target.roof.rotation ?? 0) + (target.hit.segment.rotation ?? 0) + target.hit.face.yaw,
        target.valid,
      )
    }

    const onRoofHover = (event: RoofEvent) => {
      const target = resolveRoofMoveTarget(event)
      if (!target) return
      // Wall-frame drag anchor / live transform don't apply on a roof face.
      dragAnchor = null
      lastTarget = null
      useLiveTransforms.getState().clear(movingDoorNode.id)
      if (currentWallId !== target.hit.segment.id) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          side: 'front',
          parentId: target.hit.segment.id,
          wallId: undefined,
          roofSegmentId: target.hit.segment.id,
          roofFace: target.hit.face.id,
        })
        markWallDirty(currentWallId)
        currentWallId = target.hit.segment.id
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          roofFace: target.hit.face.id,
        })
      }
      updateRoofCursor(target)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      const target = resolveRoofMoveTarget(event)
      if (!target?.valid) return
      const segmentId = target.hit.segment.id

      let placedId: string

      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingDoorNode) as any
        delete cloned.id
        cloned.metadata = stripPlacementMetadataFlags(cloned.metadata)
        const node = DoorNode.parse({
          ...cloned,
          position: target.position,
          rotation: [0, 0, 0],
          side: 'front',
          wallId: undefined,
          roofSegmentId: segmentId,
          roofFace: target.hit.face.id,
          parentId: segmentId,
        })
        useScene.getState().createNode(node, segmentId as AnyNodeId)
        placedId = node.id
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          roofSegmentId: original.roofSegmentId,
          roofFace: original.roofFace,
          metadata: original.metadata,
        })
        useScene.temporal.getState().resume()

        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          side: 'front',
          parentId: segmentId,
          wallId: undefined,
          roofSegmentId: segmentId,
          roofFace: target.hit.face.id,
          metadata: {},
        })

        if (original.parentId && original.parentId !== segmentId) {
          markWallDirty(original.parentId)
        }
        placedId = movingDoorNode.id
      }

      markWallDirty(segmentId)
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onRoofLeave = () => {
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      dragAnchor = null
      lastTarget = null
      if (isNew) return
      if (currentWallId && currentWallId !== original.parentId) {
        markWallDirty(currentWallId)
      }
      currentWallId = original.parentId
      useScene.getState().updateNode(movingDoorNode.id, {
        position: original.position,
        rotation: original.rotation,
        side: original.side,
        parentId: original.parentId,
        wallId: original.wallId,
        roofSegmentId: original.roofSegmentId,
        roofFace: original.roofFace,
      })
      if (original.parentId) markWallDirty(original.parentId)
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingDoorNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        if (currentWallId) markWallDirty(currentWallId)
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: original.position,
          rotation: original.rotation,
          side: original.side,
          parentId: original.parentId,
          wallId: original.wallId,
          roofSegmentId: original.roofSegmentId,
          roofFace: original.roofFace,
          metadata: original.metadata,
        })
        if (original.parentId) markWallDirty(original.parentId)
      }
      useScene.temporal.getState().resume()
      hideCursor()
      exitMoveMode()
    }

    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofHover)
    emitter.on('roof:move', onRoofHover)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', onRoofLeave)
    emitter.on('tool:cancel', onCancel)

    return () => {
      const current = useScene.getState().nodes[movingDoorNode.id as AnyNodeId] as
        | DoorNode
        | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
        if (isNew) {
          useScene.getState().deleteNode(movingDoorNode.id)
          if (currentWallId) markWallDirty(currentWallId)
        } else {
          useScene.getState().updateNode(movingDoorNode.id, {
            position: original.position,
            rotation: original.rotation,
            side: original.side,
            parentId: original.parentId,
            wallId: original.wallId,
            roofSegmentId: original.roofSegmentId,
            roofFace: original.roofFace,
            metadata: original.metadata,
          })
          if (original.parentId) markWallDirty(original.parentId)
        }
      }
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('roof:enter', onRoofHover)
      emitter.off('roof:move', onRoofHover)
      emitter.off('roof:click', onRoofClick)
      emitter.off('roof:leave', onRoofLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [movingDoorNode, exitMoveMode])

  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(
      movingDoorNode.width,
      movingDoorNode.height,
      movingDoorNode.frameDepth ?? 0.07,
    )
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [movingDoorNode])

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
    </group>
  )
}

export default MoveDoorTool
