import {
  type AnyNodeId,
  clampRectToRoofWallFace,
  collectAlignmentAnchors,
  emitter,
  isCurvedWall,
  type RoofEvent,
  type RoofNode,
  roofFacePointToSegment,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallEvent,
  WindowNode,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  hasRoofFaceChildOverlap,
  isValidWallSideFace,
  resolveRoofWallHit,
  snapToHalf,
  triggerSFX,
  useAlignmentGuides,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './window-math'

// Shared edge material — reuse across renders, just toggle color
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44, // red-500 default (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const roofCursorPoint = new Vector3()

/**
 * Window tool — places WindowNodes on walls and on roof-segment wall
 * faces (the generated base walls under a roof, including coplanar gable
 * ends — a window can sit in the gable pediment).
 * Shows a rectangle cursor (green = valid, red = invalid) matching window dimensions.
 */
const WindowTool: React.FC = () => {
  const draftRef = useRef<WindowNode | null>(null)
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
      // Rebuild wall so it removes the cutout from the deleted draft
      if (wallId) markWallDirty(wallId)
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. A window aligns by the plan position of its centre
    // (along-wall only; the floor-plane guides don't cover sill height).
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
      // Only interact with walls on the current level
      if (event.node.parentId !== levelId) return

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const width = 1.5
      const height = 1.5
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: event.localPosition[0],
        width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const localY = snapToHalf(event.localPosition[1])

      const { clampedX, clampedY } = clampToWall(event.node, localX, localY, width, height)

      const node = WindowNode.parse({
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
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) return

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const width = draftRef.current?.width ?? 1.5
      const height = draftRef.current?.height ?? 1.5
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: event.localPosition[0],
        width,
        candidates: alignmentCandidates,
        bypass: event.nativeEvent?.altKey === true,
      })
      const localY = snapToHalf(event.localPosition[1])

      const { clampedX, clampedY } = clampToWall(event.node, localX, localY, width, height)

      // Draft may be null after a successful placement (the click handler
      // deletes it and relies on the wall rebuild → pointer-enter cascade to
      // recreate it). Recreate it here on the first subsequent move so the
      // preview is ready for the next click without requiring a leave/enter.
      if (!draftRef.current) {
        const levelId = getLevelId()
        if (levelId && event.node.parentId === levelId) {
          const node = WindowNode.parse({
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
      // Only interact with walls on the current level
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
      const localY = snapToHalf(event.localPosition[1])
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        localY,
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

      // Delete transient draft (paused, invisible to undo)
      useScene.getState().deleteNode(draft.id)

      // Resume → create permanent node (single undoable action)
      useScene.temporal.getState().resume()

      const levelId = getLevelId()
      const state = useScene.getState()
      const windowCount = Object.values(state.nodes).filter((n) => {
        if (n.type !== 'window') return false
        const wall = n.parentId ? state.nodes[n.parentId as AnyNodeId] : undefined
        return wall?.parentId === levelId
      }).length
      const name = `Window ${windowCount + 1}`

      const node = WindowNode.parse({
        name,
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: event.node.id,
        parentId: event.node.id,
        width: draft.width,
        height: draft.height,
        windowType: draft.windowType,
        operationState: draft.operationState,
        awningDirection: draft.awningDirection,
        casementStyle: draft.casementStyle,
        hingesSide: draft.hingesSide,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        columnRatios: draft.columnRatios,
        rowRatios: draft.rowRatios,
        columnDividerThickness: draft.columnDividerThickness,
        rowDividerThickness: draft.rowDividerThickness,
        sill: draft.sill,
        sillDepth: draft.sillDepth,
        sillThickness: draft.sillThickness,
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
    // segments' vertical wall faces (base walls + coplanar gable ends),
    // so a window can sit anywhere inside the face profile — including
    // the gable pediment triangle.

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
      const width = draftRef.current?.width ?? 1.5
      const height = draftRef.current?.height ?? 1.5
      // Free vertical placement (snapped to the 0.5m grid like walls);
      // the clamp projects the window inside the face profile, sliding
      // it down under the gable slopes when needed.
      const clamped = clampRectToRoofWallFace(hit.face, hit.u, snapToHalf(hit.v), width, height)
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
        // or a face the window cannot fit on).
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
        const node = WindowNode.parse({
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
      const windowCount = Object.values(state.nodes).filter(
        (n) => n.type === 'window' && (n as WindowNode).roofSegmentId !== undefined,
      ).length

      const node = WindowNode.parse({
        name: `Window ${windowCount + 1}`,
        position,
        rotation: [0, 0, 0],
        side: 'front',
        roofSegmentId: hit.segment.id,
        roofFace: hit.face.id,
        parentId: hit.segment.id,
        width: draft.width,
        height: draft.height,
        windowType: draft.windowType,
        operationState: draft.operationState,
        awningDirection: draft.awningDirection,
        casementStyle: draft.casementStyle,
        hingesSide: draft.hingesSide,
        frameThickness: draft.frameThickness,
        frameDepth: draft.frameDepth,
        columnRatios: draft.columnRatios,
        rowRatios: draft.rowRatios,
        columnDividerThickness: draft.columnDividerThickness,
        rowDividerThickness: draft.rowDividerThickness,
        sill: draft.sill,
        sillDepth: draft.sillDepth,
        sillThickness: draft.sillThickness,
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

  // Cursor geometry: window outline rectangle (width × height × frameDepth)
  const boxGeo = new BoxGeometry(1.5, 1.5, 0.07)
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

export default WindowTool
