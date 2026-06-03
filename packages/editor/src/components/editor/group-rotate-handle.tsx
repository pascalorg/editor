'use client'

import {
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box3, OrthographicCamera, Plane, Vector2, Vector3 } from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  ARROW_SCALE,
  createRotateArrowHandleGeometry,
  GuideRing,
  RotationGuide,
  type RotationGuideData,
  useArrowMaterial,
} from './node-arrow-handles'

const ROTATE_SNAP = Math.PI / 12 // 15°

type MovableNode = AnyNode & {
  position: [number, number, number]
  rotation: [number, number, number]
}

function isMovable(node: AnyNode | undefined, levelId: string | null): node is MovableNode {
  if (!node || node.parentId !== levelId) return false
  const p = (node as { position?: unknown }).position
  const r = (node as { rotation?: unknown }).rotation
  const isVec3 = (v: unknown): v is [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
  return isVec3(p) && isVec3(r)
}

/**
 * Group-rotate gizmo. When 2+ "movable" nodes (position + rotation, sitting
 * directly on the active level) are selected, a single rotation handle appears
 * at the selection's bounding-box center. Dragging it spins every selected node
 * rigidly around that shared center — orbiting each node's position AND turning
 * its yaw by the same delta, so the group rotates as one piece.
 *
 * The single-selection case is handled by `NodeArrowHandles`; a full-level
 * box-select promotes to a building selection, so neither reaches this gizmo.
 */
export function GroupRotateHandle() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const levelId = useViewer((s) => s.selection.levelId)
  const mode = useEditor((s) => s.mode)
  const movingNode = useEditor((s) => s.movingNode)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  // Re-derive participants whenever the scene mutates (e.g. after a commit).
  // Drags only touch `useLiveNodeOverrides`, so this does not fire mid-drag.
  const nodes = useScene((s) => s.nodes)

  const participantIds = useMemo(
    () => selectedIds.filter((id) => isMovable(nodes[id as AnyNodeId], levelId)),
    [selectedIds, levelId, nodes],
  )

  const shouldRender =
    participantIds.length >= 2 && mode !== 'delete' && !movingNode && !isFloorplanHovered

  if (!shouldRender) return null
  // Remount when the participant set changes so the rest pivot re-seeds cleanly.
  return <GroupRotateHandleInner ids={participantIds} key={participantIds.join(',')} />
}

