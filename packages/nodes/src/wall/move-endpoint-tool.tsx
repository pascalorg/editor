'use client'

import {
  type AnyNodeId,
  collectAlignmentAnchors,
  DEFAULT_WALL_HEIGHT,
  emitter,
  type GridEvent,
  getWallCurveLength,
  getWallThickness,
  pauseSceneHistory,
  resolveAlignment,
  resumeSceneHistory,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  MeasurementPill,
  markToolCancelConsumed,
  snapWallDraftPointDetailed,
  triggerSFX,
  useAlignmentGuides,
  useInteractionScope,
  useWallSnapIndicator,
  WALL_CONNECT_SNAP_RADIUS,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Wall endpoint move tool (kind-owned).
 *
 * Press-drag-release: the endpoint handle's pointerdown activates this
 * tool; cursor movement updates the preview (snap → linked-wall cascade
 * → Alt-detach); pointerup commits if the endpoint actually moved, else
 * dismisses without committing.
 *
 * Mounted via `def.affordanceTools['move-endpoint']` from
 * `wall/definition.ts`. Triggered by an `endpoint` reshape scope; ToolManager
 * reconstructs this `target` from the reshaped node + the scope's endpoint.
 */
export type MovingWallEndpoint = {
  wall: WallNode
  endpoint: 'start' | 'end'
}

/** Figma-style alignment-snap threshold (meters), matching the item move /
 *  placement tools. 8 cm gives a magnetic pull without fighting grid snap. */
const ALIGNMENT_THRESHOLD_M = 0.08

function samePoint(a: WallPlanPoint, b: WallPlanPoint) {
  return a[0] === b[0] && a[1] === b[1]
}

type WallSegmentLike = {
  id: WallNode['id']
  start: WallPlanPoint
  end: WallPlanPoint
  curveOffset?: number
}

type AngleLabelState = {
  label: string
  position: [number, number, number]
} | null

function getEndpointAngleLabel(args: {
  preview: { start: WallPlanPoint; end: WallPlanPoint; curveOffset?: number }
  walls: WallSegmentLike[]
  nodeId: WallNode['id']
}): AngleLabelState {
  const { preview, walls, nodeId } = args
  const endpoints = [{ point: preview.start }, { point: preview.end }]
  const targetSegment: WallSegmentLike = {
    id: nodeId,
    start: preview.start,
    end: preview.end,
    curveOffset: preview.curveOffset,
  }

  for (const endpoint of endpoints) {
    const targetReference = getSegmentAngleReferenceAtPoint(endpoint.point, targetSegment)
    if (!targetReference) continue

    const connectedWall = walls.find(
      (wall) =>
        wall.id !== nodeId && Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, wall)),
    )
    if (!connectedWall) continue

    const connectedReference = getSegmentAngleReferenceAtPoint(endpoint.point, connectedWall)
    if (!connectedReference) continue

    const angle = getAngleToSegmentReference(targetReference.vector, connectedReference)
    if (angle === null) continue

    return {
      label: formatAngleRadians(angle),
      position: [endpoint.point[0], 0.34, endpoint.point[1]],
    }
  }

  return null
}

type LinkedWallSnapshot = {
  id: WallNode['id']
  start: WallPlanPoint
  end: WallPlanPoint
  curveOffset?: number
}

