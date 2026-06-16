import {
  type AnyNodeId,
  collectAlignmentAnchors,
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
  consumePlacementDragRelease,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  snapToHalf,
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
  resolveSillSnap,
} from '../shared/opening-guides-runtime'
import {
  getRoofWallOpeningCursorPose,
  type RoofWallOpeningTarget,
  resolveRoofWallOpeningTarget,
} from '../shared/roof-wall-opening-placement'
import { resolveOpeningPlacement } from '../shared/wall-attach-target'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
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
    // level and tracks the cursor like an item. `freeFollowing` marks that
    // state; `lastMeshEventTime` defers the floor handler whenever a wall/roof
    // mesh event owns the same pointermove — that's the only thing that snaps.
    let freeFollowing = false
    let lastMeshEventTime = -1
    // Last open-floor cursor point (level-local X/Z), so an R-flip while free-
    // following can re-run the ghost at the same spot with the new facing.
    let lastFloorPoint: [number, number] | null = null
    // Live Shift state (force-place) — lets the preview tint re-evaluate when
    // Shift is pressed/released with the pointer stationary (see `MoveDoorTool`).
    let shiftHeld = false
    // Movement SFX: ONE soft `sfx:grid-snap` click per grid step — identical
    // whether free-following over floor or sliding along a wall (the user's
    // ask). Always keyed on the RAW cursor (continuous ~0.1m cadence), never the
    // snapped along-wall value. Guards: `lastStepKey` (cell change) +
    // `lastTickFrame` (one tick per DOM pointermove). No separate snap cue — a
    // distinct floor→wall sound was the "double" the user heard. See `MoveDoorTool`.
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
    }

    // Alignment candidates — anchors of every OTHER alignable object (the
    // moving window is excluded so it never aligns to itself). Along-wall only;
    // the floor-plane guides don't cover sill height.
    const alignmentCandidates = collectAlignmentAnchors(
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
        const bypassSnap = event.nativeEvent?.shiftKey === true
        dragAnchor = {
          wallId: event.node.id,
          rawX: rawLocalX,
          rawY: rawLocalY,
          startX: event.node.id === original.parentId ? original.position[0] : rawLocalX,
          startY:
            event.node.id === original.parentId
              ? original.position[1]
              : bypassSnap
                ? rawLocalY
                : snapToHalf(rawLocalY),
        }
      }
      const targetLocalX = dragAnchor.startX + (rawLocalX - dragAnchor.rawX)
      const targetRawLocalY = dragAnchor.startY + (rawLocalY - dragAnchor.rawY)
      // Vertical sill alignment (snap + guide): a sibling's sill/centre/top wins
      // over the 0.5m grid when within threshold; Shift bypasses both.
      const bypassY = event.nativeEvent?.shiftKey === true
      const sillSnapped = bypassY
        ? null
        : resolveSillSnap({
            wall: event.node,
            movingId: movingWindowNode.id,
            localX: targetLocalX,
            localY: targetRawLocalY,
            width: movingWindowNode.width,
            height: movingWindowNode.height,
            nodes: useScene.getState().nodes,
          })
      const targetLocalY = bypassY ? targetRawLocalY : (sillSnapped ?? snapToHalf(targetRawLocalY))
      const localX = resolveWallSlideAlignment({
        wallNode: event.node,
        rawLocalX: targetLocalX,
        width: movingWindowNode.width,
        candidates: alignmentCandidates,
        // Alt still hard-disables alignment (no guides). Shift = free-place:
        // land at the raw cursor but keep showing the along-wall guides.
        bypass: event.nativeEvent?.altKey === true,
        freePlace: event.nativeEvent?.shiftKey === true,
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
      // Same click as the off-wall ghost: one grid-snap tick per grid step,
      // keyed on the RAW cursor along-wall position (not the snapped clampedX).
      // Per-frame guard collapses duplicate wall events on the same pointermove.
      tickGridStep(target.event.nativeEvent?.timeStamp ?? -1, target.event.localPosition[0])
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
      const placement = resolveOpeningPlacement({ collides: !target.valid, forcePlace: shiftHeld })
      // Ghost world yaw must equal the committed wall-CHILD's world yaw
      // (-wallAngle + itemRotation); `cursorRotation` is π off here. See
      // `MoveDoorTool.applyPreview`.
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
        floorY: getLevelYOffset() + getSlabElevation(target.event),
        side: target.side,
      })

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
      // Shift force-places: commit even when the window overlaps another opening.
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
    const freeFollowAt = (localX: number, localZ: number, frame: number) => {
      freeFollowing = true
      lastTarget = null
      lastRoofEvent = null
      // Click per grid cell as the ghost slides over open floor (X+Z) — the
      // same `tickGridStep` the on-wall slide uses, so both feel identical.
      tickGridStep(frame, localX, localZ)
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
    }

    const onGridMove = (event: GridEvent) => {
      if (committed) return
      if (useViewer.getState().cameraDragging) return
      // A wall/roof mesh handler owns this exact pointermove (shared DOM
      // timeStamp): the cursor ray is on a wall/roof, so it snaps. Otherwise
      // the cursor is over open floor — free-follow it. No proximity magnet:
      // snapping engages only when the cursor ray actually hovers a wall.
      if (event.nativeEvent?.timeStamp === lastMeshEventTime) return
      const [x, , z] = event.localPosition
      lastFloorPoint = [x, z]
      freeFollowAt(x, z, event.nativeEvent?.timeStamp ?? -1)
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
          snap: event.nativeEvent?.shiftKey === true ? undefined : snapToHalf,
        },
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
      // Shift force-places over a colliding roof-face target too (see onWallClick).
      if (!target) return
      if (!target.valid && event.nativeEvent?.shiftKey !== true) return
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
      // target commits via commitToWall; a roof face via onRoofClick. Shift
      // force-places over a colliding wall target (tint stays red as a warning);
      // read shift from this pointerup so it's current at commit.
      if (lastTarget && !freeFollowing && (lastTarget.valid || event.shiftKey)) {
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
        freeFollowAt(lastFloorPoint[0], lastFloorPoint[1], -1)
      } else {
        // No preview yet (R before the first pointermove): flip the hidden node
        // so the first preview/commit already reflects the chosen side.
        useScene.getState().updateNode(movingWindowNode.id, {
          side: sideOverride,
          rotation: [0, sideOverride === 'back' ? Math.PI : 0, 0],
        })
      }
    }

    // Shift toggles force-place — re-run the on-wall preview so the tint flips
    // green↔red live (pointer stationary). Commit gates still read shift fresh.
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
