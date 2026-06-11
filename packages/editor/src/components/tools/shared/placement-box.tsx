'use client'

import '../../../three-types'

import { useEffect, useMemo } from 'react'
import { PlaneGeometry } from 'three'
import { distance, smoothstep, uv, vec2 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { createLineGeometry, getBoxEdgePoints } from './placement-box-geometry'

const VALID_COLOR = 0x22_c5_5e // green-500
const INVALID_COLOR = 0xef_44_44 // red-500

/**
 * Green/red placement footprint shown while a node follows the cursor — the
 * same wireframe-box + radial base plane the GLB item tool draws (geometry
 * helpers shared via `placement-box-geometry`). Unlike the item coordinator's
 * imperative cursor (it mutates module-singleton materials in a `useFrame`
 * loop), this is a declarative, React-driven box: the caller passes the live
 * `position` / `rotationY` / `valid` and the box re-renders. Its own materials
 * are instanced per-mount so it never fights the item tool's singletons.
 *
 * The box is centred on its footprint in X/Z and sits on the floor (its base
 * at the group origin's Y), so a node whose local origin is floor-level — like
 * a shelf — lines up without an extra offset.
 */
export function PlacementBox({
  dimensions,
  position,
  rotationY = 0,
  valid,
}: {
  /** Footprint extent `[width, height, depth]` (unrotated). */
  dimensions: [number, number, number]
  /** World-plan position of the footprint centre (floor level). */
  position: [number, number, number]
  /** Y-rotation in radians, applied to the whole box. */
  rotationY?: number
  /** Drives the colour: green when placeable, red otherwise. */
  valid: boolean
}) {
  const [width, height, depth] = dimensions

  const edgeGeometry = useMemo(
    () =>
      createLineGeometry(
        getBoxEdgePoints({
          min: [-width / 2, 0, -depth / 2],
          max: [width / 2, height, depth / 2],
          dimensions: [width, height, depth],
          center: [0, height / 2, 0],
        }),
      ),
    [width, height, depth],
  )

  const basePlaneGeometry = useMemo(() => {
    const geometry = new PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, 0.01, 0)
    return geometry
  }, [width, depth])

  const edgeMaterial = useMemo(
    () => new LineBasicNodeMaterial({ linewidth: 3, depthTest: false, depthWrite: false }),
    [],
  )
  const basePlaneMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    // Radial opacity: transparent in the centre, opaque toward the edges —
    // matches the item placement base plane.
    material.opacityNode = smoothstep(0, 0.7, distance(uv(), vec2(0.5, 0.5))).mul(0.6)
    return material
  }, [])

  useEffect(() => {
    const color = valid ? VALID_COLOR : INVALID_COLOR
    edgeMaterial.color.setHex(color)
    basePlaneMaterial.color.setHex(color)
  }, [valid, edgeMaterial, basePlaneMaterial])

  useEffect(
    () => () => {
      edgeGeometry.dispose()
    },
    [edgeGeometry],
  )
  useEffect(
    () => () => {
      basePlaneGeometry.dispose()
    },
    [basePlaneGeometry],
  )
  useEffect(
    () => () => {
      edgeMaterial.dispose()
      basePlaneMaterial.dispose()
    },
    [edgeMaterial, basePlaneMaterial],
  )

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <lineSegments
        geometry={edgeGeometry}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        renderOrder={999}
      />
      <mesh
        geometry={basePlaneGeometry}
        layers={EDITOR_LAYER}
        material={basePlaneMaterial}
        renderOrder={999}
      />
    </group>
  )
}
