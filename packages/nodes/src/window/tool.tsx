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
  useScene,
  type WallEvent,
  type WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  calculateCursorRotation,
  calculateItemRotation,
  EDITOR_LAYER,
  getSideFromNormal,
  isValidWallSideFace,
  snapToHalf,
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
import { resolveWallSlideAlignment } from '../shared/wall-opening-alignment'
import WindowPreview from './preview'
import { clampToWall, hasWallChildOverlap, wallLocalToWorld } from './window-math'

// Shared edge material — reuse across renders, just toggle color
const edgeMaterial = new LineBasicNodeMaterial({
  color: 0xef_44_44, // red-500 default (invalid)
  linewidth: 3,
  depthTest: false,
  depthWrite: false,
})

const FALLBACK_WIDTH = 1.5
const FALLBACK_HEIGHT = 1.5
const FALLBACK_SILL_LIFT = 0.45
// Default sill centre for a window snapped from the floor (the floor cursor
// carries no wall-face height). 0.9 m sill + half the 1.5 m default height.
const DEFAULT_SILL_CENTER_Y = 0.9 + FALLBACK_HEIGHT / 2
const roofFallbackPoint = new Vector3()

// What currently owns the cursor frame: a wall/roof mesh hover, or null when
// the cursor is over open floor (the grid handler then free-follows).
type HostKind = 'wall' | 'roof' | null

/**
 * Window tool — places WindowNodes on walls and on roof-segment wall
 * faces (the generated base walls under a roof, including coplanar gable
 * ends — a window can sit in the gable pediment).
 *
 * The ghost follows the cursor everywhere (like moving an item): over open
 * floor it floats as an invalid (unplaceable) ghost; the moment the cursor ray
 * hovers a wall (or roof-segment face) the real draft snaps onto it. Snapping
 * engages only on an actual mesh hover — no proximity magnet.
 */
