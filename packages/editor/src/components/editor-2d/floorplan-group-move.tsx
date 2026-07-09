'use client'

import {
  type AnyNode,
  type AnyNodeId,
  bboxCornerAnchors,
  collectAlignmentAnchors,
  type FloorplanPalette,
  pauseSceneHistory,
  pauseSpaceDetection,
  resumeSceneHistory,
  resumeSpaceDetection,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useMemo } from 'react'
import { create } from 'zustand'
import { GROUP_MOVE_DRAG_LABEL } from '../../lib/contextual-help'
import { applyFloorplanAlignment } from '../../lib/floorplan/apply-alignment'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { sfxEmitter } from '../../lib/sfx-bus'
import useAlignmentGuides from '../../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  translateGroupPatches,
  type Vec2,
} from '../editor/group-transform-shared'
import { swallowNextClick } from '../editor/handles/use-handle-drag'

// 2D sibling of the 3D body-drag group move (`group-move-3d.ts`): dragging
// any selected element of a multi-selection slides the whole selection
// rigidly (Photoshop semantics). Both share the participant snapshot +
// translate math, the live preview channel (`useLiveNodeOverrides.setMany` +
// welded `LinkedNeighbor` endpoints), the snapping entry points (grid step
// via `isGridSnapActive`, Figma alignment via the shared resolver), and the
// single-undo commit (history pause → one `updateNodes` → resume).

// Same engage threshold as the layer's Cmd-drag direct move.
const DRAG_THRESHOLD_PX = 4

// Live plan-frame drag delta, published so the dashed group bbox overlay
// rides along without re-rendering the whole registry layer per tick.
type FloorplanGroupDragState = {
  delta: Vec2 | null
  set: (delta: Vec2 | null) => void
}
export const useFloorplanGroupDrag = create<FloorplanGroupDragState>((set) => ({
  delta: null,
  set: (delta) => set({ delta }),
}))

/**
 * Try to start a 2D group move for a pointer-down on `nodeId`. Returns false
 * (attaching nothing) unless the node is a transformable member of a
 * multi-selection — the caller falls through to its single-node behavior.
 *
 * `immediate` engages the session on pointer-down (move-handle dot semantics:
 * the dot is an explicit move control); otherwise the session arms and only
 * engages once the pointer travels past the drag threshold, and a plain
 * click falls through to `onClickFallthrough` (the collapse-to-single
 * selection click).
 */
