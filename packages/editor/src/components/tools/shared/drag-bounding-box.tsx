'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import {
  Box3,
  BoxGeometry,
  EdgesGeometry,
  Matrix4,
  type Mesh,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from 'three'
import { distance, smoothstep, uv, vec2 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'

const NO_RAYCAST = () => null

/** green-500 — matches the item placement box's "placeable" state. */
const DEFAULT_COLOR = 0x22_c5_5e

type LocalBounds = { size: [number, number, number]; center: [number, number, number] }

/**
 * The node's bounding box in its OWN, unrotated frame — measured from the
 * rendered geometry so it captures the full extent (base, cap, overhang),
 * not just the declared width/height/depth. World position + rotation are
 * cancelled out (invert the root's world matrix), so the result is stable
 * regardless of where the live drag has moved the node; the caller re-applies
 * the current Y rotation on the group. Returns null when nothing measurable.
 */
function measureLocalBounds(obj: Object3D): LocalBounds | null {
  obj.updateWorldMatrix(true, true)
  const inverseRoot = new Matrix4().copy(obj.matrixWorld).invert()
  const box = new Box3()
  const meshBox = new Box3()
  const toLocal = new Matrix4()
  let measured = false
  obj.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const bb = mesh.geometry.boundingBox
    if (!bb) return
    toLocal.copy(inverseRoot).multiply(mesh.matrixWorld)
    meshBox.copy(bb).applyMatrix4(toLocal)
    box.union(meshBox)
    measured = true
  })
  if (!measured || box.isEmpty()) return null
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  return { size: [size.x, size.y, size.z], center: [center.x, center.y, center.z] }
}

interface DragBoundingBoxProps {
  /** Node whose rendered geometry is measured for the box extents. */
  nodeId: string
  /** Footprint origin on the floor, `[x, 0, z]` — the node's live position. */
  position: [number, number, number]
  /** Y rotation (radians) applied to the box, matching the dragged node. */
  rotationY?: number
  /** Declared `[width, height, depth]`, used until/if the mesh can't be measured. */
  fallbackSize?: [number, number, number]
  color?: number
}

/**
 * Footprint box drawn around a node while it is being dragged — the same
 * affordance items get during placement: a wireframe cube spanning the node's
 * full measured extent plus a ground plane with a radial opacity gradient
 * (transparent in the centre, opaque toward the edges). Overlay layer +
 * `depthTest: false` keep it drawn on top of scene geometry throughout the
 * drag, and the box visualises the bounds that drive alignment snapping.
 */
export function DragBoundingBox({
  nodeId,
  position,
  rotationY = 0,
  fallbackSize = [0, 0, 0],
  color = DEFAULT_COLOR,
}: DragBoundingBoxProps) {
  const measured = useMemo(() => {
    const obj = sceneRegistry.nodes.get(nodeId)
    return obj ? measureLocalBounds(obj) : null
  }, [nodeId])

  const [w, h, d] = measured?.size ?? fallbackSize
  const [cx, cy, cz] = measured?.center ?? [0, fallbackSize[1] / 2, 0]
  const minY = cy - h / 2

  const edgeGeometry = useMemo(() => {
    const box = new BoxGeometry(w, h, d)
    const edges = new EdgesGeometry(box)
    box.dispose()
    return edges
  }, [w, h, d])

  // Flat on the ground (XZ) at the box's base, nudged up 0.01m to avoid
  // z-fighting with slabs.
  const planeGeometry = useMemo(() => {
    const plane = new PlaneGeometry(w, d)
    plane.rotateX(-Math.PI / 2)
    plane.translate(cx, minY + 0.01, cz)
    return plane
  }, [w, d, cx, minY, cz])

  const edgeMaterial = useMemo(
    () => new LineBasicNodeMaterial({ color, linewidth: 3, depthTest: false, depthWrite: false }),
    [color],
  )

  const planeMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      color,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    material.opacityNode = smoothstep(0, 0.7, distance(uv(), vec2(0.5, 0.5))).mul(0.6)
    return material
  }, [color])

  useEffect(
    () => () => {
      edgeGeometry.dispose()
      planeGeometry.dispose()
      edgeMaterial.dispose()
      planeMaterial.dispose()
    },
    [edgeGeometry, planeGeometry, edgeMaterial, planeMaterial],
  )

  if (w <= 0 || h <= 0 || d <= 0) return null

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh
        geometry={planeGeometry}
        layers={EDITOR_LAYER}
        material={planeMaterial}
        raycast={NO_RAYCAST}
        renderOrder={999}
      />
      <lineSegments
        geometry={edgeGeometry}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        position={[cx, cy, cz]}
        raycast={NO_RAYCAST}
        renderOrder={999}
      />
    </group>
  )
}
