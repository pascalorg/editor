'use client'

import {
  type AnyNode,
  type AnyNodeId,
  bboxCornerAnchors,
  collectAlignmentAnchors,
  DEFAULT_ANGLE_STEP,
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
import { memo, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { GROUP_MOVE_DRAG_LABEL, GROUP_ROTATE_DRAG_LABEL } from '../../lib/contextual-help'
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
  participantExtents,
  rotateGroupPatches,
  rotateGroupSnapshots,
  translateGroupPatches,
  type Vec2,
} from '../editor/group-transform-shared'
import { swallowNextClick } from '../editor/handles/use-handle-drag'
import { useMeshSettleEpoch } from '../editor/use-mesh-settle-epoch'

// 2D sibling of the 3D body-drag group move (`group-move-3d.ts`): dragging
// any selected element of a multi-selection slides the whole selection
// rigidly (Photoshop semantics). Both share the participant snapshot +
// translate math, the live preview channel (`useLiveNodeOverrides.setMany` +
// welded `LinkedNeighbor` endpoints), the snapping entry points (grid step
// via `isGridSnapActive`, Figma alignment via the shared resolver), and the
// single-undo commit (history pause → one `updateNodes` → resume).

// Same engage threshold as the layer's Cmd-drag direct move.
const DRAG_THRESHOLD_PX = 4

// Live plan-frame drag delta / rotation, published so the dashed group bbox
// overlay rides along without re-rendering the whole registry layer per tick.
type FloorplanGroupDragState = {
  delta: Vec2 | null
  rotation: { pivotX: number; pivotZ: number; angle: number } | null
  set: (delta: Vec2 | null) => void
  setRotation: (rotation: FloorplanGroupDragState['rotation']) => void
}
export const useFloorplanGroupDrag = create<FloorplanGroupDragState>((set) => ({
  delta: null,
  rotation: null,
  set: (delta) => set({ delta }),
  setRotation: (rotation) => set({ rotation }),
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
    restCenter: Vec2
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
    // Rotation pivot for mid-drag R/T — the participant DATA extents' center
    // (stable across the drag; rotations re-seed around the same point).
    const ext = participantExtents(starts)
    const restCenter: Vec2 = ext ? [(ext.minX + ext.maxX) / 2, (ext.minZ + ext.maxZ) / 2] : [0, 0]

    return { starts, links, affectedIds, candidates, restAnchors, restCenter, lastDelta: null }
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

    applyDelta(s, dx, dz)
  }

  const applyDelta = (s: Session, dx: number, dz: number) => {
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

  // Mid-drag R/T: rotate the SNAPSHOTS around the rest pivot and re-apply the
  // current delta — the carried group turns exactly like the idle keyboard
  // rotate, and the commit stays a single updateNodes.
  const rotateSession = (s: Session, direction: 1 | -1) => {
    const rotated = rotateGroupSnapshots(
      s.starts,
      s.links,
      { x: s.restCenter[0], z: s.restCenter[1] },
      -direction * (Math.PI / 4),
    )
    s.starts = rotated.starts
    s.links = rotated.links
    const ext = participantExtents(rotated.starts)
    if (ext) {
      s.restAnchors = bboxCornerAnchors('group-move', ext.minX, ext.minZ, ext.maxX, ext.maxZ)
    }
    sfxEmitter.emit('sfx:item-rotate')
    applyDelta(s, s.lastDelta?.[0] ?? 0, s.lastDelta?.[1] ?? 0)
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
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
  }

  // History resume is NOT here — it pairs exactly one-to-one with the
  // `pauseSceneHistory` in `engage()`, on the commit and cancel paths.
  const teardown = () => {
    removeListeners()
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    useAlignmentGuides.getState().clear()
    // Deferred so a canvas pointerup later in this same dispatch still sees
    // the drag as active (split view — see onUp).
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
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

  // Capture-phase registration: in split view the release can land over the
  // 3D canvas, whose use-node-events synthesizes a selection click on every
  // pointerup — suppressed while `inputDragging` is raised, which teardown
  // therefore lowers on a 0ms timer (after this event's dispatch).
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
    const key = e.key.toLowerCase()
    if ((key === 'r' || key === 't') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (!session) return
      e.preventDefault()
      e.stopPropagation()
      rotateSession(session, key === 'r' ? 1 : -1)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Deleting mid-move: revert the session first, then let the global
      // Delete arm remove the selection — no dangling carry.
      cancel()
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    swallowNextClick()
    cancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, true)
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
 * 2D group rotate, driven from the dashed selection box's corner handles —
 * the floor-plan sibling of the 3D `GroupRotateHandle`. The group spins
 * rigidly around its data-extents center; 15° increments by default, Shift
 * for free rotation, one `updateNodes` on release (one undo step).
 */
export function startFloorplanGroupRotate(event: {
  clientX: number
  clientY: number
  pointerId: number
}): boolean {
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length < 2) return false
  const nodes = useScene.getState().nodes
  const participantIds = selectedIds.filter(
    (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
  )
  if (participantIds.length === 0) return false
  const fullIds = expandToComponent(participantIds, nodes, levelId)
  const { starts, links } = collectParticipants(fullIds, nodes, levelId)
  if (starts.length === 0) return false
  const affectedIds: AnyNodeId[] = [...starts.map((s) => s.id), ...links.map((l) => l.id)]
  const ext = participantExtents(starts)
  if (!ext) return false
  const pivot = { x: (ext.minX + ext.maxX) / 2, z: (ext.minZ + ext.maxZ) / 2 }
  const startPlan = clientToPlan(event.clientX, event.clientY)
  if (!startPlan) return false
  // Bearing around the pivot in the plan frame — the same atan2 x→z sense
  // `rotateGroupPatches` orbits in.
  const angleOf = (p: readonly [number, number]) => Math.atan2(p[1] - pivot.z, p[0] - pivot.x)
  const initialAngle = angleOf(startPlan)
  const pointerId = event.pointerId

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
    nodeId: (participantIds[0] ?? '') as AnyNodeId,
    handle: GROUP_ROTATE_DRAG_LABEL,
  })

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const plan = clientToPlan(e.clientX, e.clientY)
    if (!plan) return
    let delta = angleOf([plan[0], plan[1]]) - initialAngle
    while (delta > Math.PI) delta -= 2 * Math.PI
    while (delta < -Math.PI) delta += 2 * Math.PI
    // 15° increments by default; Shift rotates freely — the same contract
    // as the 3D group rotate gizmo (and the HUD hint its scope surfaces).
    if (!e.shiftKey) delta = Math.round(delta / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP

    const entries = rotateGroupPatches(starts, links, pivot, delta)
    const patchById = new Map(entries)
    const liveTransforms = useLiveTransforms.getState()
    for (const start of starts) {
      if (start.kind === 'scalar') {
        const patch = patchById.get(start.id)
        if (patch) {
          liveTransforms.set(start.id, {
            position: patch.position as [number, number, number],
            rotation: patch.rotation as number,
          })
        }
      }
      useScene.getState().markDirty(start.id)
    }
    for (const l of links) {
      useScene.getState().markDirty(l.id)
    }
    useLiveNodeOverrides.getState().setMany(entries)
    // The dashed box spins with the group for live feedback.
    useFloorplanGroupDrag.getState().setRotation({ pivotX: pivot.x, pivotZ: pivot.z, angle: delta })
  }

  const clearLivePreviews = () => {
    const overrides = useLiveNodeOverrides.getState()
    const liveTransforms = useLiveTransforms.getState()
    for (const id of affectedIds) {
      overrides.clear(id)
      liveTransforms.clear(id)
      useScene.getState().markDirty(id)
    }
  }

  const removeListeners = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKeyDown, true)
  }

  // History resume pairs one-to-one with the pause above, on the commit and
  // cancel paths only.
  const teardown = () => {
    removeListeners()
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    // Deferred so a canvas pointerup later in this same dispatch still sees
    // the drag as active (split view — see onUp).
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
    useInteractionScope
      .getState()
      .endIf((sc) => sc.kind === 'handle-drag' && sc.handle === GROUP_ROTATE_DRAG_LABEL)
    useFloorplanGroupDrag.getState().setRotation(null)
  }

  // Capture registration + deferred inputDragging — see the drag session.
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    swallowNextClick()
    sfxEmitter.emit('sfx:item-place')
    const overrides = useLiveNodeOverrides.getState()
    const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
    for (const id of affectedIds) {
      const patch = overrides.get(id)
      if (patch) updates.push({ id, data: patch as Partial<AnyNode> })
    }
    // One tracked set = one undo step; rigid rotations must not re-create
    // the room's auto floors/ceilings (see the move sessions).
    pauseSpaceDetection()
    resumeSceneHistory(useScene)
    if (updates.length > 0) useScene.getState().updateNodes(updates)
    resumeSpaceDetection()
    clearLivePreviews()
    teardown()
  }

  const cancel = () => {
    clearLivePreviews()
    resumeSceneHistory(useScene)
    teardown()
  }

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    cancel()
  }

  // Capture phase so Escape wins over the global `use-keyboard` arm.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Deleting mid-rotate: revert first, then let the global Delete arm run.
      cancel()
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    swallowNextClick()
    cancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown, true)
  return true
}