const WindowTool: React.FC = () => {
  const draftRef = useRef<WindowNode | null>(null)
  const cursorGroupRef = useRef<Group>(null!)
  const edgesRef = useRef<LineSegments>(null!)

  // Off-host floating ghost: the real window geometry follows the cursor
  // over the grid (tinted invalid). Mutually exclusive with the on-host draft.
  const [fallbackPose, setFallbackPose] = useState<{
    position: [number, number, number]
    rotationY: number
  } | null>(null)

  const ghostStub = useMemo(
    () => WindowNode.parse({ position: [0, 0, 0], rotation: [0, 0, 0] }),
    [],
  )

  useEffect(() => {
    useScene.temporal.getState().pause()

    let hostKind: HostKind = null
    // timeStamp of the most recent wall/roof mesh event. A wall/roof hover and
    // the grid raycast from the SAME pointermove share the source DOM event's
    // timeStamp, so the grid handler can detect "a mesh handler already owns
    // this frame" without depending on event order or on a leave firing (node
    // events are suppressed during a camera drag, so a sticky boolean would
    // strand the draft after an orbit; a per-frame timestamp self-heals).
    let lastMeshEventTime = -1
    // R flips the window's facing side mid-placement (front ↔ back); re-applied
    // to the last wall hover so the flip shows live before commit.
    let sideFlip = false
    let lastWallEvent: WallEvent | null = null

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
      // Rebuild wall so it removes the cutout from the deleted draft
      if (wallId) markHostDirty(wallId)
    }

    const hideCursor = () => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      useAlignmentGuides.getState().clear()
      setFallbackPose(null)
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. A window aligns by the plan position of its centre
    // (along-wall only; the floor-plane guides don't cover sill height).
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

    // Off-host fallback: hide the wireframe outline and float the real window
    // geometry (tinted invalid) at the cursor so the armed tool is visible.
    const showGhostAt = (position: [number, number, number]) => {
      if (cursorGroupRef.current) cursorGroupRef.current.visible = false
      setFallbackPose({ position, rotationY: 0 })
      useAlignmentGuides.getState().clear()
    }

    const showRoofFallbackCursor = (event: RoofEvent) => {
      const [x, , z] = worldToSelectedBuildingLocal(roofFallbackPoint.set(...event.position))
      showGhostAt([x, getLevelYOffset() + FALLBACK_HEIGHT / 2 + FALLBACK_SILL_LIFT, z])
    }

    const showWallFallbackCursor = (event: WallEvent) => {
      const [x, , z] = worldToSelectedBuildingLocal(roofFallbackPoint.set(...event.position))
      showGhostAt([x, getLevelYOffset() + FALLBACK_HEIGHT / 2 + FALLBACK_SILL_LIFT, z])
    }

    // Settle a wall target: alignment snap → sill clamp → overlap check.
    const resolveWallPlacement = (
      wall: WallNode,
      rawLocalX: number,
      rawLocalY: number,
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
      const localY = bypassSnap ? rawLocalY : snapToHalf(rawLocalY)
      const { clampedX, clampedY } = clampToWall(wall, localX, localY, width, height)
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
      rawLocalY: number
      side: 'front' | 'back'
      itemRotation: number
      cursorRotationY: number
      bypass: boolean
      bypassSnap: boolean
    }) => {
      const {
        wall,
        rawLocalX,
        rawLocalY,
        side,
        itemRotation,
        cursorRotationY,
        bypass,
        bypassSnap,
      } = args
      const width = draftRef.current?.width ?? 1.5
      const height = draftRef.current?.height ?? 1.5

      if (!draftRef.current) {
        const node = WindowNode.parse({
          position: [0, DEFAULT_SILL_CENTER_Y, 0],
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
        rawLocalY,
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

    // Promote the draft into a permanent window. Shared by the wall-mesh click
    // and the floor proximity click.
    const commitWindowAtWall = (
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

      useScene.getState().deleteNode(draft.id)
      useScene.temporal.getState().resume()

      const levelId = getLevelId()
      const state = useScene.getState()
      const windowCount = Object.values(state.nodes).filter((n) => {
        if (n.type !== 'window') return false
        const w = n.parentId ? state.nodes[n.parentId as AnyNodeId] : undefined
        return w?.parentId === levelId
      }).length

      const node = WindowNode.parse({
        name: `Window ${windowCount + 1}`,
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        wallId: wall.id,
        parentId: wall.id,
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
      lastWallEvent = event

      const faceSide = getSideFromNormal(event.normal)
      const side = sideFlip ? (faceSide === 'front' ? 'back' : 'front') : faceSide
      const flipOffset = sideFlip ? Math.PI : 0
      const itemRotation = calculateItemRotation(event.normal) + flipOffset
      const cursorRotation =
        calculateCursorRotation(event.normal, event.node.start, event.node.end) + flipOffset
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const bypass = event.nativeEvent?.altKey === true || bypassSnap

      applyWallTarget({
        wall: event.node,
        rawLocalX: event.localPosition[0],
        rawLocalY: event.localPosition[1],
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

      const faceSide = getSideFromNormal(event.normal)
      const side = sideFlip ? (faceSide === 'front' ? 'back' : 'front') : faceSide
      const itemRotation = calculateItemRotation(event.normal) + (sideFlip ? Math.PI : 0)
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const bypass = event.nativeEvent?.altKey === true || bypassSnap

      const { clampedX, clampedY, valid } = resolveWallPlacement(
        event.node,
        event.localPosition[0],
        event.localPosition[1],
        draftRef.current.width,
        draftRef.current.height,
        bypass,
        bypassSnap,
        draftRef.current.id,
      )
      if (!valid) return

      commitWindowAtWall(event.node, clampedX, clampedY, side, itemRotation)
      event.stopPropagation()
    }

    const onWallLeave = () => {
      if (hostKind !== 'wall') return
      lastWallEvent = null
      destroyDraft()
      hideCursor()
      hostKind = null
    }

    // ── Floor free-follow ───────────────────────────────────────────
    // Over open floor the ghost follows the cursor like a moving item. It does
    // NOT snap from proximity — snapping engages only when the cursor ray
    // actually hovers a wall (onWallHover) or roof face (onRoofHover).
    const onGridFreeFollow = (event: GridEvent) => {
      if (useViewer.getState().cameraDragging) return
      // A wall/roof mesh handler processed this exact pointermove (R3F + the
      // grid raycast share the source DOM event's timeStamp) — it owns the
      // frame and has snapped the draft, so skip the floor follow this tick.
      const ts = event.nativeEvent?.timeStamp ?? -1
      if (ts === lastMeshEventTime) return
      // Fresh floor-only frame: the cursor is off any wall/roof. Drop any draft
      // and free-follow the cursor with the invalid (unplaceable) ghost.
      hostKind = null
      lastWallEvent = null
      const [x, y, z] = event.localPosition
      destroyDraft()
      showGhostAt([x, y + FALLBACK_HEIGHT / 2 + FALLBACK_SILL_LIFT, z])
    }

    // ── Roof-segment wall faces ─────────────────────────────────────
    // The merged roof mesh emits `roof:*`; hits are resolved against the
    // segments' vertical wall faces (base walls + coplanar gable ends),
    // so a window can sit anywhere inside the face profile — including
    // the gable pediment triangle.

    const resolveRoofTarget = (event: RoofEvent) =>
      resolveRoofWallOpeningTarget({
        event,
        width: draftRef.current?.width ?? 1.5,
        height: draftRef.current?.height ?? 1.5,
        ignoreId: draftRef.current?.id,
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
      hostKind = 'roof'
      lastMeshEventTime = event.nativeEvent?.timeStamp ?? -1
      const target = resolveRoofTarget(event)
      if (!target) {
        // On the roof but not over a placeable wall face (slope, soffit,
        // or a face the window cannot fit on).
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
        const node = WindowNode.parse({
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
      const windowCount = Object.values(state.nodes).filter(
        (n) => n.type === 'window' && (n as WindowNode).roofSegmentId !== undefined,
      ).length

      const node = WindowNode.parse({
        name: `Window ${windowCount + 1}`,
        position,
        rotation: [0, 0, 0],
        side: 'front',
        roofSegmentId: segment.id,
        roofFace: face.id,
        parentId: segment.id,
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
    }

    // R flips the window's facing side mid-placement (front ↔ back), like the
    // committed-selected R flip. Only meaningful while snapped to a wall (the
    // off-wall ghost has no orientation), so it acts only then — re-applying
    // the last wall hover so the snapped preview flips live.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return
      if (!lastWallEvent) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      sideFlip = !sideFlip
      triggerSFX('sfx:item-rotate')
      onWallHover(lastWallEvent)
    }

    emitter.on('wall:enter', onWallHover)
    emitter.on('wall:move', onWallHover)
    emitter.on('wall:click', onWallClick)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('roof:enter', onRoofHover)
    emitter.on('roof:move', onRoofHover)
    emitter.on('roof:click', onRoofClick)
    emitter.on('roof:leave', onRoofLeave)
    emitter.on('grid:move', onGridFreeFollow)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

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
      emitter.off('grid:move', onGridFreeFollow)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // Cursor geometry: window outline rectangle.
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
          <WindowPreview invalid node={ghostStub} />
        </group>
      )}
    </>
  )
}

export default WindowTool
