import {
  type AnyNodeId,
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
  clearPlacementSurface,
  consumePlacementDragRelease,
  EDITOR_LAYER,
  getSideFromNormal,
  isGridSnapActive,
  isMagneticSnapActive,
  isValidWallSideFace,
  publishPlacementSurface,
  stripPlacementMetadataFlags,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, Vector3 } from 'three'
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
import {
  collectWallOpeningAlignmentCandidates,
  resolveWallSlideAlignment,
} from '../shared/wall-opening-alignment'
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
    // commit no-ops in open space (a door needs a wall).
    let freeFollowing = false
    // Last open-floor cursor point (level-local X/Z), so an R-flip or Alt change
    // while free-following can re-run the ghost at the same spot with the new
    // facing/tint — no pointer move required.
    let lastFloorPoint: [number, number] | null = null
    // The floor free-follow (`grid:move`, a DOM event) and the wall/roof snap
    // (`wall:move`/`roof:move`, R3F mesh events) are INDEPENDENT event streams
    // with different clocks, so the old `event.timeStamp` de-dup never matched —
    // the free-follow ran during on-wall slides too, and both wrote the scene
    // node every frame (a per-frame `nodes` churn that tanked 2D + 3D framerate).
    // Instead, stamp one monotonic clock whenever a wall/roof hit owns the
    // pointer; the floor handler stands down while that stamp is fresh. `wall:move`
    // fires every frame on-wall, so the stamp stays fresh across the pointermove
    // interval and the free-follow only re-engages once the cursor is off any wall.
    let wallOwnedPointerAt = Number.NEGATIVE_INFINITY
    // ~4 frames: comfortably longer than the pointermove interval (so a fast
    // on-wall slide never lets the floor follow slip through) yet short enough
    // that leaving a wall re-engages the free-follow without a perceptible stick.
    const WALL_OWNS_POINTER_MS = 64
    const markWallOwnedPointer = () => {
      wallOwnedPointerAt = performance.now()
    }
    const wallOwnsPointer = () => performance.now() - wallOwnedPointerAt < WALL_OWNS_POINTER_MS
    // Live Alt state (force-place). Tracked here so the preview tint can be
    // re-evaluated when Alt is pressed/released with the pointer stationary —
    // the stored WallEvent carries a STALE altKey from the last move.
    let altHeld = false
    // Movement SFX: ONE soft `sfx:grid-snap` click each time the door's PLACED
    // position crosses a step. Keyed on the SNAPPED value (passed by the caller),
    // quantized by the live grid step in grid mode, else a gentle fixed cadence —
    // so grid mode ticks once per cell (not on every micro mouse-move while the
    // door sits in a cell) while lines/off still tick as the door moves. Two
    // guards prevent a doubled cue: `lastStepKey` (cell change) + `lastTickFrame`
    // (one per pointermove — wall + grid paths can both run on the same move).
    const FREE_STEP_M = 0.1
    let lastStepKey: string | null = null
    let lastTickFrame = -1
    const tickGridStep = (frame: number, ...coords: number[]) => {
      if (frame === lastTickFrame) return
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : FREE_STEP_M
      const key = coords.map((c) => Math.round(c / step)).join(',')
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
      if (now - last > 60) {
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
      useFacingPose.getState().clear()
      clearPlacementSurface()
    }

    // Alignment candidates — only OTHER things on a wall (sibling openings +
    // wall-mounted items), never ground objects, so the along-wall guides don't
    // line up with furniture on the floor. The moving door is excluded.
    const alignmentCandidates = collectWallOpeningAlignmentCandidates(
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
        // Along-wall alignment follows the magnetic ("lines") mode; the grid
        // component lives in `snapToHalf` (itself mode-aware).
        bypass: !isMagneticSnapActive(),
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
      // One grid-snap tick per real position step, keyed on the SNAPPED
      // along-wall position so it ticks only when the door actually moves to a
      // new cell (not on every micro mouse-move). Per-frame guard collapses any
      // duplicate wall events on the same pointermove.
      tickGridStep(target.event.nativeEvent?.timeStamp ?? -1, target.clampedX)
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
      // placement decision — green when placeable (incl. Alt force-place over a
      // collision), red otherwise — the SAME `placeable` the commit gate uses.
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      const placement = resolveOpeningPlacement({
        collides: !target.valid,
        forcePlace: altHeld,
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
      const ghostWorldPos = wallLocalToWorld(
        target.wallNode,
        target.clampedX,
        target.clampedY,
        getLevelYOffset(),
        getSlabElevation(target.event),
      )
      const ghostYaw = target.itemRotation - wallAngle
      setGhostPose({
        position: ghostWorldPos,
        rotationY: ghostYaw,
        tint: placement.tint,
        side: target.side,
      })
      // Forward-facing triangle (editor-side overlay), in the same building-local
      // frame the ghost renders in. The door's front is its local +Z. Drop it to
      // the floor under the wall (the ghost Y is the opening centre, ~1m up).
      useFacingPose.getState().set({
        position: [
          ghostWorldPos[0],
          getLevelYOffset() + getSlabElevation(target.event),
          ghostWorldPos[2],
        ],
        rotationY: ghostYaw,
        depth: movingDoorNode.frameDepth ?? 0.07,
      })
      // Publish the wall surface so the snap grid tilts into the wall plane at
      // the opening (its outward normal is the door's facing, +Z by `ghostYaw`).
      publishPlacementSurface(
        new Vector3(...ghostWorldPos),
        new Vector3(Math.sin(ghostYaw), 0, Math.cos(ghostYaw)),
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
      const target = resolveMoveTarget(event)
      if (!target) {
        onWallLeave()
        return
      }
      // Valid wall hit owns the pointer for the next few frames; the floor
      // free-follow stands down until the cursor genuinely leaves the wall.
      markWallOwnedPointer()
      freeFollowing = false
      lastTarget = target
      lastRoofEvent = null
      applyPreview(target)
      event.stopPropagation()
    }

    const onWallMove = (event: WallEvent) => {
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
      // Valid wall hit owns the pointer for the next few frames; the floor
      // free-follow stands down until the cursor genuinely leaves the wall.
      markWallOwnedPointer()
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
      // Alt force-places: commit even when the door overlaps another opening.
      // The preview keeps its red invalid tint as a warning; Alt just lifts the
      // commit block. Read alt from THIS event so it's never stale at commit.
      if (!target) return
      if (!target.valid && event.nativeEvent?.altKey !== true) return
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
      useFacingPose.getState().clear()
      clearPlacementSurface()
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
    const freeFollowAt = (localX: number, localZ: number) => {
      freeFollowing = true
      lastTarget = null
      lastRoofEvent = null
      // No snap SFX here: the free-follow fires off-wall (an invalid red ghost,
      // not a placeable position) AND interleaves with the on-wall slide on the
      // same pointer move (R3F `wall:move` and DOM `grid:move` carry different
      // timestamps, so the de-dupe guard can't merge them). Emitting here was the
      // source of the constant click while sliding a door along a wall — the
      // on-wall `applyPreview` already ticks once per along-wall cell.
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
      // Off-wall (no host) floating ghost — no direction triangle, no wall grid.
      useFacingPose.getState().clear()
      clearPlacementSurface()
    }

    const onGridMove = (event: GridEvent) => {
      if (committed) return
      if (useViewer.getState().cameraDragging) return
      // No proximity magnet: in 3D the wall side faces are big raycast targets,
      // so snapping engages only when the cursor ray actually hovers a wall
      // (`onWallMove`). A wall/roof handler owning the pointer right now means the
      // cursor is on a wall/roof that snaps — skip the floor follow (see
      // `wallOwnsPointer`). Over open floor the door just follows the cursor.
      if (wallOwnsPointer()) return
      const [x, , z] = event.localPosition
      lastFloorPoint = [x, z]
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
      const target = resolveRoofMoveTarget(event)
      if (!target) {
        onRoofLeave()
        return
      }
      // Valid roof hit owns the pointer for the next few frames; the floor
      // free-follow stands down until the cursor genuinely leaves the roof.
      markWallOwnedPointer()
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
      // Alt force-places over a colliding roof-face target too (see onWallClick).
      if (!target) return
      if (!target.valid && event.nativeEvent?.altKey !== true) return
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
      // target commits via commitToWall; a roof face via onRoofClick. Alt
      // force-places over a colliding wall target (the tint stays red as a
      // warning); read alt from this pointerup so it's current at commit.
      if (lastTarget && !freeFollowing && (lastTarget.valid || event.altKey)) {
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
        freeFollowAt(lastFloorPoint[0], lastFloorPoint[1])
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

    // Alt toggles force-place. Track it live and re-run the on-wall preview so
    // the tint flips green↔red the instant Alt is pressed/released, even with
    // the pointer stationary — the ghost and the commit gate read the same
    // `placeable`. (Commit gates still read alt fresh from their own event.)
    const onAltToggle = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      const held = e.type === 'keydown'
      if (held === altHeld) return
      altHeld = held
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
    window.addEventListener('keydown', onAltToggle)
    window.addEventListener('keyup', onAltToggle)

    // Seed the wall snap surface on mount so the grid tilts into the wall on the
    // FIRST frame — before any pointer move. Without it the grid briefly shows
    // the moving node's horizontal fallback until the first `wall:move` publishes.
    // Only applies to a door already hosted on a wall (not a fresh placement or a
    // roof-segment host).
    if (!isNew && movingDoorNode.wallId) {
      const hostWall = useScene.getState().nodes[movingDoorNode.wallId as AnyNodeId]
      if (hostWall?.type === 'wall') {
        const wallAngle = Math.atan2(
          hostWall.end[1] - hostWall.start[1],
          hostWall.end[0] - hostWall.start[0],
        )
        const ghostYaw = movingDoorNode.rotation[1] - wallAngle
        const seedPos = wallLocalToWorld(
          hostWall,
          movingDoorNode.position[0],
          movingDoorNode.position[1],
          getLevelYOffset(),
          spatialGridManager.getSlabElevationForWall(
            hostWall.parentId ?? '',
            hostWall.start,
            hostWall.end,
          ),
        )
        publishPlacementSurface(
          new Vector3(...seedPos),
          new Vector3(Math.sin(ghostYaw), 0, Math.cos(ghostYaw)),
        )
        // Claim the pointer for the wall so the floor free-follow stands down for
        // the first frames after grab. Otherwise the first `grid:move` (the door
        // mesh occludes the wall under the cursor, so no `wall:move` fires yet)
        // takes the off-wall branch and clears the seeded surface — the grid would
        // flash back to horizontal before `wall:move` re-publishes the vertical one.
        markWallOwnedPointer()
      }
    }

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
      useFacingPose.getState().clear()
      clearPlacementSurface()
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
      window.removeEventListener('keydown', onAltToggle)
      window.removeEventListener('keyup', onAltToggle)
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
