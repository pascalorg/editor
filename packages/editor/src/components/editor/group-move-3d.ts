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
import { type Camera, Plane, type Raycaster, Vector2, Vector3 } from 'three'
import { GROUP_MOVE_DRAG_LABEL } from '../../lib/contextual-help'
import { sfxEmitter } from '../../lib/sfx-bus'
import useAlignmentGuides from '../../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanGroupDrag } from '../editor-2d/floorplan-group-move'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { startGroupPickUp } from './group-actions'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  translateGroupPatches,
  type Vec2,
} from './group-transform-shared'
import { swallowNextClick } from './handles/use-handle-drag'

// 3D sibling of the 2D floorplan group move (and successor of the removed
// group-move gizmo cross): pressing any selected element's body in a
// multi-selection and dragging past the threshold slides the whole selection
// on the ground plane; a plain click (no drag) enters the group pick-up,
// parity with the single-item click-to-move. Shares the group participant
// snapshot, welded junctions, snapping entry points, live override previews,
// and single-undo commit with the 2D session.

// Figma-style alignment-snap threshold (meters) — same pull distance as the
// single-node registry move.
const ALIGNMENT_THRESHOLD_M = 0.08
const DRAG_THRESHOLD_PX = 4

/**
 * Arm a 3D group move from a pointer-down on `nodeId`. Returns false
 * (attaching nothing) unless the node is a transformable member of a
 * multi-selection.
 */
export function armGroupMove3d(args: {
  nodeId: AnyNodeId
  clientX: number
  clientY: number
  pointerId: number
  nativeEvent: PointerEvent
  camera: Camera
  raycaster: Raycaster
  domElement: HTMLCanvasElement
}): boolean {
  const { nodeId, clientX, clientY, pointerId, camera, raycaster, domElement } = args
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length < 2 || !selectedIds.includes(nodeId)) return false
  const sceneNodes = useScene.getState().nodes
  if (classifyParticipant(sceneNodes[nodeId], levelId, sceneNodes) === null) return false

  suppressBoxSelectForPointer(args.nativeEvent)

  const ndc = new Vector2()
  const setNDC = (x: number, y: number) => {
    const rect = domElement.getBoundingClientRect()
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
  }

  type Session = {
    starts: ReturnType<typeof collectParticipants>['starts']
    links: ReturnType<typeof collectParticipants>['links']
    affectedIds: AnyNodeId[]
    candidates: ReturnType<typeof collectAlignmentAnchors>
    restAnchors: ReturnType<typeof bboxCornerAnchors>
    plane: Plane
    startLocal: Vector3
    frameInv: ReturnType<typeof levelFrame>['inverse']
    lastDelta: Vec2 | null
  }
  let session: Session | null = null

  const engage = (): Session | null => {
    const nodes = useScene.getState().nodes
    const participantIds = selectedIds.filter(
      (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
    )
    // Move the full connected wall/fence component, mirroring the 2D session.
    const fullIds = expandToComponent(participantIds, nodes, levelId)
    const { starts, links } = collectParticipants(fullIds, nodes, levelId)
    if (starts.length === 0) return null
    const affectedIds: AnyNodeId[] = [...starts.map((s) => s.id), ...links.map((l) => l.id)]

    // Horizontal drag plane at the group's base; placements live in the level
    // frame, so world-space plane hits convert through it (a rotated building
    // would otherwise drift off-axis from the cursor).
    const restBox = computeGroupBox(fullIds)
    if (!restBox) return null
    const plane = new Plane(new Vector3(0, 1, 0), -restBox.min.y)
    const { inverse: frameInv } = levelFrame(levelId)

    setNDC(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    const startLocal = hit.clone().applyMatrix4(frameInv)

    // Alignment candidates — anchors of everything OUTSIDE the moving set,
    // gathered once at drag start. The group aligns as one rigid footprint:
    // its bbox corners + center are the moving anchors.
    const movingIdSet = new Set<string>(affectedIds)
    const staticNodes: Record<string, AnyNode> = {}
    for (const [nid, n] of Object.entries(nodes)) {
      if (n && !movingIdSet.has(nid)) staticNodes[nid] = n
    }
    const candidates = collectAlignmentAnchors(staticNodes, '', levelId)
    const boxMin = restBox.min.clone().applyMatrix4(frameInv)
    const boxMax = restBox.max.clone().applyMatrix4(frameInv)
    const restAnchors = bboxCornerAnchors(
      'group-move',
      Math.min(boxMin.x, boxMax.x),
      Math.min(boxMin.z, boxMax.z),
      Math.max(boxMin.x, boxMax.x),
      Math.max(boxMin.z, boxMax.z),
    )

    for (const id of affectedIds) {
      useLiveTransforms.getState().clear(id)
    }

    domElement.style.cursor = 'grabbing'
    sfxEmitter.emit('sfx:item-pick')
    swallowNextClick()
    useViewer.getState().setInputDragging(true)
    pauseSceneHistory(useScene)
    useInteractionScope.getState().begin({
      kind: 'handle-drag',
      nodeId,
      handle: GROUP_MOVE_DRAG_LABEL,
    })
    return {
      starts,
      links,
      affectedIds,
      candidates,
      restAnchors,
      plane,
      startLocal,
      frameInv,
      lastDelta: null,
    }
  }

  const applyMove = (e: PointerEvent, s: Session) => {
    setNDC(e.clientX, e.clientY)
    raycaster.setFromCamera(ndc, camera)
    const moveHit = new Vector3()
    if (!raycaster.ray.intersectPlane(s.plane, moveHit)) return
    const moveLocal = moveHit.applyMatrix4(s.frameInv)

    // Snap the slide DELTA to the active grid step so the selection's internal
    // layout stays intact. Mode-driven: the `handle-drag` scope resolves to
    // the item snap context, so Shift cycles the mode mid-drag.
    const step = useEditor.getState().gridSnapStep
    const snap = isGridSnapActive() && step > 0
    let dx = snap
      ? Math.round((moveLocal.x - s.startLocal.x) / step) * step
      : moveLocal.x - s.startLocal.x
    let dz = snap
      ? Math.round((moveLocal.z - s.startLocal.z) / step) * step
      : moveLocal.z - s.startLocal.z

    // Figma-style alignment layered on top: guides display in every mode
    // except Off; the magnetic pull applies only in 'lines' mode.
    if (isAlignmentGuideActive() && s.candidates.length > 0 && s.restAnchors.length > 0) {
      const result = resolveAlignment({
        moving: s.restAnchors.map((a) => ({ ...a, x: a.x + dx, z: a.z + dz })),
        candidates: s.candidates,
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

    // Ticker on each delta change — parity with the single-node move SFX.
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
    // The 2D dashed group bbox rides the same delta in split view.
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

  // History resume is NOT here — it pairs one-to-one with the
  // `pauseSceneHistory` in `engage()`, on the commit and cancel paths.
  const teardown = () => {
    removeListeners()
    if (domElement.style.cursor === 'grabbing') domElement.style.cursor = ''
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
      if (Math.hypot(e.clientX - clientX, e.clientY - clientY) < DRAG_THRESHOLD_PX) return
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
      // Plain click — enter the group pick-up, parity with the single-item
      // click-to-move. Eat the click so the selection manager's click
      // handling doesn't collapse the multi-selection underneath it.
      removeListeners()
      swallowNextClick()
      startGroupPickUp()
      return
    }
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
  // Escape arm, which would otherwise clear the multi-selection mid-cancel.
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
  return true
}