function GroupRotateHandleInner({ ids }: { ids: string[] }) {
  const { camera, raycaster, gl, scene } = useThree()
  const arrowGeometry = useMemo(() => createRotateArrowHandleGeometry(), [])
  const arrowMaterial = useArrowMaterial()
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [guide, setGuide] = useState<RotationGuideData | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const frozenPivot = useRef<Vector3 | null>(null)

  useEffect(() => {
    arrowMaterial.color.set(isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [arrowMaterial, isHovered])
  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])
  useEffect(() => () => arrowMaterial.dispose(), [arrowMaterial])
  useEffect(() => () => dragCleanupRef.current?.(), [])

  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const scale = (isHovered ? 1.12 : 1) * zoom * ARROW_SCALE * 1.05

  // World-space bounding-box center of the selected meshes (XZ), Y at the
  // group's base. Levels are axis-aligned in XZ, so world XZ coincides with
  // each node's level-local `position` XZ — letting us rotate `position`
  // directly against this pivot without per-node frame conversion.
  const restPivot = useMemo(() => {
    const box = new Box3()
    const tmp = new Box3()
    let found = false
    for (const id of ids) {
      const obj = sceneRegistry.nodes.get(id)
      if (!obj) continue
      obj.updateWorldMatrix(true, true)
      tmp.setFromObject(obj)
      if (tmp.isEmpty()) continue
      box.union(tmp)
      found = true
    }
    if (!found) return null
    return new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
  }, [ids])

  if (!restPivot) return null
  const pivot = isDragging && frozenPivot.current ? frozenPivot.current : restPivot

  const activate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    const center = restPivot.clone()
    frozenPivot.current = center

    // Snapshot each participant's pre-drag transform from the store.
    const sceneNodes = useScene.getState().nodes
    const starts = ids
      .map((id) => {
        const node = sceneNodes[id as AnyNodeId] as MovableNode | undefined
        if (!node) return null
        return {
          id: id as AnyNodeId,
          position: [...node.position] as [number, number, number],
          rotation: [...node.rotation] as [number, number, number],
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
    if (starts.length === 0) return

    // Horizontal drag plane at the pivot; bearing measured around the pivot.
    const plane = new Plane(new Vector3(0, 1, 0), -center.y)
    const angleOf = (p: Vector3) => Math.atan2(p.z - center.z, p.x - center.x)

    // Wedge radius tracks how far the group spreads from the pivot.
    let spread = 0
    for (const s of starts) {
      spread = Math.max(spread, Math.hypot(s.position[0] - center.x, s.position[2] - center.z))
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
    setIsDragging(true)

    const onMove = (e: PointerEvent) => {
      setNDC(e.clientX, e.clientY)
      raycaster.setFromCamera(ndc, camera)
      const moveHit = new Vector3()
      if (!raycaster.ray.intersectPlane(plane, moveHit)) return
      let delta = angleOf(moveHit) - initialAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta < -Math.PI) delta += 2 * Math.PI
      if (e.shiftKey) delta = Math.round(delta / ROTATE_SNAP) * ROTATE_SNAP

      // Orbit each node's position CCW by `delta` (atan2 x→z sense) and turn
      // its yaw by `-delta` to match three.js Y-rotation handedness (same
      // convention as the single-item rotate handle in item/definition.ts).
      const cos = Math.cos(delta)
      const sin = Math.sin(delta)
      const overrides = useLiveNodeOverrides.getState()
      for (const s of starts) {
        const dx = s.position[0] - center.x
        const dz = s.position[2] - center.z
        const position: [number, number, number] = [
          center.x + dx * cos - dz * sin,
          s.position[1],
          center.z + dx * sin + dz * cos,
        ]
        const rotation: [number, number, number] = [
          s.rotation[0],
          s.rotation[1] - delta,
          s.rotation[2],
        ]
        overrides.set(s.id, { position, rotation })
        useScene.getState().markDirty(s.id)
      }

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

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
      useScene.temporal.getState().resume()
      useViewer.getState().setInputDragging(false)
      setIsDragging(false)
      setGuide(null)
      frozenPivot.current = null
      dragCleanupRef.current = null
    }

    const commitFromOverrides = () => {
      const overrides = useLiveNodeOverrides.getState()
      const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
      for (const s of starts) {
        const patch = overrides.get(s.id)
        if (patch) updates.push({ id: s.id, data: patch as Partial<AnyNode> })
      }
      return updates
    }

    const onUp = () => {
      sfxEmitter.emit('sfx:item-place')
      const updates = commitFromOverrides()
      // Resume before the commit so the single batched `updateNodes` is the
      // one tracked set — collapsing the whole group rotation into one undo.
      useScene.temporal.getState().resume()
      if (updates.length > 0) useScene.getState().updateNodes(updates)
      for (const s of starts) {
        useLiveNodeOverrides.getState().clear(s.id)
        useScene.getState().markDirty(s.id)
      }
      cleanup()
    }

    const onCancel = () => {
      // Revert: drop overrides + mark dirty so renderers rebuild from the store.
      for (const s of starts) {
        useLiveNodeOverrides.getState().clear(s.id)
        useScene.getState().markDirty(s.id)
      }
      cleanup()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return createPortal(
    <>
      {(isHovered || isDragging) && (
        <group position={[pivot.x, pivot.y, pivot.z]}>
          <GuideRing radius={0.2 * scale} y={0} />
        </group>
      )}
      <group position={[pivot.x, pivot.y, pivot.z]} scale={scale}>
        <mesh
          frustumCulled={false}
          geometry={arrowGeometry}
          material={arrowMaterial}
          onPointerDown={activate}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setIsHovered(true)
            if (document.body.style.cursor !== 'grabbing') document.body.style.cursor = 'grab'
          }}
          onPointerLeave={(event) => {
            event.stopPropagation()
            setIsHovered(false)
            if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
          }}
          renderOrder={1010}
        />
      </group>
      {guide ? <RotationGuide data={guide} /> : null}
    </>,
    scene,
  )
}

export default GroupRotateHandle
