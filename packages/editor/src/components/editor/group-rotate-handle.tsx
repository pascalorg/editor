'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  pauseSpaceDetection,
  resumeSpaceDetection,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OrthographicCamera, Plane, Vector2, Vector3 } from 'three'
import { GROUP_MOVE_DRAG_LABEL, GROUP_ROTATE_DRAG_LABEL } from '../../lib/contextual-help'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import useInteractionScope, {
  useActiveHandleDrag,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import {
  CORNER_OFFSET,
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  rotateGroupPatches,
  type Vec3,
} from './group-transform-shared'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  createRotateArrowHandleGeometry,
  createRotateArrowHitAreaGeometry,
  GuideRing,
  RotationGuide,
  type RotationGuideData,
  swallowNextClick,
  useArrowMaterial,
  useInvisibleHitAreaMaterial,
} from './node-arrow-handles'
import { useMeshSettleEpoch } from './use-mesh-settle-epoch'

/**
 * Group-rotate gizmo. When 2+ transformable nodes in the active level frame are
 * selected, a single rotation handle appears at the selection's bounding-box
 * center. Dragging it spins every selected node rigidly around that shared
 * center — orbiting each node's position AND turning its yaw by the same delta,
 * so the group rotates as one piece.
 *
 * The single-selection case is handled by `NodeArrowHandles`; a full-level
 * box-select promotes to a building selection, so neither reaches this gizmo.
 */
export function GroupRotateHandle() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const mode = useEditor((s) => s.mode)
  const movingNode = useMovingNode()
  const activeHandleDrag = useActiveHandleDrag()
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  // Re-derive participants whenever the scene mutates (e.g. after a commit).
  // Drags only touch `useLiveNodeOverrides`, so this does not fire mid-drag.
  const nodes = useScene((s) => s.nodes)
  // Re-measure the pivot/corner once the meshes settle after a scene change.
  const meshEpoch = useMeshSettleEpoch(nodes)

  const participantIds = useMemo(
    () =>
      selectedIds.filter(
        (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
      ),
    [selectedIds, levelId, nodes],
  )

  // Gate on the explicit selection (so a single connected wall still gets the
  // per-node handles), but transform the full connected wall/fence component so
  // attached structure rotates rigidly as one piece.
  const fullIds = useMemo(
    () => expandToComponent(participantIds, nodes, levelId),
    [participantIds, levelId, nodes],
  )

  const shouldRender =
    participantIds.length >= 2 &&
    mode !== 'delete' &&
    !movingNode &&
    !isFloorplanHovered &&
    // Hide while the sibling move gizmo drags the group — the frozen corner
    // this handle would sit at goes stale as the group slides under it.
    activeHandleDrag?.label !== GROUP_MOVE_DRAG_LABEL

  if (!shouldRender) return null
  // Remount when the moving set changes so the rest pivot re-seeds cleanly.
  return <GroupRotateHandleInner ids={fullIds} key={fullIds.join(',')} meshEpoch={meshEpoch} />
}

