import {
  type AnyNodeId,
  type CeilingEvent,
  type CeilingNode,
  emitter,
  resolveLevelId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import useEditor from '../store/use-editor'
import { getMovingNode } from '../store/use-interaction-scope'

const UP = new Vector3(0, 1, 0)

/** Ray-casting point-in-polygon on ceiling-local [x, z] tuples. */
function pointInPolygon(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const intersects =
      a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Reliable pointer events for placing ceiling-attached items.
 *
 * Mirrors {@link useGridEvents} (the floor path): rather than relying on the
 * thin, single-sided `ceiling-grid` overlay mesh to be hit by R3F's raycaster —
 * which misses from the "wrong" camera side, near polygon edges/holes, or while
 * the overlay is mid-reveal, dropping the commit click even though the green box
 * still shows — it intersects a math plane at each ceiling's height (double-sided,
 * so it hits from above or below) and point-in-polygon tests the hit. Emits
 * `ceiling:enter/move/leave/click` so both the placement coordinator and the 2D
 * floor-plan item preview keep working.
 *
 * Active only while a ceiling-attached item is being placed or moved. The
 * `ceiling-grid` mesh no longer emits these events (see `CeilingRenderer`), so
 * this is the single, reliable source.
 */
export function useCeilingEvents() {
  const { camera, gl } = useThree()
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())
  const plane = useRef(new Plane(UP.clone(), 0))
  const worldHit = useRef(new Vector3())
  const meshWorld = useRef(new Vector3())
  const hoveredRef = useRef<string | null>(null)

  useEffect(() => {
    const canvas = gl.domElement

    const isActive = (): boolean => {
      const ed = useEditor.getState()
      if (ed.selectedItem?.attachTo === 'ceiling') return true
      const moving = getMovingNode()
      return moving?.type === 'item' && moving.asset?.attachTo === 'ceiling'
    }

    type Hit = { node: CeilingNode; mesh: Object3D; world: Vector3; local: Vector3 }

    // The ceiling on the active level whose plane the cursor ray crosses inside
    // its polygon, nearest the camera.
    const pick = (nativeEvent: PointerEvent | MouseEvent): Hit | null => {
      const activeLevelId = useViewer.getState().selection.levelId
      if (!activeLevelId) return null

      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(pointer.current, camera)

      const nodes = useScene.getState().nodes
      const ceilingIds = sceneRegistry.byType.ceiling
      if (!ceilingIds) return null

      let best: Hit | null = null
      let bestDist = Number.POSITIVE_INFINITY

      for (const id of ceilingIds) {
        const node = nodes[id as AnyNodeId] as CeilingNode | undefined
        if (node?.type !== 'ceiling' || node.polygon.length < 3) continue
        if (resolveLevelId(node, nodes) !== activeLevelId) continue
        const mesh = sceneRegistry.nodes.get(id)
        if (!mesh) continue

        mesh.getWorldPosition(meshWorld.current)
        plane.current.set(UP, -meshWorld.current.y)
        if (!raycaster.current.ray.intersectPlane(plane.current, worldHit.current)) continue

        const local = mesh.worldToLocal(worldHit.current.clone())
        if (!pointInPolygon(local.x, local.z, node.polygon)) continue

        const dist = raycaster.current.ray.origin.distanceToSquared(worldHit.current)
        if (dist < bestDist) {
          bestDist = dist
          best = { node, mesh, world: worldHit.current.clone(), local }
        }
      }
      return best
    }

    const buildEvent = (hit: Hit, nativeEvent: PointerEvent | MouseEvent): CeilingEvent => ({
      node: hit.node,
      position: [hit.world.x, hit.world.y, hit.world.z],
      localPosition: [hit.local.x, hit.local.y, hit.local.z],
      normal: [0, 1, 0],
      object: hit.mesh,
      stopPropagation: () => {},
      nativeEvent: nativeEvent as never,
    })

    const emitLeave = (nativeEvent: PointerEvent | MouseEvent) => {
      const id = hoveredRef.current
      if (!id) return
      hoveredRef.current = null
      const node = useScene.getState().nodes[id as AnyNodeId] as CeilingNode | undefined
      const mesh = sceneRegistry.nodes.get(id)
      if (!node || !mesh) return
      emitter.emit(
        'ceiling:leave',
        buildEvent(
          { node, mesh, world: meshWorld.current.clone(), local: new Vector3() },
          nativeEvent,
        ),
      )
    }

    const onMove = (e: PointerEvent) => {
      if (!isActive()) {
        emitLeave(e)
        return
      }
      const hit = pick(e)
      if (!hit) {
        emitLeave(e)
        return
      }
      const ev = buildEvent(hit, e)
      if (hoveredRef.current !== hit.node.id) {
        if (hoveredRef.current) emitLeave(e)
        hoveredRef.current = hit.node.id
        emitter.emit('ceiling:enter', ev)
      }
      emitter.emit('ceiling:move', ev)
    }

    const onClick = (e: MouseEvent) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      if (!isActive()) return
      const hit = pick(e)
      if (!hit) return
      emitter.emit('ceiling:click', buildEvent(hit, e))
    }

    const onPointerLeave = (e: PointerEvent) => emitLeave(e)

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('pointerleave', onPointerLeave)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [camera, gl])
}