export function startFloorplanGroupMove(
  nodeId: AnyNodeId,
  event: { clientX: number; clientY: number; pointerId: number },
  opts: { immediate?: boolean; onClickFallthrough?: () => void } = {},
): boolean {
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length < 2 || !selectedIds.includes(nodeId)) return false
  const sceneNodes = useScene.getState().nodes
  // The pressed element itself must transform — dragging a selected door /
  // window (which rides its host wall) keeps today's single-node behavior.
  if (classifyParticipant(sceneNodes[nodeId], levelId, sceneNodes) === null) return false
  const startPlan = clientToPlan(event.clientX, event.clientY)
  if (!startPlan) return false

  const startX = event.clientX
  const startY = event.clientY
  const pointerId = event.pointerId

  type Session = {
    starts: ReturnType<typeof collectParticipants>['starts']
    links: ReturnType<typeof collectParticipants>['links']
    affectedIds: AnyNodeId[]
    candidates: ReturnType<typeof collectAlignmentAnchors>
    restAnchors: ReturnType<typeof bboxCornerAnchors>
    lastDelta: Vec2 | null
  }
  let session: Session | null = null

  const engage = (): Session | null => {
    const nodes = useScene.getState().nodes
    const participantIds = selectedIds.filter(
      (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
    )
    // Move the full connected wall/fence component, mirroring the 3D gizmo.
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const { starts, links } = collectParticipants(fullIds, nodes, levelId)
    if (starts.length === 0) return null
    const affectedIds: AnyNodeId[] = [...starts.map((s) => s.id), ...links.map((l) => l.id)]

    // Alignment candidates — anchors of everything OUTSIDE the moving set
    // (selection + welded neighbours), gathered once at drag start.
    const movingIdSet = new Set<string>(affectedIds)
    const staticNodes: Record<string, AnyNode> = {}
    for (const [nid, n] of Object.entries(nodes)) {
      if (n && !movingIdSet.has(nid)) staticNodes[nid] = n
    }
    const candidates = collectAlignmentAnchors(staticNodes, '', levelId)

    // The group aligns as one rigid footprint: its bbox corners + center are
    // the moving anchors. `computeGroupBox` is world-space (the 3D scene stays
    // mounted under every view mode); plan coords are level-frame, so convert.
    const restBox = computeGroupBox(fullIds)
    const { inverse: frameInv } = levelFrame(levelId)
    const boxMin = restBox ? restBox.min.clone().applyMatrix4(frameInv) : null
    const boxMax = restBox ? restBox.max.clone().applyMatrix4(frameInv) : null
    const restAnchors =
      boxMin && boxMax
        ? bboxCornerAnchors(
            'group-move',
            Math.min(boxMin.x, boxMax.x),
            Math.min(boxMin.z, boxMax.z),
            Math.max(boxMin.x, boxMax.x),
            Math.max(boxMin.z, boxMax.z),
          )
        : []

    for (const id of affectedIds) {
      useLiveTransforms.getState().clear(id)
    }

    document.body.style.cursor = 'grabbing'
    sfxEmitter.emit('sfx:item-pick')
    swallowNextClick()
    useViewer.getState().setInputDragging(true)
    pauseSceneHistory(useScene)
    useInteractionScope.getState().begin({
      kind: 'handle-drag',
      nodeId,
      handle: GROUP_MOVE_DRAG_LABEL,
    })
    return { starts, links, affectedIds, candidates, restAnchors, lastDelta: null }
  }

  const applyMove = (e: PointerEvent, s: Session) => {
    const plan = clientToPlan(e.clientX, e.clientY)
    if (!plan) return
    // Snap the slide DELTA to the active grid step so the selection's
    // internal layout stays intact — grid-aligned members stay aligned.
    // Mode-driven like the 3D group move: the `handle-drag` scope resolves
    // to the item snap context, so Shift cycles the mode mid-drag.
    const step = useEditor.getState().gridSnapStep
    const snap = isGridSnapActive() && step > 0
    let dx = snap ? Math.round((plan[0] - startPlan[0]) / step) * step : plan[0] - startPlan[0]
    let dz = snap ? Math.round((plan[1] - startPlan[1]) / step) * step : plan[1] - startPlan[1]

    // Figma-style alignment layered on top: guides display in every mode
    // except Off; the magnetic pull applies only in 'lines' mode.
    if (isAlignmentGuideActive() && s.candidates.length > 0 && s.restAnchors.length > 0) {
      const proposed: [number, number] = [startPlan[0] + dx, startPlan[1] + dz]
      const aligned = applyFloorplanAlignment(
        proposed,
        s.restAnchors.map((a) => ({ ...a, x: a.x + dx, z: a.z + dz })),
        s.candidates,
        { applySnap: isMagneticSnapActive() },
      )
      dx = aligned.point[0] - startPlan[0]
      dz = aligned.point[1] - startPlan[1]
    } else {
      useAlignmentGuides.getState().clear()
    }

    // Ticker on each delta change — parity with the 3D group move's SFX.
    if (!s.lastDelta || s.lastDelta[0] !== dx || s.lastDelta[1] !== dz) {
      sfxEmitter.emit('sfx:grid-snap')
      s.lastDelta = [dx, dz]
    }

    const entries = translateGroupPatches(s.starts, s.links, dx, dz)
    const patchById = new Map(entries)
    const liveTransforms = useLiveTransforms.getState()
    for (const start of s.starts) {
      if (start.kind === 'scalar') {
        const patch = patchById.get(start.id)
        if (patch) {
          liveTransforms.set(start.id, {
            position: patch.position as [number, number, number],
            rotation: start.rotation,
          })
        }
      }
      useScene.getState().markDirty(start.id)
    }
    for (const l of s.links) {
      useScene.getState().markDirty(l.id)
    }
    useLiveNodeOverrides.getState().setMany(entries)
    useFloorplanGroupDrag.getState().set([dx, dz])
  }

  const clearLivePreviews = (s: Session) => {
    const overrides = useLiveNodeOverrides.getState()
    const liveTransforms = useLiveTransforms.getState()
    for (const id of s.affectedIds) {
      overrides.clear(id)
      liveTransforms.clear(id)
      useScene.getState().markDirty(id)
    }
  }

  const removeListeners = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
  }

  // History resume is NOT here — it pairs exactly one-to-one with the
  // `pauseSceneHistory` in `engage()`, on the commit and cancel paths.
  const teardown = () => {
    removeListeners()
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    useAlignmentGuides.getState().clear()
    useViewer.getState().setInputDragging(false)
    useInteractionScope
      .getState()
      .endIf((sc) => sc.kind === 'handle-drag' && sc.handle === GROUP_MOVE_DRAG_LABEL)
    useFloorplanGroupDrag.getState().set(null)
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (!session) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      session = engage()
      if (!session) {
        removeListeners()
        return
      }
    }
    applyMove(e, session)
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (!session) {
      removeListeners()
      opts.onClickFallthrough?.()
      return
    }
    // Eat the click that follows pointer-up so the background click handler
    // doesn't clear the multi-selection the drag is preserving.
    swallowNextClick()
    sfxEmitter.emit('sfx:item-place')
    const overrides = useLiveNodeOverrides.getState()
    const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
    for (const id of session.affectedIds) {
      const patch = overrides.get(id)
      if (patch) updates.push({ id, data: patch as Partial<AnyNode> })
    }
    // Resume before the commit so the single batched `updateNodes` is the one
    // tracked set — collapsing the whole group move into one undo step.
    // Group transforms move existing structure rigidly — the wall-driven room
    // auto-detection must not re-create floors/ceilings for the walls' new
    // positions (that belongs to wall building/editing). Paused around the
    // commit; the sync rolls its baseline forward for paused changes.
    pauseSpaceDetection()
    resumeSceneHistory(useScene)
    if (updates.length > 0) useScene.getState().updateNodes(updates)
    resumeSpaceDetection()
    clearLivePreviews(session)
    session = null
    teardown()
  }

  const cancel = () => {
    if (session) {
      clearLivePreviews(session)
      resumeSceneHistory(useScene)
      session = null
    }
    teardown()
  }

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    cancel()
  }

  // Capture phase so the drag's Escape wins over the global `use-keyboard`
  // Escape arm (registered earlier on window in the bubble phase), which
  // would otherwise clear the multi-selection mid-cancel.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    swallowNextClick()
    cancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown, true)

  if (opts.immediate) {
    session = engage()
    if (!session) {
      removeListeners()
      return false
    }
  }
  return true
}

