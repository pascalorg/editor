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
  triggerSFX,
  useAlignmentGuides,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments, Vector3 } from 'three'
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

/**
 * Door tool — places DoorNodes on walls and on roof-segment wall faces
 * (the generated base walls under a roof, including coplanar gable ends).
 * Doors always sit at floor level (clampedY = height/2 — segment base for
 * roof-hosted doors).
 */
const DoorTool: React.FC = () => {
  const draftRef = useRef<DoorNode | null>(null)
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)

  useEffect(() => {
    useScene.temporal.getState().pause()

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

    const markWallDirty = (wallId: string) => {
      useScene.getState().dirtyNodes.add(wallId as AnyNodeId)
    }

    const destroyDraft = () => {
      if (!draftRef.current) return
      const wallId = draftRef.current.parentId
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
      if (wallId) markWallDirty(wallId)
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. A door aligns by the plan position of its centre.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')

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

    const onWallEnter = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        destroyDraft()
        hideCursor()
        return
      }
      const levelId = getLevelId()
      if (!levelId) return
      if (event.node.parentId !== levelId) return

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const width = 0.9
      const height = 2.1
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: event.localPosition[0],
        width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })

      const { clampedX, clampedY } = clampToWall(event.node, localX, width, height)

      const node = DoorNode.parse({
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        metadata: { isTransient: true },
      })

      useScene.getState().createNode(node, event.node.id as AnyNodeId)
      draftRef.current = node

      const valid = !hasWallChildOverlap(event.node.id, clampedX, clampedY, width, height, node.id)

      updateCursor(
        wallLocalToWorld(
          event.node,
          clampedX,
          clampedY,
          getLevelYOffset(),
          getSlabElevation(event),
        ),
        cursorRotation,
        valid,
      )
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        destroyDraft()
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const width = draftRef.current?.width ?? 0.9
      const height = draftRef.current?.height ?? 2.1
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: event.localPosition[0],
        width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })

      const { clampedX, clampedY } = clampToWall(event.node, localX, width, height)

      // Draft may be null after a successful placement (the click handler
      // deletes it and relies on the wall rebuild → pointer-enter cascade to
      // recreate it). Recreate it here on the first subsequent move so the
      // preview is ready for the next click without requiring a leave/enter.
      if (!draftRef.current) {
        const levelId = getLevelId()
        if (levelId && event.node.parentId === levelId) {
          const node = DoorNode.parse({
            position: [clampedX, clampedY, 0],
            rotation: [0, itemRotation, 0],
            side,
            wallId: event.node.id,
            parentId: event.node.id,
            metadata: { isTransient: true },
          })
          useScene.getState().createNode(node, event.node.id as AnyNodeId)
          draftRef.current = node
        }
      }

      if (draftRef.current) {
        // Update the scene store on every move so the 2D floor plan
        // stays in sync (it re-renders from `node.position`). Only
        // forward `parentId` / `wallId` when the wall actually changed
        // — otherwise the reparent path churns the host wall's
        // `children` array every tick, which re-renders the wall and
        // briefly draws its 0-vertex placeholder geometry (WebGPU then
        // flags "Vertex buffer slot 0 ... was not set").
        const isSameWall = event.node.id === draftRef.current.parentId
        if (isSameWall) {
          useScene.getState().updateNode(draftRef.current.id, {
            position: [clampedX, clampedY, 0],
            rotation: [0, itemRotation, 0],
            side,
          })
          markWallDirty(event.node.id)
        } else {
          useScene.getState().updateNode(draftRef.current.id, {
            position: [clampedX, clampedY, 0],
            rotation: [0, itemRotation, 0],
            side,
            parentId: event.node.id,
            wallId: event.node.id,
            // The draft may arrive from a roof-segment face hover.
            roofSegmentId: undefined,
            roofFace: undefined,
          })
        }
      }

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        width,
        height,
        draftRef.current?.id,
      )

      updateCursor(
        wallLocalToWorld(
          event.node,
          clampedX,
          clampedY,
          getLevelYOffset(),
          getSlabElevation(event),
        ),
        cursorRotation,
        valid,
      )
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!draftRef.current) return
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) return
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: event.localPosition[0],
        width: draftRef.current.width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        draftRef.current.width,
        draftRef.current.height,
      )
      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        draftRef.current.width,
        draftRef.current.height,
        draftRef.current.id,
      )
      if (!valid) return

      const draft = draftRef.current
      draftRef.current = null

      useScene.getState().deleteNode(draft.id)
      useScene.temporal.getState().resume()

      const levelId = getLevelId()
      const state = useScene.getState()
      const doorCount = Object.values(state.nodes).filter((n) => {
        if (n.type !== 'door') return false
        const wall = n.parentId ? state.nodes[n.parentId as AnyNodeId] : undefined
        return wall?.parentId === levelId
      }).length
      const name = `Door ${doorCount + 1}`

      const node = DoorNode.parse({
        name,
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        width: draft.width,
        height: draft.height,
        doorCategory: draft.doorCategory,
        doorType: draft.doorType,
        leafCount: draft.leafCount,
        operationState: draft.operationState,
        slideDirection: draft.slideDirection,
        trackStyle: draft.trackStyle,
        garagePanelCount: draft.garagePanelCount,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        threshold: draft.threshold,
        thresholdHeight: draft.thresholdHeight,
        hingesSide: draft.hingesSide,
        swingDirection: draft.swingDirection,
        segments: draft.segments,
        handle: draft.handle,
        handleHeight: draft.handleHeight,
        handleSide: draft.handleSide,
        doorCloser: draft.doorCloser,
        panicBar: draft.panicBar,
        panicBarHeight: draft.panicBarHeight,
      })

      useScene.getState().createNode(node, event.node.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()
      triggerSFX('sfx:structure-build')
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
      useAlignmentGuides.getState().clear()

      event.stopPropagation()
    }

    const onWallLeave = () => {
      destroyDraft()
      hideCursor()
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // The merged roof mesh emits `roof:*`; hits are resolved against the
    // segments' vertical wall faces (base walls + coplanar gable ends).

    const worldToBuildingLocal = (point: Vector3): [number, number, number] => {
      // The tool's cursor group renders in the building's local frame —
      // same conversion as the roof accessory tools (e.g. SkylightTool).
      const buildingId = useViewer.getState().selection.buildingId
      const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : undefined
      if (buildingObj) buildingObj.worldToLocal(point)
      return [point.x, point.y, point.z]
    }

    const resolveRoofTarget = (event: RoofEvent) => {
      const hit = resolveRoofWallHit(
        event.node as RoofNode,
        event.position,
        event.normal,
        event.object,
      )
      if (!hit) return null
      const width = draftRef.current?.width ?? 0.9
      const height = draftRef.current?.height ?? 2.1
      // Doors sit on the segment base: v locked to height/2, only u slides.
      const clamped = clampRectToRoofWallFace(hit.face, hit.u, height / 2, width, height, {
        lockV: true,
      })
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
        width,
        height,
        draftRef.current?.id,
      )
      return { hit, position, valid }
    }

    const updateRoofCursor = (
      target: NonNullable<ReturnType<typeof resolveRoofTarget>>,
      roof: RoofNode,
    ) => {
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
        (roof.rotation ?? 0) + (target.hit.segment.rotation ?? 0) + target.hit.face.yaw,
        target.valid,
      )
    }

    const onRoofHover = (event: RoofEvent) => {
      const target = resolveRoofTarget(event)
      if (!target) {
        // On the roof but not over a placeable wall face (slope, soffit,
        // or a face the door cannot fit on).
        if (draftRef.current?.roofSegmentId) {
          destroyDraft()
          hideCursor()
        }
        return
      }
      const { hit, position } = target

      if (draftRef.current && draftRef.current.parentId !== hit.segment.id) destroyDraft()
      if (draftRef.current) {
        useScene.getState().updateNode(draftRef.current.id, {
          position,
          rotation: [0, 0, 0],
          roofFace: hit.face.id,
        })
      } else {
        const node = DoorNode.parse({
          position,
          rotation: [0, 0, 0],
          side: 'front',
          roofSegmentId: hit.segment.id,
          roofFace: hit.face.id,
          parentId: hit.segment.id,
          metadata: { isTransient: true },
        })
        useScene.getState().createNode(node, hit.segment.id as AnyNodeId)
        draftRef.current = node
      }
      updateRoofCursor(target, event.node as RoofNode)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (!draftRef.current?.roofSegmentId) return
      const target = resolveRoofTarget(event)
      if (!target?.valid) return
      const { hit, position } = target

      const draft = draftRef.current
      draftRef.current = null

      useScene.getState().deleteNode(draft.id)
      useScene.temporal.getState().resume()

      const state = useScene.getState()
      const doorCount = Object.values(state.nodes).filter(
        (n) => n.type === 'door' && (n as DoorNode).roofSegmentId !== undefined,
      ).length

      const node = DoorNode.parse({
        name: `Door ${doorCount + 1}`,
        position,
        rotation: [0, 0, 0],
        side: 'front',
        roofSegmentId: hit.segment.id,
        roofFace: hit.face.id,
        parentId: hit.segment.id,
        width: draft.width,
        height: draft.height,
        doorCategory: draft.doorCategory,
        doorType: draft.doorType,
        leafCount: draft.leafCount,
        operationState: draft.operationState,
        slideDirection: draft.slideDirection,
        trackStyle: draft.trackStyle,
        garagePanelCount: draft.garagePanelCount,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        threshold: draft.threshold,
        thresholdHeight: draft.thresholdHeight,
        hingesSide: draft.hingesSide,
        swingDirection: draft.swingDirection,
        segments: draft.segments,
        handle: draft.handle,
        handleHeight: draft.handleHeight,
        handleSide: draft.handleSide,
        doorCloser: draft.doorCloser,
        panicBar: draft.panicBar,
        panicBarHeight: draft.panicBarHeight,
      })

      useScene.getState().createNode(node, hit.segment.id as AnyNodeId)
      // Rebuild the segment (and the merged roof) so the wall brush
      // picks up the new opening cut.
      useScene.getState().dirtyNodes.add(hit.segment.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()
      triggerSFX('sfx:structure-build')
      event.stopPropagation()
    }

    const onRoofLeave = () => {
      if (!draftRef.current?.roofSegmentId) return
      destroyDraft()
      hideCursor()
    }

    const onCancel = () => {
      destroyDraft()
      hideCursor()
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
      destroyDraft()
      hideCursor()
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
  }, [])

  // Cursor geometry: door outline (default 0.9 × 2.1 × 0.07)
  const boxGeo = new BoxGeometry(0.9, 2.1, 0.07)
  const edgesGeo = new EdgesGeometry(boxGeo)
  boxGeo.dispose()

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments
        geometry={edgesGeo}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        ref={edgesRef}
      />
    </group>
  )
}

export default DoorTool