function getLinkedWallSnapshots(args: {
  wallId: WallNode['id']
  wallParentId: string | null
  originalStart: WallPlanPoint
  originalEnd: WallPlanPoint
}) {
  const { wallId, wallParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedWallSnapshot[] = []

  for (const node of Object.values(nodes)) {
    if (!(node?.type === 'wall' && node.id !== wallId)) continue
    if ((node.parentId ?? null) !== wallParentId) continue
    if (
      !(
        samePoint(node.start, originalStart) ||
        samePoint(node.start, originalEnd) ||
        samePoint(node.end, originalStart) ||
        samePoint(node.end, originalEnd)
      )
    )
      continue

    snapshots.push({
      id: node.id,
      start: [...node.start] as WallPlanPoint,
      end: [...node.end] as WallPlanPoint,
      curveOffset: node.curveOffset,
    })
  }

  return snapshots
}

function getLinkedWallUpdates(
  linkedWalls: LinkedWallSnapshot[],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
) {
  return linkedWalls.map((wall) => ({
    id: wall.id,
    curveOffset: wall.curveOffset,
    start: samePoint(wall.start, originalStart)
      ? nextStart
      : samePoint(wall.start, originalEnd)
        ? nextEnd
        : wall.start,
    end: samePoint(wall.end, originalStart)
      ? nextStart
      : samePoint(wall.end, originalEnd)
        ? nextEnd
        : wall.end,
  }))
}

export const MoveWallEndpointTool: React.FC<{ target: MovingWallEndpoint }> = ({ target }) => {
  const previousGridPosRef = useRef<WallPlanPoint | null>(null)
  const altPressedRef = useRef(false)
  const nodeIdRef = useRef(target.wall.id)
  const originalStartRef = useRef<WallPlanPoint>([...target.wall.start] as WallPlanPoint)
  const originalEndRef = useRef<WallPlanPoint>([...target.wall.end] as WallPlanPoint)
  const fixedPointRef = useRef<WallPlanPoint>(
    target.endpoint === 'start'
      ? ([...target.wall.end] as WallPlanPoint)
      : ([...target.wall.start] as WallPlanPoint),
  )
  const linkedOriginalsRef = useRef(
    getLinkedWallSnapshots({
      wallId: target.wall.id,
      wallParentId: target.wall.parentId ?? null,
      originalStart: target.wall.start,
      originalEnd: target.wall.end,
    }),
  )
  const previewRef = useRef<{ start: WallPlanPoint; end: WallPlanPoint } | null>(null)
  const [angleLabel, setAngleLabel] = useState<AngleLabelState>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const point = target.endpoint === 'start' ? target.wall.start : target.wall.end
    return [point[0], 0, point[1]]
  })
  const [altPressed, setAltPressed] = useState(false)
  const unit = useViewer((s) => s.unit)

  const exitMoveMode = useCallback(() => {
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'endpoint')
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const fixedPoint = fixedPointRef.current
    const levelWalls = Object.values(useScene.getState().nodes).filter(
      (node): node is WallNode =>
        node?.type === 'wall' && (node.parentId ?? null) === (target.wall.parentId ?? null),
    )

    // Alignment candidates — anchors of every OTHER alignable object (walls,
    // fences, items, slabs, ceilings, columns), gathered once (the set is
    // stable during the drag). Coords are building-local, the same frame as
    // the cursor and the 3D guide layer, so the published guide lines up.
    const wallAlignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, nodeId)

    pauseSceneHistory(useScene)
    let wasCommitted = false

    // Wall ids carrying a live position override during the drag. Mirrors the
    // 3D/2D wall MOVE tools: preview via `useLiveNodeOverrides` (the wall
    // system, wall panel, and 2D floor plan all merge it) instead of writing
    // the scene store every tick. A per-tick `updateNodes` hands a fresh `nodes`
    // reference to every `useScene(s => s.nodes)` subscriber (sidebar panels,
    // contextual HUD, tooltips, floor plan) and rebuilds them all each frame.
    // The store is written ONCE, atomically, on commit.
    const touchedWallIds = new Set<AnyNodeId>()

    const applyNodePreview = (
      updates: Array<{ id: WallNode['id']; start: WallPlanPoint; end: WallPlanPoint }>,
    ) => {
      const overrides = useLiveNodeOverrides.getState()
      const sceneState = useScene.getState()
      overrides.setMany(
        updates.map(
          (entry) =>
            [entry.id, { start: entry.start, end: entry.end }] as [string, Record<string, unknown>],
        ),
      )
      for (const entry of updates) {
        touchedWallIds.add(entry.id as AnyNodeId)
        sceneState.markDirty(entry.id as AnyNodeId)
      }
    }

    // Drop every live override (mesh + miters revert to the scene store, which
    // was never mutated during the drag) and re-dirty so geometry rebuilds.
    const clearPreviewOverrides = () => {
      const overrides = useLiveNodeOverrides.getState()
      const sceneState = useScene.getState()
      for (const id of touchedWallIds) {
        overrides.clear(id)
        sceneState.markDirty(id)
      }
      touchedWallIds.clear()
    }

    const applyPreview = (movingPoint: WallPlanPoint, detachLinkedWalls = false) => {
      const nextStart = target.endpoint === 'start' ? movingPoint : fixedPoint
      const nextEnd = target.endpoint === 'end' ? movingPoint : fixedPoint
      const linkedUpdates = detachLinkedWalls
        ? []
        : getLinkedWallUpdates(
            linkedOriginalsRef.current,
            originalStart,
            originalEnd,
            nextStart,
            nextEnd,
          )
      previewRef.current = { start: nextStart, end: nextEnd }
      setCursorLocalPos([movingPoint[0], 0, movingPoint[1]])
      setAngleLabel(
        getEndpointAngleLabel({
          preview: { start: nextStart, end: nextEnd, curveOffset: target.wall.curveOffset },
          walls: [
            ...levelWalls.map((wall) => ({
              id: wall.id,
              start: wall.start,
              end: wall.end,
              curveOffset: wall.curveOffset,
            })),
            ...linkedUpdates,
          ],
          nodeId,
        }),
      )
      applyNodePreview([{ id: nodeId, start: nextStart, end: nextEnd }, ...linkedUpdates])
    }

    const restoreOriginal = (clearAngleLabel = true) => {
      clearPreviewOverrides()
      if (clearAngleLabel) {
        setAngleLabel(null)
      }
    }

    // Eat the click the browser fires right after the commit pointerup so it
    // doesn't fall through to the wall body and arm the wall move tool.
    const swallowNextClick = () => {
      const swallow = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
    }

    const onGridMove = (event: GridEvent) => {
      const planPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      // Endpoint move honours the active snapping mode (the HUD chip): grid →
      // lattice; lines → magnetic corner/alignment snap; angles → lock the
      // segment to 15° rays from the FIXED corner; off → raw. No Shift bypass —
      // Shift cycles the mode now, and Off is the bypass.
      const snapResult = snapWallDraftPointDetailed({
        point: planPoint,
        walls: levelWalls,
        ignoreWallIds: [nodeId],
        start: fixedPoint,
        angleSnap: isAngleSnapActive(),
        magnetic: isMagneticSnapActive(),
      })
      const snappedPoint = snapResult.point

      // Figma-style alignment: nudge the dragged endpoint onto another wall /
      // fence endpoint or midpoint axis when within threshold, and publish a
      // guide. The resolver connects to the NEAREST real anchor of the
      // candidate, so the dot always sits on an actual point (endpoint /
      // midpoint), never an empty-space bbox corner. Layered on top of the
      // grid + corner snap above; Alt is reserved for corner-detach here.
      // Alignment lines are DISPLAYED in every mode except Off
      // (isAlignmentGuideActive); the magnetic pull onto them is applied only in
      // 'lines' mode (isMagneticSnapActive).
      let alignedPoint = snappedPoint
      if (isAlignmentGuideActive() && wallAlignmentCandidates.length > 0) {
        const ar = resolveAlignment({
          moving: [{ nodeId, kind: 'corner', x: snappedPoint[0], z: snappedPoint[1] }],
          candidates: wallAlignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        const magnetic = isMagneticSnapActive()
        if (ar.snap && magnetic) {
          alignedPoint = [snappedPoint[0] + ar.snap.dx, snappedPoint[1] + ar.snap.dz]
        }
        // Non-magnetic modes don't pull onto a guide, so only surface guides
        // whose anchor is within connect distance — a corner shouldn't magnetise
        // the dot from farther than any other point on the wall. See wall draft.
        useAlignmentGuides
          .getState()
          .set(
            magnetic
              ? ar.guides
              : ar.guides.filter(
                  (guide) =>
                    Math.hypot(
                      snappedPoint[0] - guide.anchor.x,
                      snappedPoint[1] - guide.anchor.z,
                    ) <= WALL_CONNECT_SNAP_RADIUS,
                ),
          )
      } else {
        useAlignmentGuides.getState().clear()
      }

      if (
        previousGridPosRef.current &&
        (alignedPoint[0] !== previousGridPosRef.current[0] ||
          alignedPoint[1] !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = alignedPoint

      // Stand the magnetic beacon at the endpoint when it locked onto existing
      // wall geometry (corner / midpoint / crossing / wall body).
      useWallSnapIndicator
        .getState()
        .set(
          snapResult.snap
            ? { x: alignedPoint[0], z: alignedPoint[1], kind: snapResult.snap }
            : null,
        )

      applyPreview(alignedPoint, event.nativeEvent.altKey)
    }

    const onPointerUp = () => {
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      // The handle sits on the wall body, so the browser fires a click on the
      // wall after this release. Swallow it on EVERY endpoint-tool release (a
      // no-drag tap dismisses, a drag commits) — otherwise that click falls
      // through to the selection manager and arms the wall MOVE tool, a mode the
      // user never asked for.
      swallowNextClick()

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }
      const hasChanged = !(
        samePoint(preview.start, originalStart) && samePoint(preview.end, originalEnd)
      )

      // Endpoint still at its original spot: this release is the *grab* of a
      // click-to-move (a tap on the handle, or a press that never dragged). Stay
      // armed so the endpoint keeps following the cursor — the next release after
      // an actual move commits. A press-drag and a click thus engage identically;
      // previously the no-drag branch dismissed the tool, and whether it even ran
      // raced the window pointer-up listener mounting (hence "works once, then
      // needs a long press").
      if (!hasChanged) return

      if (isSegmentLongEnough(preview.start, preview.end)) {
        wasCommitted = true

        const linkedUpdates = altPressedRef.current
          ? []
          : getLinkedWallUpdates(
              linkedOriginalsRef.current,
              originalStart,
              originalEnd,
              preview.start,
              preview.end,
            )

        // Drop the live overrides; the store write below is the source of truth.
        // The store sat at the pre-drag (original) values the whole drag — only
        // overrides moved — so one resume+write records original→final as a
        // single tracked change (one Ctrl-Z reverts to original).
        clearPreviewOverrides()
        resumeSceneHistory(useScene)
        useScene.getState().updateNodes([
          { id: nodeId as AnyNodeId, data: { start: preview.start, end: preview.end } },
          ...linkedUpdates.map((u) => ({
            id: u.id as AnyNodeId,
            data: { start: u.start, end: u.end },
          })),
        ])
        useScene.getState().markDirty(nodeId as AnyNodeId)
        for (const u of linkedUpdates) {
          useScene.getState().markDirty(u.id as AnyNodeId)
        }
        pauseSceneHistory(useScene)
        triggerSFX('sfx:item-place')
      }

      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      setAngleLabel(null)
      exitMoveMode()
    }

    const onCancel = () => {
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      resumeSceneHistory(useScene)
      setAngleLabel(null)
      markToolCancelConsumed()
      exitMoveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      if (event.key === 'Alt') {
        altPressedRef.current = true
        setAltPressed(true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        altPressedRef.current = false
        setAltPressed(false)
      }
    }

    const onWindowBlur = () => {
      altPressedRef.current = false
      setAltPressed(false)
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      if (!wasCommitted) {
        restoreOriginal(false)
      }
      resumeSceneHistory(useScene)
      emitter.off('grid:move', onGridMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [exitMoveMode, target])

  // Live segment dimensions for the floating pill. The moving endpoint is
  // `cursorLocalPos`; the other end is fixed. Length tracks the drag (curve
  // offset is unchanged by an endpoint move); height + thickness are static.
  const movingPlanPoint: WallPlanPoint = [cursorLocalPos[0], cursorLocalPos[2]]
  const fixedPlanPoint = fixedPointRef.current
  const previewStart = target.endpoint === 'start' ? movingPlanPoint : fixedPlanPoint
  const previewEnd = target.endpoint === 'end' ? movingPlanPoint : fixedPlanPoint
  const liveLength = getWallCurveLength({
    start: previewStart,
    end: previewEnd,
    curveOffset: target.wall.curveOffset,
  })
  const wallHeight = target.wall.height ?? DEFAULT_WALL_HEIGHT
  const dimMidX = (previewStart[0] + previewEnd[0]) / 2
  const dimMidZ = (previewStart[1] + previewEnd[1]) / 2

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
      <Html
        center
        position={[dimMidX, wallHeight + 0.3, dimMidZ]}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <MeasurementPill
          height={wallHeight}
          length={liveLength}
          primary="length"
          thickness={getWallThickness(target.wall)}
          unit={unit}
        />
      </Html>
      <Html
        position={[cursorLocalPos[0], 0, cursorLocalPos[2]]}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="translate-y-10">
          <div
            className={`whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-lg backdrop-blur-md transition-colors ${
              altPressed
                ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                : 'border-border bg-background/95 text-muted-foreground'
            }`}
          >
            {altPressed ? 'Detaching corner' : 'Alt to detach'}
          </div>
        </div>
      </Html>
      {angleLabel && <EndpointAngleLabel label={angleLabel.label} position={angleLabel.position} />}
    </group>
  )
}

function EndpointAngleLabel({
  label,
  position,
}: {
  label: string
  position: [number, number, number]
}) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
      <div className="whitespace-nowrap rounded-full border border-border bg-background/95 px-2 py-1 font-mono font-semibold text-[11px] text-foreground shadow-lg backdrop-blur-md">
        {label}
      </div>
    </Html>
  )
}

export default MoveWallEndpointTool
