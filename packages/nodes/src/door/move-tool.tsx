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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { resolveOpeningPlacement } from '../shared/wall-attach-target'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'
import DoorPreview from './preview'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const MoveDoorTool: React.FC<{ node: DoorNode }> = ({ node: movingDoorNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  // The door preview ghost. Shown for the WHOLE move so the user always sees a
  // translucent door tinted by placement state — red off-wall or colliding,
  // green on a valid wall — exactly like the free-follow ghost. The real node
  // stays hidden until commit (the wall still cuts its hole from the node data,
  // so the opening reads correctly behind the ghost). `null` = not previewing
  // (committed / torn down). See the matching `DoorPreview` tint.
  const [ghostPose, setGhostPose] = useState<{
    position: [number, number, number]
    rotationY: number
    tint: 'valid' | 'invalid'
    // The door's facing side at the cursor. R-flip changes it mid-placement and
    // the door geometry's swing/hinge depends on it, so the ghost must rebuild
    // with the LIVE side — otherwise the preview shows the pre-flip orientation
    // while commit places the flipped one.
    side: DoorNode['side']
  } | null>(null)

  // Ghost preview node: the moving door with a zeroed transform + the live
  // facing side. `updateDoorMesh` bakes `position`/`rotation` into the mesh (the
  // `<group>` wrapper already places it, so we zero those to avoid a double
  // offset) and reads `side` for the swing/hinge direction — so the ghost
  // matches exactly what commit will place, including an R-flip. Falls back to
  // the moving node's own side when no pose is active.
  const ghostSide = ghostPose?.side ?? movingDoorNode.side
  const ghostNode = useMemo(
    () => ({
      ...movingDoorNode,
      side: ghostSide,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }),
    [movingDoorNode, ghostSide],
  )

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
      // Free-follow hides the node (visible:false); every revert path must
      // restore the original visibility or an existing door cancelled over open
      // floor would stay invisible.
      visible: movingDoorNode.visible,
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
    // Last open-floor cursor point (level-local X/Z), so an R-flip or Shift change
    // while free-following can re-run the ghost at the same spot with the new
    // facing/tint — no pointer move required.
    let lastFloorPoint: [number, number] | null = null
    // Live Shift state (force-place). Tracked here so the preview tint can be
    // re-evaluated when Shift is pressed/released with the pointer stationary —
    // the stored WallEvent carries a STALE shiftKey from the last move.
    let shiftHeld = false
    // Movement SFX: ONE soft `sfx:grid-snap` click each time the door crosses a
    // grid step — identical whether free-following over open floor or sliding
    // along a wall, so the two feel the same (the user's ask). Always keyed on
    // the RAW cursor position (continuous ~0.1m cadence), never the snapped
    // along-wall value, so the wall slide ticks at the same rate as the ghost.
    // Two guards prevent a doubled/flammed cue: `lastStepKey` (emit only when
    // the quantized cell changes) AND `lastTickFrame` (at most one tick per DOM
    // pointermove — a wall mesh can emit `wall:move` more than once per move, and
    // the grid + wall paths can both run). No separate snap cue: a distinct
    // floor→wall sound was the "double" the user heard.
    const STEP_M = 0.1
    let lastStepKey: string | null = null
    let lastTickFrame = -1
    const tickGridStep = (frame: number, ...coords: number[]) => {
      if (frame === lastTickFrame) return
      const key = coords.map((c) => Math.round(c / STEP_M)).join(',')
      if (key === lastStepKey) return
      lastStepKey = key
      lastTickFrame = frame
      triggerSFX('sfx:grid-snap')
    }
    // The door's chosen facing side. R flips it mid-placement (front ↔ back,
    // same as the committed-selected R flip) so the user can reorient before
    // committing. Initialised from the moving node's side.
    let sideOverride: DoorNode['side'] = movingDoorNode.side
    let lastTarget: {
      wallNode: WallEvent['node']
      wallId: string
      side: DoorNode['side']
      itemRotation: number
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
      setGhostPose(null)
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
      }
    }

    const resolveMoveTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      if (event.node.parentId !== getLevelId()) return

      const { side, itemRotation } = getPlacementOrientation(event)

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
        // Alt still hard-disables alignment (no guides). Shift = free-place:
        // land at the raw cursor but keep showing the alignment guides.
        bypass: event.nativeEvent?.altKey === true,
        freePlace: event.nativeEvent?.shiftKey === true,
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
        clampedX,
        clampedY,
        valid,
        event,
      }
    }

    const applyPreview = (target: NonNullable<typeof lastTarget>) => {
      // Same click as the off-wall ghost: one grid-snap tick per grid step,
      // keyed on the RAW cursor along-wall position (not the snapped clampedX,
      // whose ~0.5m jumps would tick at a different cadence). Per-frame guard
      // collapses any duplicate wall events on the same pointermove.
      tickGridStep(target.event.nativeEvent?.timeStamp ?? -1, target.event.localPosition[0])
      // Keep the REAL node hidden and show a tinted ghost in the wall opening —
      // green when placeable, red when it collides — the same translucent ghost
      // the free-follow uses, so validity reads at a glance. The node position is
      // still written (so the wall cuts the hole at the right spot) but
      // `visible:false` keeps the pale solid mesh from competing with the ghost.
      if (currentHostId !== target.wallId) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          parentId: target.wallId,
          wallId: target.wallId,
          roofSegmentId: undefined,
          roofFace: undefined,
          visible: false,
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

      // Position the tinted ghost at the wall opening (world frame), facing the
      // wall normal + the live side (so an R-flip shows correctly). The
      // wireframe cursor is no longer used on a wall. Tint comes from the SHARED
      // placement decision — green when placeable (incl. Shift force-place over a
      // collision), red otherwise — the SAME `placeable` the commit gate uses.
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      const placement = resolveOpeningPlacement({
        collides: !target.valid,
        forcePlace: shiftHeld,
      })
      // The committed door is a CHILD of the wall mesh (group yaw = -wallAngle)
      // with wall-local `itemRotation` (0 front / π back). The ghost is a
      // scene-root world-space group, so its world yaw must be
      // `-wallAngle + itemRotation` to face the same way as commit.
      // `cursorRotation` (the old symmetric-wireframe yaw) is π off here.
      const wallAngle = Math.atan2(
        target.wallNode.end[1] - target.wallNode.start[1],
        target.wallNode.end[0] - target.wallNode.start[0],
      )
      setGhostPose({
        position: wallLocalToWorld(
          target.wallNode,
          target.clampedX,
          target.clampedY,
          getLevelYOffset(),
          getSlabElevation(target.event),
        ),
        rotationY: target.itemRotation - wallAngle,
        tint: placement.tint,
        side: target.side,
      })

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
          // The moving node is hidden during free-follow; the committed door
          // must be visible regardless of the pre-commit free-follow state.
          visible: true,
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
          visible: original.visible,
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
          visible: true,
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
      // Shift force-places: commit even when the door overlaps another opening.
      // The preview keeps its red invalid tint as a warning; Shift just lifts the
      // commit block. Read shift from THIS event so it's never stale at commit.
      if (!target) return
      if (!target.valid && event.nativeEvent?.shiftKey !== true) return
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

    // Reveal the real door node + drop the ghost. Used by the roof-face path,
    // which previews with the real mesh (the ghost-tint flow is wall-specific).
    const revealRealNode = () => {
      setGhostPose(null)
      const live = useScene.getState().nodes[movingDoorNode.id as AnyNodeId] as DoorNode | undefined
      if (live && live.visible === false) {
        useScene.getState().updateNode(movingDoorNode.id, { visible: true })
      }
    }

    // Free-follow: over open floor there's no wall to host the door, so instead
    // of dragging the real (pale, near-invisible-on-grid) node around we hide it
    // and float a red translucent ghost at the cursor — same treatment the raw
    // `DoorTool` build path uses. The node still re-parents to the level so a
    // later wall-snap / commit has a clean base, but stays `visible:false` until
    // a wall is hovered.
    const freeFollowAt = (localX: number, localZ: number, frame: number) => {
      freeFollowing = true
      lastTarget = null
      lastRoofEvent = null
      // Click per grid cell as the ghost slides over open floor (X+Z) — the
      // same `tickGridStep` the on-wall slide uses, so both feel identical.
      tickGridStep(frame, localX, localZ)
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
          visible: false,
        })
        currentHostId = levelId
      } else {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: [localX, y, localZ],
          rotation: [0, yaw, 0],
          side: sideOverride,
          visible: false,
        })
      }
      // Float the red (invalid — no wall) ghost at the cursor, level-Y lifted so
      // it stands on the floor, matching the door's chosen facing (sideOverride
      // carries the R-flip so the ghost swing direction matches commit).
      setGhostPose({
        position: [localX, getLevelYOffset() + y, localZ],
        rotationY: yaw,
        tint: 'invalid',
        side: sideOverride,
      })
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
      lastFloorPoint = [x, z]
      freeFollowAt(x, z, event.nativeEvent?.timeStamp ?? -1)
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
      // On a roof face the real mesh is the preview — drop the free-follow ghost
      // and reveal the node.
      revealRealNode()
      if (currentHostId !== target.segment.id) {
        useScene.getState().updateNode(movingDoorNode.id, {
          position: target.position,
          rotation: [0, 0, 0],
          side: 'front',
          parentId: target.segment.id,
          wallId: undefined,
          roofSegmentId: target.segment.id,
          roofFace: target.face.id,
          visible: true,
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
      // Shift force-places over a colliding roof-face target too (see onWallClick).
      if (!target) return
      if (!target.valid && event.nativeEvent?.shiftKey !== true) return
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
          visible: true,
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
          visible: original.visible,
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
          visible: true,
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
          visible: original.visible,
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
      // target commits via commitToWall; a roof face via onRoofClick. Shift
      // force-places over a colliding wall target (the tint stays red as a
      // warning); read shift from this pointerup so it's current at commit.
      if (lastTarget && !freeFollowing && (lastTarget.valid || event.shiftKey)) {
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
      // Ignore OS key-repeat so a held R doesn't flip many times per press.
      if (e.repeat) return
      e.preventDefault()
      // ALWAYS toggle the persistent flip intent — never a no-op. (The old gate
      // dropped R before the first pointermove, so initial-placement R needed a
      // second press.) Then re-render whatever preview is current so the flip
      // shows live and matches what commit will write.
      sideOverride = sideOverride === 'front' ? 'back' : 'front'
      triggerSFX('sfx:item-rotate')
      if (lastTarget) {
        // On a wall: re-resolve with the flipped side and re-preview.
        const next = resolveMoveTarget(lastTarget.event)
        if (next) {
          lastTarget = next
          applyPreview(next)
        }
      } else if (lastFloorPoint) {
        // Free-following: re-run at the same spot so the floating ghost rebuilds
        // with the flipped side (its swing/hinge geometry depends on `side`).
        freeFollowAt(lastFloorPoint[0], lastFloorPoint[1], -1)
      } else {
        // No preview yet (R pressed before the first pointermove at initial
        // placement): flip the hidden node so the FIRST preview/commit already
        // reflects the chosen side.
        useScene.getState().updateNode(movingDoorNode.id, {
          side: sideOverride,
          rotation: [0, sideOverride === 'back' ? Math.PI : 0, 0],
        })
      }
    }

    // Shift toggles force-place. Track it live and re-run the on-wall preview so
    // the tint flips green↔red the instant Shift is pressed/released, even with
    // the pointer stationary — the ghost and the commit gate read the same
    // `placeable`. (Commit gates still read shift fresh from their own event.)
    const onShiftToggle = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      const held = e.type === 'keydown'
      if (held === shiftHeld) return
      shiftHeld = held
      if (!committed && lastTarget) applyPreview(lastTarget)
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
    window.addEventListener('keydown', onShiftToggle)
    window.addEventListener('keyup', onShiftToggle)

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
            visible: original.visible,
          })
          if (original.parentId) markHostDirty(original.parentId)
        }
      } else if (current && current.visible === false) {
        // Safety net: a fresh (isNew) clone isn't marked `isTransient`, so the
        // branch above skips it. If we unmount mid-free-follow it would be left
        // hidden — reveal it so it never becomes an invisible orphan. (The
        // `place-preset` movingNode subscription deletes a truly-cancelled
        // clone separately.)
        useScene.getState().updateNode(movingDoorNode.id, { visible: true })
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
      window.removeEventListener('keydown', onShiftToggle)
      window.removeEventListener('keyup', onShiftToggle)
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
    <>
      <group ref={cursorGroupRef} visible={false}>
        <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
      </group>
      {/* Placement ghost shown for the whole move (the real pale node stays
          hidden): red off-wall / colliding, green on a valid wall. Uses the
          moving node's own dimensions so the ghost matches its type. */}
      {ghostPose && (
        <group position={ghostPose.position} rotation-y={ghostPose.rotationY}>
          <DoorPreview
            invalid={ghostPose.tint === 'invalid'}
            node={ghostNode}
            valid={ghostPose.tint === 'valid'}
          />
        </group>
      )}
    </>
  )
}

export default MoveDoorTool