function GroupRotateHandleInner({ ids, meshEpoch }: { ids: string[]; meshEpoch: number }) {
  const { camera, raycaster, gl, scene } = useThree()
  const arrowGeometry = useMemo(() => createRotateArrowHandleGeometry(), [])
  const hitGeometry = useMemo(() => createRotateArrowHitAreaGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  const hitMaterial = useInvisibleHitAreaMaterial()
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [guide, setGuide] = useState<RotationGuideData | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const frozenRest = useRef<{ pivot: Vector3; corner: Vector3 } | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE * 1.05
  const scale = (isHovered ? 1.12 : 1) * baseScale

  // World-space bounding box of the selected meshes. Levels are axis-aligned in
  // XZ, so world XZ coincides with each node's level-local placement — letting
  // us rotate `position` / `start` / `end` directly against the pivot without
  // per-node frame conversion.
  //   - `pivot`  = bbox center (XZ), Y at the group's base → the rotation origin
  //   - `corner` = front-right bbox corner at mid-height → where the gizmo sits
  const rest = useMemo(() => {
    const box = computeGroupBox(ids)
    if (!box) return null
    const pivot = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
    const corner = new Vector3(
      box.max.x + CORNER_OFFSET,
      (box.min.y + box.max.y) / 2,
      box.max.z + CORNER_OFFSET,
    )
    return { pivot, corner }
    // biome-ignore lint/correctness/useExhaustiveDependencies: meshEpoch re-measures settled meshes
  }, [ids, meshEpoch])

  if (!rest) return null
  const active = isDragging && frozenRest.current ? frozenRest.current : rest
  const corner = active.corner

  const onHoverEnter = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(true)
    if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grab'
  }
  const onHoverLeave = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setIsHovered(false)
    if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
  }

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)

    frozenRest.current = { pivot: rest.pivot.clone(), corner: rest.corner.clone() }
    const center = rest.pivot.clone()

    // Snapshot the selected participants + connected wall/fence neighbours whose
    // shared endpoints must follow the rotation (so junctions stay welded).
    const levelId = useViewer.getState().selection.levelId
    const { starts, links } = collectParticipants(ids, useScene.getState().nodes, levelId)
    if (starts.length === 0) return

    // Placements live in the level frame; the world pivot must be converted into
    // it before orbiting positions, or a rotated building displaces the centre.
    // The swept angle is frame-invariant (both frames differ by a constant yaw,
    // which cancels in `angleOf(move) - angleOf(start)`), so it's still measured
    // in world against `center` — keeping the world-space guide overlay correct.
    const localCenter = center.clone().applyMatrix4(levelFrame(levelId).inverse)

    // Horizontal drag plane at the pivot; bearing measured around the pivot.
    const plane = new Plane(new Vector3(0, 1, 0), -center.y)
    const angleOf = (p: Vector3) => Math.atan2(p.z - center.z, p.x - center.x)

    // Wedge radius tracks how far the group spreads from the pivot — sample each
    // participant's anchor point(s).
    let spread = 0
    const reach = (x: number, z: number) => {
      spread = Math.max(spread, Math.hypot(x - localCenter.x, z - localCenter.z))
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
    const guideRadius = Math.min(Math.max(spread * 0.6, 0.3), 3)

    const ndc = new Vector2()
    const setNDC = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
    }

    setNDC(event.nativeEvent.clientX, event.nativeEvent.clientY)
    raycaster.setFromCamera(ndc, camera)
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return
    const initialAngle = angleOf(hit)

    document.body.style.cursor = 'grabbing'
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    useInteractionScope.getState().begin({
      kind: 'handle-drag',
      nodeId: ids[0] ?? '',
      handle: GROUP_ROTATE_DRAG_LABEL,
    })
    setIsDragging(true)

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const moveHit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, moveHit)) return
      let delta = angleOf(moveHit) - initialAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      if (!e.shiftKey) delta = Math.round(delta / DEFAULT_ANGLE_STEP) * DEFAULT_ANGLE_STEP

      // Shared rigid-rotation math (also used by the keyboard group R/T);
      // see `rotateGroupPatches` for the orbit/yaw handedness contract.
      const overrideEntries = rotateGroupPatches(
        starts,
        links,
        { x: localCenter.x, z: localCenter.z },
        delta,
      )
      const patchById = new Map(overrideEntries)
      const liveTransforms = useLiveTransforms.getState()
      for (const s of starts) {
        if (s.kind === 'scalar') {
          const patch = patchById.get(s.id)
          if (patch) {
            liveTransforms.set(s.id, {
              position: patch.position as Vec3,
              rotation: patch.rotation as number,
            })
          }
        }
        useScene.getState().markDirty(s.id)
      }
      for (const l of links) {
        useScene.getState().markDirty(l.id)
      }
      useLiveNodeOverrides.getState().setMany(overrideEntries)

      if (Math.abs(delta) < 0.0087) {
        setGuide(null)
      } else {
        const midAngle = initialAngle + delta / 2
        const labelRadius = guideRadius + 0.22
        setGuide({
          center: [center.x, center.y, center.z],
          startAngle: initialAngle,
          endAngle: initialAngle + delta,
          radius: guideRadius,
          labelPos: [
            center.x + Math.cos(midAngle) * labelRadius,
            center.y + 0.02,
            center.z + Math.sin(midAngle) * labelRadius,
          ],
          sweep: Math.abs(delta),
        })
      }
    }

    const affectedIds: AnyNodeId[] = [...starts.map((s) => s.id), ...links.map((l) => l.id)]
    const clearLivePreviews = () => {
      const overrides = useLiveNodeOverrides.getState()
      const liveTransforms = useLiveTransforms.getState()
      for (const id of affectedIds) {
        overrides.clear(id)
        liveTransforms.clear(id)
        useScene.getState().markDirty(id)
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'handle-drag' && s.handle === GROUP_ROTATE_DRAG_LABEL)
      setIsDragging(false)
      setGuide(null)
      frozenRest.current = null
      dragCleanupRef.current = null
    }

    const commitFromOverrides = () => {
      const overrides = useLiveNodeOverrides.getState()
      const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
      for (const id of affectedIds) {
        const patch = overrides.get(id)
        if (patch) updates.push({ id, data: patch as Partial<AnyNode> })
      }
      return updates
    }

    const onUp = () => {
      // Eat the click that follows pointer-up so the selection manager doesn't
      // treat it as a canvas click and clear the multi-selection.
      swallowNextClick()
      sfxEmitter.emit('sfx:item-place')
      const updates = commitFromOverrides()
      // Resume before the commit so the single batched `updateNodes` is the
      // one tracked set — collapsing the whole group rotation into one undo.
      // Space detection stays out: a rigid rotation of existing walls must
      // not re-create the room's auto floors/ceilings at the new bearing.
      pauseSpaceDetection()
      useScene.temporal.getState().resume()
      if (updates.length > 0) useScene.getState().updateNodes(updates)
      resumeSpaceDetection()
      clearLivePreviews()
      cleanup()
    }

    const onCancel = () => {
      // Revert: drop overrides + mark dirty so renderers rebuild from the store.
      clearLivePreviews()
      cleanup()
    }

    dragCleanupRef.current = () => {
      clearLivePreviews()
      cleanup()
    }
    for (const id of affectedIds) {
      useLiveTransforms.getState().clear(id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return createPortal(
    <>
      {(isHovered || isDragging) && (
        <group position={[corner.x, corner.y, corner.z]}>
          <GuideRing radius={0.2 * scale} y={0} />
        </group>
      )}
      <group position={[corner.x, corner.y, corner.z]}>
        {/* Fat invisible grab target (torus wrapping the arrow). A plain
            default-layer mesh with the standard raycast — the shared
            `InvisibleHandleHitArea` (EDITOR_LAYER + custom raycast) never
            received pointer events in this portalled context. */}
        <mesh
          frustumCulled={false}
          geometry={hitGeometry}
          material={hitMaterial}
          onPointerDown={activate}
          onPointerEnter={onHoverEnter}
          onPointerLeave={onHoverLeave}
          scale={baseScale}
        />
        <mesh
          frustumCulled={false}
          geometry={arrowGeometry}
          material={arrowMaterial}
          onPointerDown={activate}
          onPointerEnter={onHoverEnter}
          onPointerLeave={onHoverLeave}
          renderOrder={1010}
          scale={scale}
        />
      </group>
      {guide ? <RotationGuide data={guide} /> : null}
    </>,
    scene,
  )
}

export default GroupRotateHandle