/**
 * Dashed bounding box around the current multi-selection's transformable
 * participants (expanded to the welded wall/fence component) — shows what a
 * group drag will carry along. Rides the live drag delta so it tracks the
 * group mid-gesture. Mounted inside the floor-plan scene `<g>`, so plan
 * coords render directly.
 */
export const FloorplanGroupSelectionBox = memo(function FloorplanGroupSelectionBox({
  palette,
  unitsPerPixel,
}: {
  palette: FloorplanPalette | undefined
  unitsPerPixel: number
}) {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  const delta = useFloorplanGroupDrag((s) => s.delta)
  const movingNode = useMovingNode()

  const box = useMemo(() => {
    if (selectedIds.length < 2 || !levelId) return null
    const participantIds = selectedIds.filter(
      (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
    )
    if (participantIds.length === 0) return null
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const world = computeGroupBox(fullIds)
    if (!world) return null
    const { inverse } = levelFrame(levelId)
    const min = world.min.clone().applyMatrix4(inverse)
    const max = world.max.clone().applyMatrix4(inverse)
    return {
      x: Math.min(min.x, max.x),
      z: Math.min(min.z, max.z),
      width: Math.abs(max.x - min.x),
      depth: Math.abs(max.z - min.z),
    }
  }, [selectedIds, levelId, nodes])

  if (!box || movingNode) return null

  const pad = 6 * unitsPerPixel
  const stroke = palette?.selectedStroke ?? '#3b82f6'
  return (
    <g
      data-group-selection-box
      pointerEvents="none"
      transform={delta ? `translate(${delta[0]} ${delta[1]})` : undefined}
    >
      <rect
        fill="none"
        height={box.depth + 2 * pad}
        stroke={stroke}
        strokeDasharray={`${4 * unitsPerPixel} ${3 * unitsPerPixel}`}
        strokeWidth={1.2 * unitsPerPixel}
        width={box.width + 2 * pad}
        x={box.x - pad}
        y={box.z - pad}
      />
    </g>
  )
})
