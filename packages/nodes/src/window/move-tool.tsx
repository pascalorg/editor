import {
  type AnyNodeId,
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
  WindowNode,
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
  snapToHalf,
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
  resolveSillSnap,
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
import { WindowFloorProjection } from './floor-projection'
import WindowPreview from './preview'
import {
  clampToWall,
  DEFAULT_WINDOW_SILL_M,
  hasWallChildOverlap,
  wallLocalToWorld,
} from './window-math'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

/**
 * Move/duplicate tool for WindowNodes — wall-only, same guardrails as WindowTool.
 *
 * Move mode (metadata.isNew falsy):
 *   Adopts the existing window, pauses temporal. On commit: restores original state
 *   (clean undo baseline) then resumes + updateNode (undo reverts to original position).
 *   On cancel: restores original state.
 *
 * Duplicate mode (metadata.isNew = true):
 *   The node is a freshly created transient copy. On commit: deletes transient + resumes
 *   + createNode (undo removes the new window entirely). On cancel: deletes the node.
 */
const MoveWindowTool: React.FC<{ node: WindowNode }> = ({ node: movingWindowNode }) => {
  const cursorGroupRef = useRef<Group>(null!)

  // The window preview ghost. Shown for the WHOLE move so the user always sees
  // a translucent window tinted by placement state — red off-wall or colliding,
  // green on a valid wall. The real node stays hidden until commit (the wall
  // still cuts its hole from the node data). `null` = not previewing. See the
  // matching `WindowPreview` tint and `MoveDoorTool` for the full rationale.
  const [ghostPose, setGhostPose] = useState<{
    position: [number, number, number]
    rotationY: number
    tint: 'valid' | 'invalid'
    // Level floor world-Y, for the floor "shadow" projection (drop-line + footprint).
    floorY: number
    // Live facing side — R-flip changes it and the window geometry depends on it,
    // so the ghost must rebuild with the live side (see `MoveDoorTool`).
    side: WindowNode['side']
  } | null>(null)

  // Ghost preview node: the moving window with a zeroed transform + the live
  // facing side (the ghost is positioned by the `<group position>` wrapper;
  // `updateWindowMesh` bakes the node's own position/rotation in, so passing the
  // live node would double-offset). Rebuilds on an R-flip so the preview matches
  // what commit will place.
  const ghostSide = ghostPose?.side ?? movingWindowNode.side
  const ghostNode = useMemo(
    () => ({
      ...movingWindowNode,
      side: ghostSide,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }),
    [movingWindowNode, ghostSide],
  )

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    const meta =
      typeof movingWindowNode.metadata === 'object' && movingWindowNode.metadata !== null
        ? (movingWindowNode.metadata as Record<string, unknown>)
        : {}
    const isNew = !!meta.isNew

    // Save original state (only used in move mode)
    const original = {
      position: [...movingWindowNode.position] as [number, number, number],
      rotation: [...movingWindowNode.rotation] as [number, number, number],
      side: movingWindowNode.side,
      parentId: movingWindowNode.parentId,
      wallId: movingWindowNode.wallId,
      // Windows can be hosted on a roof-segment wall face. Moving onto a
      // wall re-anchors as wall-hosted (roofSegmentId cleared); reverts
      // must restore the roof host.
      roofSegmentId: movingWindowNode.roofSegmentId,
      roofFace: movingWindowNode.roofFace,
      metadata: movingWindowNode.metadata,
      // Free-follow hides the node (visible:false); revert paths restore this.
      visible: movingWindowNode.visible,
    }

    // In move mode (existing window) mark it transient so its mesh skips the live wall CSG
    // rebuild while repositioning — the editor requests a final rebuild on commit. For a new
    // placement (preset/duplicate) we must NOT mark it transient: WindowSystem only rebuilds
    // the host wall's cutout for non-transient windows, so a transient draft shows no live
    // preview on the wall and can't be placed consecutively without leaving/re-entering. This
    // mirrors MoveDoorTool.
    if (!isNew) {
      useScene.getState().updateNode(movingWindowNode.id, {
        metadata: { ...meta, isTransient: true },
      })
    }

    let currentHostId: string | null = movingWindowNode.parentId
    let committed = false
    // Off-wall free-follow: over empty floor the window is parented to the
    // level and tracks the cursor like an item. `freeFollowing` marks that state.
    let freeFollowing = false
    // Last open-floor cursor point (level-local X/Z), so an R-flip while free-
    // following can re-run the ghost at the same spot with the new facing.
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
    // Live Alt state (force-place) — lets the preview tint re-evaluate when
    // Alt is pressed/released with the pointer stationary (see `MoveDoorTool`).
    let altHeld = false
    // Movement SFX: ONE soft `sfx:grid-snap` click each time the window's PLACED
    // position crosses a step. Keyed on the SNAPPED value (passed by the caller),
    // quantized by the live grid step in grid mode, else a gentle fixed cadence —
    // so grid mode ticks once per cell (not on every micro mouse-move while the
    // window sits in a cell) while lines/off still tick as the window moves.
    // Guards: `lastStepKey` (cell change) + `lastTickFrame` (one per pointermove).
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
    // The window's chosen facing side. R flips it mid-placement (front ↔ back),
    // matching the committed-selected R flip. Initialised from the moving node.
    let sideOverride: WindowNode['side'] = movingWindowNode.side
    let dragAnchor: {
      wallId: string
      rawX: number
      rawY: number
      startX: number
      startY: number
    } | null = null
    // The wall the window was grabbed from. Nulled the first time the anchor
    // seeds on any other host: the grab offset is then forgotten for good.
    let grabWallId: string | null = movingWindowNode.parentId
    let lastTarget: {
      wallNode: WallEvent['node']
      wallId: string
      side: WindowNode['side']
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

    // Sill-center height used while the window isn't on a wall (free-follow and
    // proximity). Fresh preset clones are created at position [0,0,0], which
    // would bury half the window below the floor; default such windows to a
    // small sill so the ghost floats slightly above the ground. An existing
    // window keeps its own sill.
    const getSillCenterY = () => {
      const y = movingWindowNode.position[1]
      return y > 0.1 ? y : DEFAULT_WINDOW_SILL_M + movingWindowNode.height / 2
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
    // line up with furniture on the floor. The moving window is excluded.
    const alignmentCandidates = collectWallOpeningAlignmentCandidates(
      useScene.getState().nodes,
      movingWindowNode.id,
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

    const resolveMoveTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) return
      if (isCurvedWall(event.node)) {
        hideCursor()
        return
      }
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) return

      const faceSide = getSideFromNormal(event.normal)
      const side = sideOverride ?? faceSide
      const rotationOffset = side !== faceSide ? Math.PI : 0
      const itemRotation = calculateItemRotation(event.normal) + rotationOffset

      const rawLocalX = event.localPosition[0]
      const rawLocalY = event.localPosition[1]
      if (!dragAnchor || dragAnchor.wallId !== event.node.id) {
        // Grab offset survives only on the original wall and only until the
        // window anchors on any other host — after that every wall (the
        // original included) centers the window under the cursor.
        const preserveGrab = event.node.id === grabWallId
        if (!preserveGrab) grabWallId = null
        dragAnchor = {
          wallId: event.node.id,
          rawX: rawLocalX,
          rawY: rawLocalY,
          startX: preserveGrab ? original.position[0] : rawLocalX,
          startY: preserveGrab ? original.position[1] : snapToHalf(rawLocalY),
        }
      }
      const targetLocalX = dragAnchor.startX + (rawLocalX - dragAnchor.rawX)
      const targetRawLocalY = dragAnchor.startY + (rawLocalY - dragAnchor.rawY)
      // Vertical sill alignment (snap + guide) is the magnetic ("lines")
      // component for Y: a sibling's sill/centre/top wins over the grid when
      // within threshold, so it runs only when magnetic snap is on; otherwise
      // the mode-aware `snapToHalf` decides Y.
      const sillSnapped = isMagneticSnapActive()
        ? resolveSillSnap({
            wall: event.node,
            movingId: movingWindowNode.id,
            localX: targetLocalX,
            localY: targetRawLocalY,
            width: movingWindowNode.width,
            height: movingWindowNode.height,
            nodes: useScene.getState().nodes,
          })
        : null
      const targetLocalY = sillSnapped ?? snapToHalf(targetRawLocalY)
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: targetLocalX,
        width: movingWindowNode.width,
        candidates: alignmentCandidates,
        // Along-wall alignment guides display in every snapping mode; the
        // magnetic pull onto them lands only in "lines" mode. The grid
        // component lives in `snapToHalf` (itself mode-aware).
        applySnap: isMagneticSnapActive(),
      })
      const { clampedX, clampedY } = clampToWall(
        event.node,
        localX,
        targetLocalY,
        movingWindowNode.width,
        movingWindowNode.height,
      )

      const valid = !hasWallChildOverlap(
        event.node.id,
        clampedX,
        clampedY,
        movingWindowNode.width,
        movingWindowNode.height,
        movingWindowNode.id,
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
      // One grid-snap tick per real ALONG-WALL step, keyed on the snapped
      // `clampedX` only — NOT the sill `clampedY`, which tracks the cursor's
      // vertical position on the wall face and so re-keys on every micro
      // mouse-move even when the window stays in the same along-wall cell.
      // Per-frame guard collapses duplicate wall events on the same pointermove.
      tickGridStep(target.event.nativeEvent?.timeStamp ?? -1, target.clampedX)
      // Keep the REAL node hidden and show a tinted ghost in the wall opening —
      // green when placeable, red when it collides — matching the free-follow
      // ghost so validity reads at a glance (see MoveDoorTool). The node position
      // is still written so the wall cuts the hole at the right spot.
      if (currentHostId !== target.wallId) {
        useScene.getState().updateNode(movingWindowNode.id, {
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
        const windowMesh = sceneRegistry.nodes.get(movingWindowNode.id as AnyNodeId)
        if (windowMesh) {
          windowMesh.position.set(target.clampedX, target.clampedY, 0)
          windowMesh.rotation.set(0, target.itemRotation, 0)
          windowMesh.updateMatrixWorld(true)
        }
      }
      useLiveTransforms.getState().set(movingWindowNode.id, {
        position: [target.clampedX, target.clampedY, 0],
        rotation: target.itemRotation,
      })
      markHostDirtyThrottled(target.wallId)

      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      const placement = resolveOpeningPlacement({ collides: !target.valid, forcePlace: altHeld })
      // Ghost world yaw must equal the committed wall-CHILD's world yaw
      // (-wallAngle + itemRotation); `cursorRotation` is π off here. See
      // `MoveDoorTool.applyPreview`.
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
        floorY: getLevelYOffset() + getSlabElevation(target.event),
        side: target.side,
      })
      // Forward-facing triangle (editor-side overlay), in the same building-local
      // frame the ghost renders in. The window's front is its local +Z. Drop it
      // to the floor under the wall (the ghost Y is the sill centre, up the wall).
      useFacingPose.getState().set({
        position: [
          ghostWorldPos[0],
          getLevelYOffset() + getSlabElevation(target.event),
          ghostWorldPos[2],
        ],
        rotationY: ghostYaw,
        depth: movingWindowNode.frameDepth ?? 0.07,
      })
      // Publish the wall surface so the snap grid tilts into the wall plane at
      // the opening (its outward normal is the window's facing, +Z by `ghostYaw`).
      publishPlacementSurface(
        new Vector3(...ghostWorldPos),
        new Vector3(Math.sin(ghostYaw), 0, Math.cos(ghostYaw)),
      )

      publishOpeningGuidesForWallEvent({
        wall: target.wallNode,
        movingId: movingWindowNode.id,
        centerS: target.clampedX,
        centerY: target.clampedY,
        width: movingWindowNode.width,
        height: movingWindowNode.height,
        includeVertical: true,
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
      // Only interact with walls on the current level
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

    // Promote the moving window into its committed wall placement. Shared by
    // the direct wall-mesh click and the floor proximity click.
    const commitToWall = (target: NonNullable<typeof lastTarget>) => {
      if (committed) return
      committed = true

      let placedId: string

      if (isNew) {
        // Duplicate mode: delete transient + resume + createNode
        // Undo will remove the newly created node entirely
        useScene.getState().deleteNode(movingWindowNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingWindowNode) as any
        delete cloned.id
        cloned.metadata = stripPlacementMetadataFlags(cloned.metadata)

        const node = WindowNode.parse({
          ...cloned,
          position: [target.clampedX, target.clampedY, 0],
          rotation: [0, target.itemRotation, 0],
          side: target.side,
          wallId: target.wallId,
          parentId: target.wallId,
          roofSegmentId: undefined,
          roofFace: undefined,
          // Hidden during free-follow; the committed window must be visible.
          visible: true,
        })
        useScene.getState().createNode(node, target.wallId as AnyNodeId)
        placedId = node.id
      } else {
        // Move mode: restore original (clean baseline) + resume + updateNode
        // Undo will revert to the original position
        useScene.getState().updateNode(movingWindowNode.id, {
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

        useScene.getState().updateNode(movingWindowNode.id, {
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
        placedId = movingWindowNode.id
      }

      markHostDirty(target.wallId)
      useLiveTransforms.getState().clear(movingWindowNode.id)
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
      // Only interact with walls on the current level
      if (event.node.parentId !== getLevelId()) return

      const target = lastTarget?.wallId === event.node.id ? lastTarget : resolveMoveTarget(event)
      // Alt force-places: commit even when the window overlaps another opening.
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
      // pointermove: it snaps to a nearby wall or free-follows the cursor, so
      // the window never blinks back to the building origin between a wall and
      // open floor. Revert is left to free-follow / cancel / commit.
      hideCursor()
      useLiveTransforms.getState().clear(movingWindowNode.id)
      dragAnchor = null
      lastTarget = null
      lastRoofEvent = null
    }

    // Reveal the real window node + drop the ghost. Used by the roof-face path,
    // which previews with the real mesh (the ghost-tint flow is wall-specific).
    const revealRealNode = () => {
      setGhostPose(null)
      useFacingPose.getState().clear()
      clearPlacementSurface()
      const live = useScene.getState().nodes[movingWindowNode.id as AnyNodeId] as
        | WindowNode
        | undefined
      if (live && live.visible === false) {
        useScene.getState().updateNode(movingWindowNode.id, { visible: true })
      }
    }

    // Free-follow: over open floor there's no wall to host the window, so hide
    // the real (pale, near-invisible-on-grid) node and float a red translucent
    // ghost at the cursor — same treatment the raw `WindowTool` build path uses.
    const freeFollowAt = (localX: number, localZ: number) => {
      freeFollowing = true
      lastTarget = null
      lastRoofEvent = null
      // No snap SFX here: the free-follow fires off-wall (an invalid red ghost,
      // not a placeable position) AND interleaves with the on-wall slide on the
      // same pointer move (R3F `wall:move` and DOM `grid:move` carry different
      // timestamps, so the de-dupe guard can't merge them). Emitting here was the
      // source of the constant click while sliding a window along a wall — the
      // on-wall `applyPreview` already ticks once per along-wall cell.
      hideCursor()
      useLiveTransforms.getState().clear(movingWindowNode.id)
      const levelId = getLevelId()
      const sillCenterY = getSillCenterY()
      // Keep the R-flip visible while free-following (back = rotated π).
      const yaw = sideOverride === 'back' ? Math.PI : 0
      if (currentHostId !== levelId) {
        if (currentHostId && currentHostId !== levelId) markHostDirty(currentHostId)
        useScene.getState().updateNode(movingWindowNode.id, {
          position: [localX, sillCenterY, localZ],
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
        useScene.getState().updateNode(movingWindowNode.id, {
          position: [localX, sillCenterY, localZ],
          rotation: [0, yaw, 0],
          side: sideOverride,
          visible: false,
        })
      }
      // Float the red (invalid — no wall) ghost at the cursor, level-Y lifted to
      // the sill center (sideOverride carries the R-flip so the ghost matches).
      setGhostPose({
        position: [localX, getLevelYOffset() + sillCenterY, localZ],
        rotationY: yaw,
        tint: 'invalid',
        floorY: getLevelYOffset(),
        side: sideOverride,
      })
      // Off-wall (no host) floating ghost — no direction triangle, no wall grid.
      useFacingPose.getState().clear()
      clearPlacementSurface()
    }

    const onGridMove = (event: GridEvent) => {
      if (committed) return
      if (useViewer.getState().cameraDragging) return
      // A wall/roof handler owns the pointer right now — the cursor ray is on a
      // wall/roof that snaps, so skip the floor follow (see `wallOwnsPointer`).
      if (wallOwnsPointer()) return
      const [x, , z] = event.localPosition
      lastFloorPoint = [x, z]
      freeFollowAt(x, z)
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // Mirrors the wall flow for the segments' vertical wall faces (base
    // walls under the roof + coplanar gable ends — a window can sit in
    // the gable pediment). This is also the placement path preset tiles
    // take (`metadata.isNew` clones).

    const resolveRoofMoveTarget = (event: RoofEvent) =>
      resolveRoofWallOpeningTarget({
        event,
        width: movingWindowNode.width,
        height: movingWindowNode.height,
        ignoreId: movingWindowNode.id,
        vertical: {
          kind: 'free',
          // `snapToHalf` is mode-aware (raw cursor when grid snap is off).
          snap: snapToHalf,
        },
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
      // Wall-frame drag anchor / live transform don't apply on a roof face —
      // and anchoring here counts as "elsewhere", so the original wall's grab
      // offset is forgotten for good.
      freeFollowing = false
      dragAnchor = null
      grabWallId = null
      lastTarget = null
      lastRoofEvent = event
      useLiveTransforms.getState().clear(movingWindowNode.id)
      // Opening guides are wall-specific; clear them when over a roof face.
      clearOpeningGuides3D()
      // On a roof face the real mesh is the preview — drop the ghost + reveal.
      revealRealNode()
      if (currentHostId !== target.segment.id) {
        useScene.getState().updateNode(movingWindowNode.id, {
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
        useScene.getState().updateNode(movingWindowNode.id, {
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
        useScene.getState().deleteNode(movingWindowNode.id)
        useScene.temporal.getState().resume()

        const cloned = structuredClone(movingWindowNode) as any
        delete cloned.id
        cloned.metadata = stripPlacementMetadataFlags(cloned.metadata)

        const node = WindowNode.parse({
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
        useScene.getState().updateNode(movingWindowNode.id, {
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

        useScene.getState().updateNode(movingWindowNode.id, {
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
        placedId = movingWindowNode.id
      }

      markHostDirty(segmentId)
      useLiveTransforms.getState().clear(movingWindowNode.id)
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
      useLiveTransforms.getState().clear(movingWindowNode.id)
      dragAnchor = null
      lastTarget = null
      lastRoofEvent = null
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(movingWindowNode.id)
      if (isNew) {
        useScene.getState().deleteNode(movingWindowNode.id)
        if (currentHostId) markHostDirty(currentHostId)
      } else {
        useScene.getState().updateNode(movingWindowNode.id, {
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
      // force-places over a colliding wall target (tint stays red as a warning);
      // read alt from this pointerup so it's current at commit.
      if (lastTarget && !freeFollowing && (lastTarget.valid || event.altKey)) {
        commitToWall(lastTarget)
        return
      }
      if (lastRoofEvent) onRoofClick(lastRoofEvent)
    }

    // R flips the window's facing side mid-placement (front ↔ back), like the
    // committed-selected R flip — usable before commit, whether snapped to a
    // wall or free-following. No-op on a roof-segment face (front-only host).
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
      // ALWAYS toggle the persistent flip intent — never a no-op (the old gate
      // dropped R before the first pointermove). Then re-render the current
      // preview so the flip shows live and matches commit. See `MoveDoorTool`.
      sideOverride = sideOverride === 'front' ? 'back' : 'front'
      triggerSFX('sfx:item-rotate')
      if (lastTarget) {
        const next = resolveMoveTarget(lastTarget.event)
        if (next) {
          lastTarget = next
          applyPreview(next)
        }
      } else if (lastFloorPoint) {
        // Free-following: re-run at the same spot so the floating ghost rebuilds
        // with the flipped side.
        freeFollowAt(lastFloorPoint[0], lastFloorPoint[1])
      } else {
        // No preview yet (R before the first pointermove): flip the hidden node
        // so the first preview/commit already reflects the chosen side.
        useScene.getState().updateNode(movingWindowNode.id, {
          side: sideOverride,
          rotation: [0, sideOverride === 'back' ? Math.PI : 0, 0],
        })
      }
    }

    // Alt toggles force-place — re-run the on-wall preview so the tint flips
    // green↔red live (pointer stationary). Commit gates still read alt fresh.
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
    // Only applies to a window already hosted on a wall (not a fresh placement or
    // a roof-segment host).
    if (!isNew && movingWindowNode.wallId) {
      const hostWall = useScene.getState().nodes[movingWindowNode.wallId as AnyNodeId]
      if (hostWall?.type === 'wall') {
        const wallAngle = Math.atan2(
          hostWall.end[1] - hostWall.start[1],
          hostWall.end[0] - hostWall.start[0],
        )
        const ghostYaw = movingWindowNode.rotation[1] - wallAngle
        const seedPos = wallLocalToWorld(
          hostWall,
          movingWindowNode.position[0],
          movingWindowNode.position[1],
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
        // the first frames after grab. Otherwise the first `grid:move` (the window
        // mesh occludes the wall under the cursor, so no `wall:move` fires yet)
        // takes the off-wall branch and clears the seeded surface — the grid would
        // flash back to horizontal before `wall:move` re-publishes the vertical one.
        markWallOwnedPointer()
      }
    }

    return () => {
      // Safety cleanup: if still transient on unmount (e.g. phase switch mid-move)
      const current = useScene.getState().nodes[movingWindowNode.id as AnyNodeId] as
        | WindowNode
        | undefined
      const currentMeta = current?.metadata as Record<string, unknown> | undefined
      if (currentMeta?.isTransient) {
        if (isNew) {
          useScene.getState().deleteNode(movingWindowNode.id)
          if (currentHostId) markHostDirty(currentHostId)
        } else {
          useScene.getState().updateNode(movingWindowNode.id, {
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
        // Safety net: a fresh (isNew) clone isn't marked `isTransient`; if we
        // unmount mid-free-follow it would be left hidden. Reveal it so it never
        // becomes an invisible orphan (place-preset deletes a true cancel).
        useScene.getState().updateNode(movingWindowNode.id, { visible: true })
      }
      useLiveTransforms.getState().clear(movingWindowNode.id)
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
  }, [movingWindowNode, exitMoveMode])

  const edgesGeo = useMemo(() => {
    const boxGeo = new BoxGeometry(
      movingWindowNode.width,
      movingWindowNode.height,
      movingWindowNode.frameDepth ?? 0.07,
    )
    const geo = new EdgesGeometry(boxGeo)
    boxGeo.dispose()
    return geo
  }, [movingWindowNode])
  useEffect(() => () => edgesGeo.dispose(), [edgesGeo])

  return (
    <>
      <group ref={cursorGroupRef} visible={false}>
        <lineSegments geometry={edgesGeo} layers={EDITOR_LAYER} material={edgeMaterial} />
      </group>
      {/* Placement ghost shown for the whole move (the real pale node stays
          hidden): red off-wall / colliding, green on a valid wall. */}
      {ghostPose && (
        <group position={ghostPose.position} rotation-y={ghostPose.rotationY}>
          <WindowPreview
            invalid={ghostPose.tint === 'invalid'}
            node={ghostNode}
            valid={ghostPose.tint === 'valid'}
          />
        </group>
      )}
      {/* Floor "shadow" projection: footprint + dashed drop-line, so an elevated
          window's plan position is legible while placing. World-space, so it's a
          sibling of the ghost group, not a child. */}
      {ghostPose && (
        <WindowFloorProjection
          centerX={ghostPose.position[0]}
          centerY={ghostPose.position[1]}
          centerZ={ghostPose.position[2]}
          floorY={ghostPose.floorY}
          rotationY={ghostPose.rotationY}
          width={movingWindowNode.width}
        />
      )}
    </>
  )
}

export default MoveWindowTool
