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
  useScene,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  triggerSFX,
  useAlignmentGuides,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, EdgesGeometry, type Group, type LineSegments, Vector3 } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'
import {
  getRoofWallOpeningCursorPose,
  type RoofWallOpeningTarget,
  resolveRoofWallOpeningTarget,
  worldToSelectedBuildingLocal,
} from '../shared/roof-wall-opening-placement'
import { findClosestWallInPlan } from '../shared/wall-attach-target'
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './door-math'
import DoorPreview from './preview'

const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44,
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const FALLBACK_WIDTH = 0.9
const FALLBACK_HEIGHT = 2.1
const roofFallbackPoint = new Vector3()

// What currently owns the cursor frame. The grid (proximity) handler defers
// to a wall/roof mesh hover; it only drives the draft when the cursor is on
// the floor ('proximity' = snapped to a nearby wall, null = free-floating).
type HostKind = 'wall' | 'roof' | 'proximity' | null

/**
 * Door tool — places DoorNodes on walls and on roof-segment wall faces
 * (the generated base walls under a roof, including coplanar gable ends).
 * Doors always sit at floor level (clampedY = height/2 — segment base for
 * roof-hosted doors).
 *
 * The ghost follows the cursor everywhere (like moving an item): over the
 * floor it floats as an invalid ghost, and it MAGNETICALLY snaps onto the
 * nearest wall within `findClosestWallInPlan`'s range (1.5 m), releasing back
 * to free-follow when the cursor moves away. A direct wall-mesh hover takes
 * over with the precise face side; both paths share `applyWallTarget`.
 */
