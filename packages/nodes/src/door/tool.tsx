import {
  type AnyNodeId,
  DoorNode,
  emitter,
  isCurvedWall,
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
  isValidWallSideFace,
  snapToHalf,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import {
  clearOpeningGuides3D,
  publishOpeningGuidesForWallEvent,
} from '../shared/opening-guides-runtime'
import { resolveOpeningCommitDraft } from '../shared/opening-click-draft'
import { resolveOpeningPlacement } from '../shared/wall-attach-target'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'

const isOpeningPlacementValid = (...args: Parameters<typeof hasWallChildOverlap>) =>
  resolveOpeningPlacement({ collides: hasWallChildOverlap(...args) }).placeable

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

/**
 * Door tool — places DoorNodes on walls only.
 * Doors always sit at floor level (clampedY = height/2).
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
      clearOpeningGuides3D()
    }

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
      if (!isValidWallSideFace(event.normal)) {
        return
      }
      if (isCurvedWall(event.node)) {
        destroyDraft()
        hideCursor()
        return
      }
      const levelId = getLevelId()
      if (!levelId) {
        return
      }
      if (event.node.parentId !== levelId) {
        return
      }

      destroyDraft()

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const width = 0.9
      const height = 2.1

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

      const valid = isOpeningPlacementValid(
        event.node.id,
        clampedX,
        clampedY,
        width,
        height,
        node.id,
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
      publishOpeningGuidesForWallEvent({
        wall: event.node,
        movingId: node.id,
        centerS: clampedX,
        centerY: clampedY,
        width,
        height,
        includeVertical: false,
        levelYOffset: getLevelYOffset(),
        slabElevation: getSlabElevation(event),
      })
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) {
        return
      }
      if (isCurvedWall(event.node)) {
        destroyDraft()
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) {
        return
      }

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)

      const localX = snapToHalf(event.localPosition[0])
      const width = draftRef.current?.width ?? 0.9
      const height = draftRef.current?.height ?? 2.1

      const { clampedX, clampedY } = clampToWall(event.node, localX, width, height)

      if (draftRef.current) {
        if (event.node.id !== draftRef.current.parentId) {
          // Wall changed without enter/leave: must updateNode to reparent
          useScene.getState().updateNode(draftRef.current.id, {
            position: [clampedX, clampedY, 0],
            rotation: [0, itemRotation, 0],
            side,
            parentId: event.node.id,
            wallId: event.node.id,
          })
        } else {
          // Same wall: update Three.js mesh directly to avoid store churn
          const draftMesh = sceneRegistry.nodes.get(draftRef.current.id as AnyNodeId)
          if (draftMesh) {
            draftMesh.position.set(clampedX, clampedY, 0)
            draftMesh.rotation.set(0, itemRotation, 0)
            draftMesh.updateMatrixWorld(true)
          }
          markWallDirty(event.node.id)
        }
      }

      const valid = isOpeningPlacementValid(
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
      if (draftRef.current) {
        publishOpeningGuidesForWallEvent({
          wall: event.node,
          movingId: draftRef.current.id,
          centerS: clampedX,
          centerY: clampedY,
          width,
          height,
          includeVertical: false,
          levelYOffset: getLevelYOffset(),
          slabElevation: getSlabElevation(event),
        })
      }
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      const sceneDraft = draftRef.current
      const draft = resolveOpeningCommitDraft(sceneDraft)
      if (!draft) return
      if (!isValidWallSideFace(event.normal)) {
        return
      }
      if (isCurvedWall(event.node)) {
        return
      }
      if (event.node.parentId !== getLevelId()) {
        return
      }

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)

      const localX = snapToHalf(event.localPosition[0])
      const { clampedX, clampedY } = clampToWall(event.node, localX, draft.width, draft.height)
      const valid = isOpeningPlacementValid(
        event.node.id,
        clampedX,
        clampedY,
        draft.width,
        draft.height,
        sceneDraft?.id,
      )
      if (!valid) {
        return
      }

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
      triggerSFX('sfx:item-place')
      clearOpeningGuides3D()

      event.stopPropagation()
    }

    const onWallLeave = () => {
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
    emitter.on('tool:cancel', onCancel)

    return () => {
      destroyDraft()
      hideCursor()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('tool:cancel', onCancel)
    }
  }, [])

  // Cursor geometry: door outline (default 0.9 × 2.1 × 0.07)
  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(0.9, 2.1, 0.07)
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [])

  useEffect(() => () => edgesGeo.dispose(), [edgesGeo])

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
