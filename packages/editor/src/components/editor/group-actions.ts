import {
  type AnyNode,
  type AnyNodeId,
  bboxCornerAnchors,
  collectAlignmentAnchors,
  pauseSceneHistory,
  pauseSpaceDetection,
  resolveAlignment,
  resumeSceneHistory,
  resumeSpaceDetection,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Plane, Vector2, Vector3 } from 'three'
import { GROUP_MOVE_DRAG_LABEL } from '../../lib/contextual-help'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { duplicateNodesToLevel } from '../../lib/scene-clipboard'
import { sfxEmitter } from '../../lib/sfx-bus'
import useAlignmentGuides from '../../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanGroupDrag } from '../editor-2d/floorplan-group-move'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  participantExtents,
  rotateGroupSnapshots,
  translateGroupPatches,
  type Vec2,
} from './group-transform-shared'
import { swallowNextClick } from './handles/use-handle-drag'
import { getEditorThreeContext } from './three-context-bridge'

// Whole-selection actions behind the group action menu (Move / Duplicate /
// Delete), shared by the 2D and 3D menus. The Move flow is a "pick-up": the
// selection rides the cursor (relative to where tracking starts, so nothing
// teleports) across BOTH surfaces — floor plan via the scene CTM, 3D via a
// ground-plane raycast through the bridged camera — until a click commits it
// as one undo step. Escape / right-click cancels.

const ALIGNMENT_THRESHOLD_M = 0.08
// Matches the keyboard Delete arm's accidental-bulk-delete guard.
const BULK_DELETE_THRESHOLD = 10

// Any non-empty selection can be picked up (the menus themselves gate on a
// multi-selection; Duplicate can legitimately land on a single cloned root).
function groupParticipantIds(): string[] {
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length === 0) return []
  const nodes = useScene.getState().nodes
  return selectedIds.filter(
    (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
  )
}

/** True when the current selection is a group the pick-up move can carry. */
export function canGroupPickUp(): boolean {
  return groupParticipantIds().length > 0
}

/**
 * Pick up the current multi-selection: it follows the cursor (delta-relative)
 * until a click commits, mirroring the single-node `movingNode` flow. Returns
 * false when the selection holds no transformable participants.
 *
 * `scopeToSelection` limits the moving set to the selected participants —
 * no connected-component expansion and no welded-neighbor endpoints. The
 * Duplicate flow needs this: its clones sit EXACTLY on the originals, so
 * junction coincidence would otherwise weld the originals into the pick-up
 * and drag them along with the copies.
 */
