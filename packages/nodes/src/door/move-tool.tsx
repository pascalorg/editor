import {
  type AnyNodeId,
  collectAlignmentAnchors,
  DoorNode,
  emitter,
  type GridEvent,
  isCurvedWall,
  type RoofEvent,
  type RoofNode,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  consumePlacementDragRelease,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, type Group } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import {
  clearOpeningGuides3D,
  publishOpeningGuidesForWallEvent,
} from '../shared/opening-guides-runtime'
import {
  getRoofWallOpeningCursorPose,
  type RoofWallOpeningTarget,
  resolveRoofWallOpeningTarget,
} from '../shared/roof-wall-opening-placement'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

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

    let currentHostId: string | null = movingDoorNode.parentId
    let dragAnchor: { wallId: string; rawX: number; startX: number } | null = null
    let committed = false
    // Off-wall free-follow: when the cursor is over empty floor (no wall under
    // the ray) the door is parented to the level and tracks the cursor like an
    // item node. `freeFollowing` distinguishes that state so the placement
    // commit no-ops in open space (a door needs a wall). `lastMeshEventTime`
    // defers the floor handler whenever a wall/roof mesh event owns the same
    // pointermove (shared DOM timeStamp) — that's the only thing that snaps.
    let freeFollowing = false
    let lastMeshEventTime = -1
    // The door's chosen facing side. R flips it mid-placement (front ↔ back,
    // same as the committed-selected R flip) so the user can reorient before
    // committing. Initialised from the moving node's side.
    let sideOverride: DoorNode['side'] = movingDoorNode.side
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
    let lastRoofEvent: RoofEvent | null = null

    const markHostDirty = (hostId: string | null) => {
      if (hostId) useScene.getState().dirtyNodes.add(hostId as AnyNodeId)
    }
    const lastHostDirtyAt = new Map<string, number>()
    const markHostDirtyThrottled = (hostId: string | null) => {
      if (!hostId) return
      const now = globalThis.performance?.now?.() ?? Date.now()
      const last = lastHostDirtyAt.get(hostId) ?? 0
      // Wall rebuilds can trigger expensive CSG; throttle live previews to avoid FPS collapse.
      if (now - last > 120) {
        lastHostDirtyAt.set(hostId, now)
        markHostDirty(hostId)
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
      clearOpeningGuides3D()
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
      const side = sideOverride ?? faceSide
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
        bypass: event.nativeEvent?.altKey === true || event.nativeEvent?.shiftKey === true,
        bypassSnap: event.nativeEvent?.shiftKey === true,
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
      if (currentHostId !== target.wallId) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
          roofSegmentId: undefined,
          roofFace: undefined,
        })
        markHostDirty(currentHostId)
        currentHostId = target.wallId
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
      markHostDirtyThrottled(target.wallId)

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

      publishOpeningGuidesForWallEvent({
        wall: target.wallNode,
        movingId: movingDoorNode.id,
        centerS: target.clampedX,
        centerY: target.clampedY,
        width: movingDoorNode.width,
        height: movingDoorNode.height,
        // Doors sit on the floor — no sill/head or vertical alignment guides.
        includeVertical: false,
        levelYOffset: getLevelYOffset(),
        slabElevation: getSlabElevation(target.event),
      })
    }

    const onWallEnter = (event: WallEvent) => {
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      const target = resolveMoveTarget(event)
      if (!target) {
        onWallLeave()
        return
      }
      freeFollowing = false
      lastTarget = target
      lastRoofEvent = null
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      if (!isValidWallSideFace(event.normal)) {
        onWallLeave()
        return
      }
      if (isCurvedWall(event.node)) {
        onWallLeave()
        return
      }
      if (event.node.parentId !== getLevelId()) {
        onWallLeave()
        return
      }

      const target = resolveMoveTarget(event)
      if (!target) {
        onWallLeave()
        return
      }
      freeFollowing = false
      lastTarget = target
      lastRoofEvent = null
      applyPreview(target)
      event.stopPropagation()
    }

    // Promote the moving door into its committed wall placement. Shared by the
    // direct wall-mesh click and the floor proximity click.
    const commitToWall = (target: NonNullable<typeof lastTarget>) => {
      if (committed) return
      committed = true

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
          markHostDirty(original.parentId)
        }
        placedId = movingDoorNode.id
      }

      markHostDirty(target.wallId)
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
    }

    const onWallClick = (event: WallEvent) => {
      if (committed) return
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) return
      if (event.node.parentId !== getLevelId()) return

      const target = lastTarget?.wallId === event.node.id ? lastTarget : resolveMoveTarget(event)
      if (!target?.valid) return
      commitToWall(target)
      event.stopPropagation()
    }

    const onWallLeave = () => {
      // The cursor left the wall mesh. Don't snap back to the origin/original
      // here — the floor proximity handler (onGridMove) takes over on the same
      // pointermove: it either snaps to a nearby wall or free-follows the
      // cursor. The wireframe outline + live transform are cleared so the
      // free-follow path can re-establish them. Reverting the node is left to
      // onGridMove's free-follow / cancel / commit, so the door never blinks
      // back to the building origin between a wall and open floor.
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      dragAnchor = null
      lastTarget = null
      lastRoofEvent = null
    }

    // Free-follow: the door rides the cursor over empty floor, parented to the
    // level like an item node (lifted so it stands on the floor). No wall to
    // attach to, so it is not committable here.
    const freeFollowAt = (localX: number, localZ: number) => {
      freeFollowing = true
      lastTarget = null
      lastRoofEvent = null
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      const levelId = getLevelId()
      const y = movingDoorNode.height / 2
      // Keep the R-flip visible while free-following: face the chosen side
      // (back = rotated π) instead of forcing 0, so an R press isn't undone on
      // the next mousemove.
      const yaw = sideOverride === 'back' ? Math.PI : 0
      if (currentHostId !== levelId) {
        if (currentHostId && currentHostId !== levelId) markHostDirty(currentHostId)
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [localX, y, localZ],
          rotation: [0, yaw, 0],
          side: sideOverride,
          parentId: levelId ?? undefined,
          wallId: undefined,
          roofSegmentId: undefined,
          roofFace: undefined,
        })
        currentHostId = levelId
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [localX, y, localZ],
          rotation: [0, yaw, 0],
          side: sideOverride,
        })
      }
    }

    const onGridMove = (event: GridEvent) => {
      if (committed) return
      if (useViewer.getState().cameraDragging) return
      // A wall/roof mesh handler owns this exact pointermove (shared DOM
      // timeStamp): the cursor ray is on a wall/roof, so it snaps. Otherwise
      // the cursor is over open floor — free-follow it.
      if (event.nativeEvent?.timeStamp === lastMeshEventTime) return

      // No proximity magnet: in 3D the wall side faces are big raycast targets,
      // so snapping engages only when the cursor ray actually hovers a wall
      // (`onWallMove`). Over open floor the door just follows the cursor.
      const [x, , z] = event.localPosition
      freeFollowAt(x, z)
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // Mirrors the wall flow for the segments' vertical wall faces (base
    // walls under the roof + coplanar gable ends). This is also the
    // placement path preset tiles take (`metadata.isNew` clones).

    const resolveRoofMoveTarget = (event: RoofEvent) =>
      resolveRoofWallOpeningTarget({
        event,
        width: movingDoorNode.width,
        height: movingDoorNode.height,
        ignoreId: movingDoorNode.id,
        vertical: { kind: 'bottom-locked' },
      })

    const updateRoofCursor = (target: RoofWallOpeningTarget, roof: RoofNode) => {
      const pose = getRoofWallOpeningCursorPose(target, roof)
      if (pose) updateCursor(pose.position, pose.rotationY, target.valid)
    }

    const onRoofHover = (event: RoofEvent) => {
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      const target = resolveRoofMoveTarget(event)
      if (!target) {
        onRoofLeave()
        return
      }
      // Wall-frame drag anchor / live transform don't apply on a roof face.
      freeFollowing = false
      dragAnchor = null
      lastTarget = null
      lastRoofEvent = event
      useLiveTransforms.getState().clear(movingDoorNode.id)
      // Opening guides are wall-specific; clear them when over a roof face.
      clearOpeningGuides3D()
      if (currentHostId !== target.segment.id) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          side: 'front',
          parentId: target.segment.id,
          wallId: undefined,
          roofSegmentId: target.segment.id,
          roofFace: target.face.id,
        })
        markHostDirty(currentHostId)
        currentHostId = target.segment.id
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          roofFace: target.face.id,
        })
      }
      updateRoofCursor(target, event.node as RoofNode)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (committed) return
      const target = resolveRoofMoveTarget(event)
      if (!target?.valid) return
      committed = true
      const segmentId = target.segment.id

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
          roofFace: target.face.id,
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
          roofFace: target.face.id,
          metadata: {},
        })

        if (original.parentId && original.parentId !== segmentId) {
          markHostDirty(original.parentId)
        }
        placedId = movingDoorNode.id
      }

      markHostDirty(segmentId)
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useScene.temporal.getState().pause()

      triggerSFX('sfx:structure-build')
      hideCursor()
      useViewer.getState().setSelection({ selectedIds: [placedId] })
      exitMoveMode()
      event.stopPropagation()
    }

    const onRoofLeave = () => {
      // Mirror onWallLeave: don't revert to origin here — onGridMove takes
      // over on the same pointermove (snap to a nearby wall or free-follow).
      hideCursor()
      useLiveTransforms.getState().clear(movingDoorNode.id)
      dragAnchor = null
      lastTarget = null
      lastRoofEvent = null
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingDoorNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingDoorNode.id)
        if (currentHostId) markHostDirty(currentHostId)
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
        if (original.parentId) markHostDirty(original.parentId)
      }
      useScene.temporal.getState().resume()
      hideCursor()
      exitMoveMode()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      // Free-following over open floor can't commit (no wall). A wall hover
      // target commits via commitToWall; a roof face via onRoofClick.
      if (lastTarget?.valid && !freeFollowing) {
        commitToWall(lastTarget)
        return
      }
      if (lastRoofEvent) onRoofClick(lastRoofEvent)
    }

    // R flips the door's facing side mid-placement (front ↔ back), like the
    // committed-selected R flip — usable before commit, whether snapped to a
    // wall or free-following. Re-applies the preview so the flip shows live.
    // No-op on a roof-segment face (those host front-only; nothing to flip).
    const onKeyDown = (e: KeyboardEvent) => {
      if (committed) return
      if (e.key !== 'r' && e.key !== 'R') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      // Only act where a flip is meaningful — on a wall hover or while
      // free-following. On a roof face leave it to the default R (no flip, no
      // sfx) so the cue never fires without a visible effect.
      const onWall = lastTarget !== null
      if (!(onWall || freeFollowing)) return
      e.preventDefault()
      sideOverride = sideOverride === 'front' ? 'back' : 'front'
      triggerSFX('sfx:item-rotate')
      if (onWall) {
        // On a wall: re-resolve with the flipped side and re-preview.
        const next = resolveMoveTarget(lastTarget!.event)
        if (next) {
          lastTarget = next
          applyPreview(next)
        }
      } else {
        // Free-following on the level: flip the draft's facing in place.
        useScene.getState().updateNode(movingDoorNode.id, {
          side: sideOverride,
          rotation: [0, sideOverride === 'back' ? Math.PI : 0, 0],
        })
      }
    }

    emitter.on('wall:enter', onWallEnter)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofHover)
    emitter.on('roof:move', onRoofHover)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', onRoofLeave)
    emitter.on('grid:move', onGridMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      const current = useScene.getState().nodes[movingDoorNode.id as AnyNodeId] as
        | DoorNode
        | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
        if (isNew) {
          useScene.getState().deleteNode(movingDoorNode.id)
          if (currentHostId) markHostDirty(currentHostId)
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
          if (original.parentId) markHostDirty(original.parentId)
        }
      }
      useLiveTransforms.getState().clear(movingDoorNode.id)
      useAlignmentGuides.getState().clear()
      clearOpeningGuides3D()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallEnter)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('roof:enter', onRoofHover)
      emitter.off('roof:move', onRoofHover)
      emitter.off('roof:click', onRoofClick)
      emitter.off('roof:leave', onRoofLeave)
      emitter.off('grid:move', onGridMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
      window.removeEventListener('keydown', onKeyDown)
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
  useEffect(() => () => edgesGeo.dispose(), [edgesGeo])

  return (
    <group ref={cursorGroupRef} visible={false}>
      <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
    </group>
  )
}

export default MoveDoorTool
