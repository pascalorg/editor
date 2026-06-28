'use client'

import {
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { OrthographicCamera, Plane, Vector2, Vector3 } from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { useMovingNode } from '../../store/use-interaction-scope'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import {
  CORNER_OFFSET,
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  type Vec2,
} from './group-transform-shared'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  createMoveCrossHandleGeometry,
  swallowNextClick,
  useArrowMaterial,
} from './node-arrow-handles'

/**
 * Group-move gizmo — the 4-way cross sibling of `GroupRotateHandle`. When 2+
 * transformable nodes are selected, a single move cross appears at the
 * selection's front-left bounding-box corner (the rotate gizmo sits on the
 * right). Dragging it slides every selected node by the same ground-plane
 * delta; connected (unselected) wall/fence endpoints follow so junctions stay
 * welded. Commits the whole slide in one batched `updateNodes` (one undo).
 */
export function GroupMoveHandle() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const mode = useEditor((s) => s.mode)
  const movingNode = useMovingNode()
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const nodes = useScene((s) => s.nodes)

  const participantIds = useMemo(
    () =>
      selectedIds.filter(
        (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
      ),
    [selectedIds, levelId, nodes],
  )

  // Gate on the explicit selection, but move the full connected wall/fence
  // component so attached structure slides rigidly as one piece.
  const fullIds = useMemo(
    () => expandToComponent(participantIds, nodes, levelId),
    [participantIds, levelId, nodes],
  )

  const shouldRender =
    participantIds.length >= 2 && mode !== 'delete' && !movingNode && !isFloorplanHovered

  if (!shouldRender) return null
  return <GroupMoveHandleInner ids={fullIds} key={fullIds.join(',')} />
}

function GroupMoveHandleInner({ ids }: { ids: string[] }) {
  const { camera, raycaster, gl, scene } = useThree()
  const arrowGeometry = useMemo(() => createMoveCrossHandleGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  // Live ground-plane delta so the gizmo rides along with the group it moves.
  const [liveDelta, setLiveDelta] = useState<Vec2>([0, 0])
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const frozenCorner = useRef<Vector3 | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE

  // Front-left bbox corner at mid-height (mirrors the rotate gizmo on the
  // right), plus the group's base Y for the ground drag plane.
  const rest = useMemo(() => {
    const box = computeGroupBox(ids)
    if (!box) return null
    const corner = new Vector3(
      box.min.x - CORNER_OFFSET,
      (box.min.y + box.max.y) / 2,
      box.max.z + CORNER_OFFSET,
    )
    return { corner, baseY: box.min.y }
  }, [ids])

  if (!rest) return null
  const baseCorner = isDragging && frozenCorner.current ? frozenCorner.current : rest.corner
  const corner: [number, number, number] = [
    baseCorner.x + liveDelta[0],
    baseCorner.y,
    baseCorner.z + liveDelta[1],
  ]

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    frozenCorner.current = rest.corner.clone()
    const planeY = rest.baseY

    // Snapshot selected participants + connected wall/fence neighbours.
    const levelId = useViewer.getState().selection.levelId
    const { starts, links } = collectParticipants(ids, useScene.getState().nodes, levelId)
    if (starts.length === 0) return

    // Placements are stored in the level frame, so convert each world-space
    // ground-plane hit into that frame before measuring the delta. Frozen at
    // drag-start; `frameOrigin` lets us map the local delta back to world for
    // the gizmo's own travel (it's portalled to the scene root).
    const { matrix: frame, inverse: frameInv } = levelFrame(levelId)
    const frameOrigin = new Vector3().applyMatrix4(frame)

    // Horizontal drag plane at the group's base.
    const plane = new Plane(new Vector3(0, 1, 0), -planeY)
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
    const startLocal = hit.clone().applyMatrix4(frameInv)

    document.body.style.cursor = 'grabbing'
    sfxEmitter.emit('sfx:item-pick')
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()
    setIsDragging(true)

    // Snap the slide to the active grid step so the group lands on the grid
    // (Shift bypasses for free movement). Snapping the delta keeps the
    // selection's internal layout intact — grid-aligned items stay aligned.
    const step = useEditor.getState().gridSnapStep
    let lastSnap: Vec2 | null = null

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const moveHit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, moveHit)) return
      const moveLocal = moveHit.applyMatrix4(frameInv)
      const snap = !e.shiftKey && step > 0
      const dx = snap
        ? Math.round((moveLocal.x - startLocal.x) / step) * step
        : moveLocal.x - startLocal.x
      const dz = snap
        ? Math.round((moveLocal.z - startLocal.z) / step) * step
        : moveLocal.z - startLocal.z

      // Ticker on each grid-cell crossing, like single-item placement.
      if (snap && (!lastSnap || lastSnap[0] !== dx || lastSnap[1] !== dz)) {
        sfxEmitter.emit('sfx:grid-snap')
        lastSnap = [dx, dz]
      }

      const overrideEntries: Array<readonly [string, Record<string, unknown>]> = []
      const liveTransforms = useLiveTransforms.getState()
      for (const s of starts) {
        if (s.kind === 'endpoint') {
          overrideEntries.push([
            s.id,
            {
              start: [s.start[0] + dx, s.start[1] + dz],
              end: [s.end[0] + dx, s.end[1] + dz],
            },
          ])
        } else {
          // Slide on the floor: XZ shift, Y and rotation untouched.
          const position: [number, number, number] = [
            s.position[0] + dx,
            s.position[1],
            s.position[2] + dz,
          ]
          overrideEntries.push([s.id, { position }])
          if (s.kind === 'scalar') {
            liveTransforms.set(s.id, { position, rotation: s.rotation })
          }
        }
        useScene.getState().markDirty(s.id)
      }

      // Shared endpoints of connected neighbours follow by the same delta so
      // the junction stays welded; the far end stays put.
      for (const l of links) {
        overrideEntries.push([
          l.id,
          {
            start: l.startLinked ? [l.start[0] + dx, l.start[1] + dz] : l.start,
            end: l.endLinked ? [l.end[0] + dx, l.end[1] + dz] : l.end,
          },
        ])
        useScene.getState().markDirty(l.id)
      }
      useLiveNodeOverrides.getState().setMany(overrideEntries)

      // Gizmo rides the group in world space; map the level-frame delta back out.
      const worldDelta = new Vector3(dx, 0, dz).applyMatrix4(frame).sub(frameOrigin)
      setLiveDelta([worldDelta.x, worldDelta.z])
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
      setIsDragging(false)
      setLiveDelta([0, 0])
      frozenCorner.current = null
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
      // Resume before the commit so the single batched `updateNodes` is the one
      // tracked set — collapsing the whole group move into one undo.
      useScene.temporal.getState().resume()
      if (updates.length > 0) useScene.getState().updateNodes(updates)
      clearLivePreviews()
      cleanup()
    }

    const onCancel = () => {
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
    <group position={corner} scale={scale}>
      <mesh
        frustumCulled={false}
        geometry={arrowGeometry}
        material={arrowMaterial}
        onPointerDown={activate}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'move'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'move') document.body.style.cursor = ''
        }}
        renderOrder={1010}
      />
    </group>,
    scene,
  )
}

export default GroupMoveHandle