const GROUP_BOX_CURSOR_STYLE = { cursor: 'move' } as const
// Curved-arrow rotate cursor (no native CSS equivalent) — black glyph with a
// white halo so it reads on light and dark plans; falls back to `grab`.
const ROTATE_CURSOR_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g><g fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g></svg>',
)
const GROUP_BOX_ROTATE_CURSOR_STYLE = {
  cursor: `url("data:image/svg+xml,${ROTATE_CURSOR_SVG}") 11 11, grab`,
} as const

/**
 * Dashed bounding box around the current multi-selection's transformable
 * participants (expanded to the welded wall/fence component) — shows what a
 * group drag will carry along, and IS the group's drag handle: press anywhere
 * inside it to slide the group, click to pick it up. Holding a selection
 * modifier (Cmd/Ctrl/Shift) lets pointer events pass through so members under
 * the box can still be toggled in and out. Rides the live drag delta so it
 * tracks the group mid-gesture. Mounted inside the floor-plan scene `<g>`, so
 * plan coords render directly.
 */
export const FloorplanGroupSelectionBox = memo(function FloorplanGroupSelectionBox({
  palette,
  unitsPerPixel,
  onPointerDown,
  onRotatePointerDown,
}: {
  palette: FloorplanPalette | undefined
  unitsPerPixel: number
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
  onRotatePointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
}) {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  const delta = useFloorplanGroupDrag((s) => s.delta)
  const liveRotation = useFloorplanGroupDrag((s) => s.rotation)
  const movingNode = useMovingNode()
  const mode = useEditor((s) => s.mode)

  // While a selection modifier is held the box steps aside so clicks reach
  // the entries underneath (toggle membership) instead of starting a drag.
  const [modifierHeld, setModifierHeld] = useState(false)
  useEffect(() => {
    const update = (e: KeyboardEvent) => setModifierHeld(e.metaKey || e.ctrlKey || e.shiftKey)
    const clear = () => setModifierHeld(false)
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', clear)
    }
  }, [])

  // `meshEpoch` re-runs the measurement once the meshes settle after a scene
  // change (undo/redo included) — `computeGroupBox` reads mesh world bounds,
  // which lag the `nodes` commit by a frame or two.
  const meshEpoch = useMeshSettleEpoch(nodes)
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: meshEpoch re-measures settled meshes
  }, [selectedIds, levelId, nodes, meshEpoch])

  if (!box || movingNode || mode === 'delete') return null

  const pad = 6 * unitsPerPixel
  const stroke = palette?.selectedStroke ?? '#3b82f6'
  const interactive = !modifierHeld && !!onPointerDown
  // Mid-gesture the box rides the live delta (group move) or spins around the
  // rotation pivot (corner rotate) — SVG rotate() is degrees around a plan
  // point, and positive matches the atan2 x→z sense on the y-down plan.
  const transform = liveRotation
    ? `rotate(${(liveRotation.angle * 180) / Math.PI} ${liveRotation.pivotX} ${liveRotation.pivotZ})`
    : delta
      ? `translate(${delta[0]} ${delta[1]})`
      : undefined
  return (
    <g
      data-group-selection-box
      onPointerDown={interactive ? onPointerDown : undefined}
      pointerEvents={interactive ? 'auto' : 'none'}
      style={interactive ? GROUP_BOX_CURSOR_STYLE : undefined}
      transform={transform}
    >
      <rect
        fill="transparent"
        height={box.depth + 2 * pad}
        stroke={stroke}
        strokeDasharray={`${4 * unitsPerPixel} ${3 * unitsPerPixel}`}
        strokeWidth={1.2 * unitsPerPixel}
        width={box.width + 2 * pad}
        x={box.x - pad}
        y={box.z - pad}
      />
      {/* Corner rotate handles — the 2D counterpart of the 3D rotate gizmo:
          drag a corner to spin the group (15° steps, Shift = free). */}
      {interactive && onRotatePointerDown
        ? (
            [
              [box.x - pad, box.z - pad],
              [box.x + box.width + pad, box.z - pad],
              [box.x + box.width + pad, box.z + box.depth + pad],
              [box.x - pad, box.z + box.depth + pad],
            ] as Array<[number, number]>
          ).map(([cx, cz], index) => (
            <g
              data-group-rotate-handle
              key={`corner-${index}`}
              onPointerDown={(event) => {
                event.stopPropagation()
                onRotatePointerDown(event)
              }}
              style={GROUP_BOX_ROTATE_CURSOR_STYLE}
            >
              <circle cx={cx} cy={cz} fill="transparent" r={8 * unitsPerPixel} />
              <circle
                cx={cx}
                cy={cz}
                fill="#ffffff"
                r={3.2 * unitsPerPixel}
                stroke={stroke}
                strokeWidth={1.2 * unitsPerPixel}
              />
            </g>
          ))
        : null}
    </g>
  )
})