const DoorTool: React.FC = () => {
  const draftRef = useRef<DoorNode | null>(null)
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)

  // Off-host floating ghost: the real door geometry follows the cursor over
  // the grid (tinted invalid). Mutually exclusive with the on-host draft —
  // when a draft + wireframe is shown this is null and vice-versa.
  const [fallbackPose, setFallbackPose] = useState<{
    position: [number, number, number]
    rotationY: number
  } | null>(null)

  const ghostStub = useMemo(() => DoorNode.parse({ position: [0, 0, 0], rotation: [0, 0, 0] }), [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    let hostKind: HostKind = null
    // timeStamp of the most recent wall/roof mesh event. A wall/roof hover and
    // the grid raycast from the SAME pointermove share the source DOM event's
    // timeStamp, so the proximity handler can detect "a mesh handler already
    // owns this frame" without depending on event order or on a leave firing
    // (node events are suppressed during a camera drag, so a sticky boolean
    // would strand the draft after an orbit; a per-frame timestamp self-heals).
    let lastMeshEventTime = -1
    // Last snapped wall + along-wall cell, so the grid-snap SFX fires only when
    // the proximity snap lands on a NEW spot (entering a wall or sliding to a
    // new cell), not every move.
    let lastSnapKey: string | null = null

    const getLevelId = () => useViewer.getState().selection.levelId
    const getLevelYOffset = () => {
      const id = getLevelId()
      return id ? (sceneRegistry.nodes.get(id as AnyNodeId)?.position.y ?? 0) : 0
    }
    const getSlabElevationForWall = (wall: WallNode) =>
      spatialGridManager.getSlabElevationForWall(wall.parentId ?? '', wall.start, wall.end)

    const markHostDirty = (hostId: string) => {
      useScene.getState().dirtyNodes.add(hostId as AnyNodeId)
    }

    const destroyDraft = () => {
      if (!draftRef.current) return
      const wallId = draftRef.current.parentId
      useScene.getState().deleteNode(draftRef.current.id)
      draftRef.current = null
      if (wallId) markHostDirty(wallId)
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
      setFallbackPose(null)
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. A door aligns by the plan position of its centre.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')

    // On-host cursor: the green/red wireframe outline tracks a live draft.
    // Showing it always clears the off-host floating ghost (they never
    // coexist — a draft means the cursor is on a valid host).
    const updateCursor = (
      worldPosition: [number, number, number],
      cursorRotationY: number,
      valid: boolean,
    ) => {
      setFallbackPose(null)
      const group = cursorGroupRef.current
      if (!group) return
      group.visible = true
      group.position.set(...worldPosition)
      group.rotation.y = cursorRotationY
      edgeMaterial.color.setHex(valid ? 0x22_c5_5e : 0xef_44_44)
    }

    // Off-host fallback: hide the wireframe outline and float the real door
    // geometry (tinted invalid) at the cursor so the armed tool is visible.
    const showGhostAt = (position: [number, number, number]) => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      setFallbackPose({ position, rotationY: 0 })
      useAlignmentGuides.getState().clear()
    }

    const showRoofFallbackCursor = (event: RoofEvent) => {
      const [x, , z] = worldToSelectedBuildingLocal(roofFallbackPoint.set(...event.position))
      showGhostAt([x, getLevelYOffset() + FALLBACK_HEIGHT / 2, z])
    }

    const showWallFallbackCursor = (event: WallEvent) => {
      const [x, , z] = worldToSelectedBuildingLocal(roofFallbackPoint.set(...event.position))
      showGhostAt([x, getLevelYOffset() + FALLBACK_HEIGHT / 2, z])
    }

    // Settle a wall target: alignment snap → clamp → overlap check. Pure read.
    const resolveWallPlacement = (
      wall: WallNode,
      rawLocalX: number,
      width: number,
      height: number,
      bypass: boolean,
      bypassSnap: boolean,
      ignoreId?: string,
    ) => {
      const localX = resolveWallSlideAlignment({
        wallNode: wall,
        rawLocalX,
        width,
        candidates: alignmentCandidates,
        bypass,
        bypassSnap,
      })
      const { clampedX, clampedY } = clampToWall(wall, localX, width, height)
      const valid = !hasWallChildOverlap(wall.id, clampedX, clampedY, width, height, ignoreId)
      return { clampedX, clampedY, valid }
    }

    // Shared create/update path for the wall draft — used by the direct
    // wall-mesh hover and the floor proximity snap. Reuses the existing draft
    // (reparenting only on an actual wall change to avoid churning the host's
    // children array, which flashes 0-vertex wall geometry in WebGPU).
    const applyWallTarget = (args: {
      wall: WallNode
      rawLocalX: number
      side: 'front' | 'back'
      itemRotation: number
      cursorRotationY: number
      bypass: boolean
      bypassSnap: boolean
    }) => {
      const { wall, rawLocalX, side, itemRotation, cursorRotationY, bypass, bypassSnap } = args
      const width = draftRef.current?.width ?? 0.9
      const height = draftRef.current?.height ?? 2.1

      if (!draftRef.current) {
        const node = DoorNode.parse({
          position: [0, height / 2, 0],
          rotation: [0, itemRotation, 0],
          side,
          wallId: wall.id,
          parentId: wall.id,
          metadata: { isTransient: true },
        })
        useScene.getState().createNode(node, wall.id as AnyNodeId)
        draftRef.current = node
      }

      const { clampedX, clampedY, valid } = resolveWallPlacement(
        wall,
        rawLocalX,
        width,
        height,
        bypass,
        bypassSnap,
        draftRef.current.id,
      )

      if (wall.id === draftRef.current.parentId) {
        useScene.getState().updateNode(draftRef.current.id, {
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
        })
        markHostDirty(wall.id)
      } else {
        useScene.getState().updateNode(draftRef.current.id, {
          position: [clampedX, clampedY, 0],
          rotation: [0, itemRotation, 0],
          side,
          parentId: wall.id,
          wallId: wall.id,
          // The draft may arrive from a roof-segment face hover.
          roofSegmentId: undefined,
          roofFace: undefined,
        })
      }

      updateCursor(
        wallLocalToWorld(
          wall,
          clampedX,
          clampedY,
          getLevelYOffset(),
          getSlabElevationForWall(wall),
        ),
        cursorRotationY,
        valid,
      )
      return { clampedX, clampedY, valid }
    }

    // Promote the draft into a permanent door. Shared by the wall-mesh click
    // and the floor proximity click.
    const commitDoorAtWall = (
      wall: WallNode,
      clampedX: number,
      clampedY: number,
      side: 'front' | 'back',
      itemRotation: number,
    ) => {
      const draft = draftRef.current
      if (!draft) return
      draftRef.current = null
      hostKind = null
      lastSnapKey = null

      useScene.getState().deleteNode(draft.id)
      useScene.temporal.getState().resume()

      const levelId = getLevelId()
      const state = useScene.getState()
      const doorCount = Object.values(state.nodes).filter((n) => {
        if (n.type !== 'door') return false
        const w = n.parentId ? state.nodes[n.parentId as AnyNodeId] : undefined
        return w?.parentId === levelId
      }).length

      const node = DoorNode.parse({
        name: `Door ${doorCount + 1}`,
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: wall.id,
        parentId: wall.id,
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

      useScene.getState().createNode(node, wall.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()
      triggerSFX('sfx:structure-build')
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
      useAlignmentGuides.getState().clear()
    }

    // ── Direct wall-mesh hover ──────────────────────────────────────
    const onWallHover = (event: WallEvent) => {
      hostKind = 'wall'
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      if (
        !isValidWallSideFace(event.normal) ||
        isCurvedWall(event.node) ||
        event.node.parentId !== getLevelId()
      ) {
        destroyDraft()
        showWallFallbackCursor(event)
        return
      }

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const cursorRotation = calculateCursorRotation(event.normal, event.node.start, event.node.end)
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const bypass = event.nativeEvent?.altKey === true || bypassSnap

      applyWallTarget({
        wall: event.node,
        rawLocalX: event.localPosition[0],
        side,
        itemRotation,
        cursorRotationY: cursorRotation,
        bypass,
        bypassSnap,
      })
      event.stopPropagation()
    }

    const onWallClick = (event: WallEvent) => {
      if (!draftRef.current) return
      if (
        !isValidWallSideFace(event.normal) ||
        isCurvedWall(event.node) ||
        event.node.parentId !== getLevelId()
      ) {
        return
      }

      const side = getSideFromNormal(event.normal)
      const itemRotation = calculateItemRotation(event.normal)
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const bypass = event.nativeEvent?.altKey === true || bypassSnap

      const { clampedX, clampedY, valid } = resolveWallPlacement(
        event.node,
        event.localPosition[0],
        draftRef.current.width,
        draftRef.current.height,
        bypass,
        bypassSnap,
        draftRef.current.id,
      )
      if (!valid) return

      commitDoorAtWall(event.node, clampedX, clampedY, side, itemRotation)
      event.stopPropagation()
    }

    const onWallLeave = () => {
      if (hostKind !== 'wall') return
      destroyDraft()
      hideCursor()
      hostKind = null
    }

    // ── Floor proximity (magnetic snap) ─────────────────────────────
    // The ghost follows the cursor over the floor and snaps onto the nearest
    // wall within range, like moving an item. A wall/roof mesh hover owns the
    // frame instead (hostKind), and grid events fire during camera drag, so
    // both are gated here.
    const onGridMoveProximity = (event: GridEvent) => {
      if (useViewer.getState().cameraDragging) return
      // A wall/roof mesh handler processed this exact pointermove (R3F + the
      // grid raycast share the source DOM event's timeStamp) — let it own the
      // frame. This works regardless of which handler fires first: if the wall
      // handler ran first this tick, hostKind is already 'wall'/'roof' and the
      // timeStamps match; if grid runs first, the timeStamps still match so we
      // defer and the wall handler applies authoritatively right after.
      const ts = event.nativeEvent?.timeStamp ?? -1
      if (ts === lastMeshEventTime) return
      // Fresh frame with no wall/roof event: the cursor left those meshes.
      // Clear any stale ownership (a leave can be missed during a camera drag,
      // when node events are suppressed but grid:move keeps firing).
      if (hostKind === 'wall' || hostKind === 'roof') hostKind = null

      const [x, y, z] = event.localPosition
      const levelId = getLevelId()
      if (!levelId) {
        destroyDraft()
        hostKind = null
        lastSnapKey = null
        showGhostAt([x, y + FALLBACK_HEIGHT / 2, z])
        return
      }

      const bypassSnap = event.nativeEvent?.shiftKey === true
      const hit = findClosestWallInPlan([x, z], useScene.getState().nodes, levelId as AnyNodeId)
      if (!hit) {
        // Beyond snap range — free-follow the cursor as an invalid ghost.
        destroyDraft()
        hostKind = null
        lastSnapKey = null
        showGhostAt([x, y + FALLBACK_HEIGHT / 2, z])
        return
      }

      hostKind = 'proximity'
      // Wireframe outline orientation: mirror calculateCursorRotation's
      // normal→world mapping, derived from the wall direction + hit side.
      const wallAngle = Math.atan2(hit.dirY, hit.dirX)
      const cursorRotationY = hit.side === 'front' ? Math.PI - wallAngle : -wallAngle

      const { clampedX } = applyWallTarget({
        wall: hit.wall,
        rawLocalX: hit.localX,
        side: hit.side,
        itemRotation: hit.itemRotation,
        cursorRotationY,
        bypass: event.nativeEvent?.altKey === true || bypassSnap,
        bypassSnap,
      })

      // Bucket the along-wall position to ~5cm so the snap cue fires on entry
      // and on each meaningful slide step, not on every sub-cm mouse jitter.
      const snapKey = `${hit.wall.id}:${Math.round(clampedX * 20)}`
      if (!bypassSnap && snapKey !== lastSnapKey) triggerSFX('sfx:grid-snap')
      lastSnapKey = snapKey
    }

    const onGridClick = (event: GridEvent) => {
      // wall:click / roof:click own a commit when the cursor is on those
      // meshes; only the floor proximity snap commits here.
      if (hostKind !== 'proximity' || !draftRef.current) return
      const levelId = getLevelId()
      if (!levelId) return

      const [x, , z] = event.localPosition
      const hit = findClosestWallInPlan([x, z], useScene.getState().nodes, levelId as AnyNodeId)
      if (!hit) return

      const bypassSnap = event.nativeEvent?.shiftKey === true
      const { clampedX, clampedY, valid } = resolveWallPlacement(
        hit.wall,
        hit.localX,
        draftRef.current.width,
        draftRef.current.height,
        event.nativeEvent?.altKey === true || bypassSnap,
        bypassSnap,
        draftRef.current.id,
      )
      if (!valid) return

      commitDoorAtWall(hit.wall, clampedX, clampedY, hit.side, hit.itemRotation)
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // The merged roof mesh emits `roof:*`; hits are resolved against the
    // segments' vertical wall faces (base walls + coplanar gable ends).

    const resolveRoofTarget = (event: RoofEvent) =>
      resolveRoofWallOpeningTarget({
        event,
        width: draftRef.current?.width ?? 0.9,
        height: draftRef.current?.height ?? 2.1,
        ignoreId: draftRef.current?.id,
        vertical: { kind: 'bottom-locked' },
      })

    const updateRoofCursor = (target: RoofWallOpeningTarget, roof: RoofNode) => {
      const pose = getRoofWallOpeningCursorPose(target, roof)
      if (pose) updateCursor(pose.position, pose.rotationY, target.valid)
    }

    const onRoofHover = (event: RoofEvent) => {
      hostKind = 'roof'
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      const target = resolveRoofTarget(event)
      if (!target) {
        // On the roof but not over a placeable wall face (slope, soffit,
        // or a face the door cannot fit on).
        destroyDraft()
        showRoofFallbackCursor(event)
        return
      }
      const { segment, face, position } = target

      if (draftRef.current && draftRef.current.parentId !== segment.id) destroyDraft()
      if (draftRef.current) {
        useScene.getState().updateNode(draftRef.current.id, {
          position,
          rotation: [0, 0, 0],
          roofFace: face.id,
        })
      } else {
        const node = DoorNode.parse({
          position,
          rotation: [0, 0, 0],
          side: 'front',
          roofSegmentId: segment.id,
          roofFace: face.id,
          parentId: segment.id,
          metadata: { isTransient: true },
        })
        useScene.getState().createNode(node, segment.id as AnyNodeId)
        draftRef.current = node
      }
      updateRoofCursor(target, event.node as RoofNode)
      event.stopPropagation()
    }

    const onRoofClick = (event: RoofEvent) => {
      if (!draftRef.current?.roofSegmentId) return
      const target = resolveRoofTarget(event)
      if (!target?.valid) return
      const { segment, face, position } = target

      const draft = draftRef.current
      draftRef.current = null
      hostKind = null

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
        roofSegmentId: segment.id,
        roofFace: face.id,
        parentId: segment.id,
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

      useScene.getState().createNode(node, segment.id as AnyNodeId)
      // Rebuild the segment (and the merged roof) so the wall brush
      // picks up the new opening cut.
      useScene.getState().dirtyNodes.add(segment.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().pause()
      triggerSFX('sfx:structure-build')
      event.stopPropagation()
    }

    const onRoofLeave = () => {
      if (hostKind !== 'roof') return
      destroyDraft()
      hideCursor()
      hostKind = null
    }

    const onCancel = () => {
      destroyDraft()
      hideCursor()
      hostKind = null
      lastSnapKey = null
    }

    emitter.on('wall:enter', onWallHover)
    emitter.on('wall:move', onWallHover)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofHover)
    emitter.on('roof:move', onRoofHover)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', onRoofLeave)
    emitter.on('grid:move', onGridMoveProximity)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      destroyDraft()
      hideCursor()
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      emitter.off('wall:enter', onWallHover)
      emitter.off('wall:move', onWallHover)
      emitter.off('wall:click', onWallClick)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('roof:enter', onRoofHover)
      emitter.off('roof:move', onRoofHover)
      emitter.off('roof:click', onRoofClick)
      emitter.off('roof:leave', onRoofLeave)
      emitter.off('grid:move', onGridMoveProximity)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [])

  // Cursor geometry: door outline.
  const boxGeo = new BoxGeometry(FALLBACK_WIDTH, FALLBACK_HEIGHT, 0.07)
  const edgesGeo = new EdgesGeometry(boxGeo)
  boxGeo.dispose()

  return (
    <>
      <group ref={cursorGroupRef} visible={false}>
        <lineSegments
          geometry={edgesGeo}
          layers={EDITOR_LAYER}
          material={edgeMaterial}
          ref={edgesRef}
        />
      </group>
      {fallbackPose && (
        <group position={fallbackPose.position} rotation-y={fallbackPose.rotationY}>
          <DoorPreview invalid node={ghostStub} />
        </group>
      )}
    </>
  )
}

export default DoorTool