export function startGroupPickUp(
  opts: { onCancel?: () => void; scopeToSelection?: boolean } = {},
): boolean {
  const { selectedIds, levelId } = useViewer.getState().selection
  const participantIds = groupParticipantIds()
  if (participantIds.length === 0) return false
  const nodes = useScene.getState().nodes
  const fullIds = opts.scopeToSelection
    ? participantIds
    : expandToComponent(participantIds, nodes, levelId)
  const collected = collectParticipants(fullIds, nodes, levelId)
  // Mutable: mid-carry R/T rotates these snapshots in place.
  let starts = collected.starts
  let links = opts.scopeToSelection ? [] : collected.links
  if (starts.length === 0) return false
  const affectedIds: AnyNodeId[] = [...starts.map((s) => s.id), ...links.map((l) => l.id)]

  // Rest bounds in the level frame. Prefer the mounted meshes' world box
  // (footprint-accurate), but fall back to the participant DATA when the
  // meshes aren't up yet — Duplicate starts the pick-up synchronously after
  // `createNodes`, one frame before the clones' renderers mount.
  const { inverse: frameInv } = levelFrame(levelId)
  const restBox = computeGroupBox(fullIds)
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  if (restBox) {
    const boxMin = restBox.min.clone().applyMatrix4(frameInv)
    const boxMax = restBox.max.clone().applyMatrix4(frameInv)
    minX = Math.min(boxMin.x, boxMax.x)
    minZ = Math.min(boxMin.z, boxMax.z)
    maxX = Math.max(boxMin.x, boxMax.x)
    maxZ = Math.max(boxMin.z, boxMax.z)
  } else {
    const reach = (x: number, z: number) => {
      minX = Math.min(minX, x)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxZ = Math.max(maxZ, z)
    }
    for (const s of starts) {
      if (s.kind === 'endpoint') {
        reach(s.start[0], s.start[1])
        reach(s.end[0], s.end[1])
      } else if (s.kind === 'polygon') {
        for (const [x, z] of s.polygon) {
          reach(x, z)
        }
      } else {
        reach(s.position[0], s.position[2])
      }
    }
  }
  if (!Number.isFinite(minX)) return false
  // Rotation pivot for mid-carry R/T; stable across the whole pick-up.
  const restCenter: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  // Ground plane for the 3D surface: the meshes' base when available, floor
  // level otherwise. Placements live in the level frame, so both surfaces
  // resolve into it before measuring.
  const plane = new Plane(new Vector3(0, 1, 0), -(restBox?.min.y ?? 0))

  // Alignment candidates — everything outside the moving set; the group
  // aligns as one rigid footprint via its bbox corners + center.
  const movingIdSet = new Set<string>(affectedIds)
  const staticNodes: Record<string, AnyNode> = {}
  for (const [nid, n] of Object.entries(nodes)) {
    if (n && !movingIdSet.has(nid)) staticNodes[nid] = n
  }
  const candidates = collectAlignmentAnchors(staticNodes, '', levelId)
  let restAnchors = bboxCornerAnchors('group-move', minX, minZ, maxX, maxZ)

  // Cursor → level-frame plan point, whichever surface the pointer is over.
  const ndc = new Vector2()
  const resolvePlanPoint = (e: PointerEvent): Vec2 | null => {
    const three = getEditorThreeContext()
    if (three && e.target === three.domElement) {
      const rect = three.domElement.getBoundingClientRect()
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      three.raycaster.setFromCamera(ndc, three.camera)
      const hit = new Vector3()
      if (!three.raycaster.ray.intersectPlane(plane, hit)) return null
      const local = hit.applyMatrix4(frameInv)
      return [local.x, local.z]
    }
    // Anywhere inside the floor-plan viewport counts (the scene `<g>` only
    // covers painted elements, so bounds-test the owning SVG).
    const sceneEl = document.querySelector('g[data-floorplan-scene]') as SVGGElement | null
    const svg = sceneEl?.ownerSVGElement
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return null
    }
    const plan = clientToPlan(e.clientX, e.clientY)
    return plan ? [plan[0], plan[1]] : null
  }

  let startPlan: Vec2 | null = null
  let lastDelta: Vec2 | null = null

  for (const id of affectedIds) {
    useLiveTransforms.getState().clear(id)
  }
  sfxEmitter.emit('sfx:item-pick')
  pauseSceneHistory(useScene)
  useInteractionScope.getState().begin({
    kind: 'handle-drag',
    nodeId: (participantIds[0] ?? '') as AnyNodeId,
    handle: GROUP_MOVE_DRAG_LABEL,
  })
  document.body.style.cursor = 'grabbing'

  const applyMove = (e: PointerEvent) => {
    const plan = resolvePlanPoint(e)
    if (!plan) return
    // Delta-relative to where tracking starts so the group never teleports
    // to the cursor.
    if (!startPlan) {
      startPlan = plan
      return
    }
    const step = useEditor.getState().gridSnapStep
    const snap = isGridSnapActive() && step > 0
    let dx = snap ? Math.round((plan[0] - startPlan[0]) / step) * step : plan[0] - startPlan[0]
    let dz = snap ? Math.round((plan[1] - startPlan[1]) / step) * step : plan[1] - startPlan[1]

    if (isAlignmentGuideActive() && candidates.length > 0 && restAnchors.length > 0) {
      const result = resolveAlignment({
        moving: restAnchors.map((a) => ({ ...a, x: a.x + dx, z: a.z + dz })),
        candidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      if (result.snap && isMagneticSnapActive()) {
        dx += result.snap.dx
        dz += result.snap.dz
      }
      useAlignmentGuides.getState().set(result.guides)
    } else {
      useAlignmentGuides.getState().clear()
    }

    applyDelta(dx, dz)
  }

  const applyDelta = (dx: number, dz: number) => {
    if (!lastDelta || lastDelta[0] !== dx || lastDelta[1] !== dz) {
      sfxEmitter.emit('sfx:grid-snap')
      lastDelta = [dx, dz]
    }

    const entries = translateGroupPatches(starts, links, dx, dz)
    const patchById = new Map(entries)
    const liveTransforms = useLiveTransforms.getState()
    for (const start of starts) {
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
    for (const l of links) {
      useScene.getState().markDirty(l.id)
    }
    useLiveNodeOverrides.getState().setMany(entries)
    useFloorplanGroupDrag.getState().set([dx, dz])
  }

  // Mid-carry R/T: rotate the SNAPSHOTS around the rest pivot and re-apply
  // the current delta — the carried group turns exactly like the idle
  // keyboard rotate, and the placement stays a single updateNodes.
  const rotateCarried = (direction: 1 | -1) => {
    const rotated = rotateGroupSnapshots(
      starts,
      links,
      { x: restCenter[0], z: restCenter[1] },
      -direction * (Math.PI / 4),
    )
    starts = rotated.starts
    links = rotated.links
    const ext = participantExtents(rotated.starts)
    if (ext) {
      restAnchors = bboxCornerAnchors('group-move', ext.minX, ext.minZ, ext.maxX, ext.maxZ)
    }
    sfxEmitter.emit('sfx:item-rotate')
    applyDelta(lastDelta?.[0] ?? 0, lastDelta?.[1] ?? 0)
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
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
  }

  // History resume pairs one-to-one with the pause above, on the commit and
  // cancel paths only.
  const teardown = () => {
    removeListeners()
    if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    useAlignmentGuides.getState().clear()
    useInteractionScope
      .getState()
      .endIf((sc) => sc.kind === 'handle-drag' && sc.handle === GROUP_MOVE_DRAG_LABEL)
    useFloorplanGroupDrag.getState().set(null)
  }

  const commit = () => {
    swallowNextClick()
    sfxEmitter.emit('sfx:item-place')
    const overrides = useLiveNodeOverrides.getState()
    const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
    for (const id of affectedIds) {
      const patch = overrides.get(id)
      if (patch) updates.push({ id, data: patch as Partial<AnyNode> })
    }
    // Group transforms move existing structure rigidly — the wall-driven room
    // auto-detection must not re-create floors/ceilings for the walls' new
    // positions (that belongs to wall building/editing). Paused around the
    // commit; the sync rolls its baseline forward for paused changes.
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
    opts.onCancel?.()
  }

  const onMove = (e: PointerEvent) => {
    applyMove(e)
  }

  // Capture phase: commit before the press reaches selection / tools, so the
  // drop click can't also select whatever lands under the cursor.
  // The placement gesture: the press over a tracked surface is claimed in
  // capture phase and the commit runs on ITS pointerup, also claimed — the
  // canvas never sees either, so `use-node-events` cannot synthesize a
  // selection click from the release (which would re-select whatever sits
  // under the cursor and break the multi-selection).
  let commitPointerId: number | null = null

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    if (e.button !== 0) return
    // Only a press over a tracked surface commits; a click on side panels or
    // the toolbar keeps the pick-up alive.
    if (!resolvePlanPoint(e)) return
    e.preventDefault()
    e.stopPropagation()
    commitPointerId = e.pointerId
  }

  const onPointerUp = (e: PointerEvent) => {
    if (commitPointerId === null || e.pointerId !== commitPointerId) return
    commitPointerId = null
    // Raise `inputDragging` through this event's dispatch so the canvas's
    // use-node-events suppresses the selection click it synthesizes on every
    // pointerup (stopPropagation would also break the window bubble
    // listeners that clear the box-select pointer suppression).
    useViewer.getState().setInputDragging(true)
    setTimeout(() => useViewer.getState().setInputDragging(false), 0)
    commit()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase()
    if ((key === 'r' || key === 't') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      rotateCarried(key === 'r' ? 1 : -1)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Deleting mid-carry: put the group down first (revert), then let the
      // global Delete arm remove the selection — no dangling carry. The
      // duplicate flow's onCancel already discards the clones instead.
      cancel()
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    cancel()
  }

  const onContextMenu = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  return true
}

/**
 * Duplicate the whole selection (subtrees + id remap via the clipboard
 * pipeline, without touching the clipboard), select the clones, and pick
 * them up so the next click places them. Cancelling the pick-up removes the
 * clones again.
 */
export function duplicateSelectionAndPickUp(): boolean {
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length < 2) return false
  const result = duplicateNodesToLevel(
    selectedIds as AnyNodeId[],
    (levelId ?? undefined) as AnyNodeId | undefined,
  )
  if (!result || result.pastedIds.length === 0) return false
  sfxEmitter.emit('sfx:item-pick')
  startGroupPickUp({
    scopeToSelection: true,
    onCancel: () => {
      useScene.getState().deleteNodes(result.pastedIds)
      useViewer.getState().setSelection({ selectedIds: [] })
    },
  })
  return true
}

/**
 * Delete every selected node — same semantics as the keyboard Delete arm,
 * including the accidental-bulk-delete confirm.
 */
export function deleteSelection(): boolean {
  const selectedIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
  if (selectedIds.length === 0) return false
  if (selectedIds.length >= BULK_DELETE_THRESHOLD) {
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected elements? This cannot be undone if the undo history is exhausted.`,
    )
    if (!confirmed) return false
  }
  sfxEmitter.emit('sfx:structure-delete')
  useScene.getState().deleteNodes(selectedIds)
  useViewer.getState().setSelection({ selectedIds: [] })
  return true
}
