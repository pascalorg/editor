'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, LineSegments } from 'three'
import { LineBasicNodeMaterial } from 'three/webgpu'

/**
 * Floor "shadow" projection for a window during placement / move.
 *
 * Windows sit elevated above the floor, so over open ground (and on a wall)
 * it's hard to read where the window actually is in plan. This draws its
 * projection on the floor: a small footprint segment directly below the window
 * (its plan extent along the wall) plus a DASHED vertical line dropping from the
 * window centre to that footprint — like a shadow tether. Placement aid only;
 * never shown on a committed window.
 *
 * Rendered in WORLD space (the tool positions the ghost in world space too), so
 * it's mounted as a sibling of the ghost — NOT inside the ghost's rotated/offset
 * group. `centerY` is the window centre's world Y; `floorY` is the level floor.
 */

const FOOTPRINT_COLOR = 0x38_bd_f8
const DROP_COLOR = 0x38_bd_f8

const footprintMaterial = new LineBasicNodeMaterial({
  color: FOOTPRINT_COLOR,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
})
const dropMaterial = new LineBasicNodeMaterial({
  color: DROP_COLOR,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
})

// Dash geometry for the vertical drop: alternating on/off segments so it reads
// as a dashed tether without a dashed-line material (unavailable in three/webgpu).
const DASH = 0.12
const GAP = 0.08

export function WindowFloorProjection({
  centerX,
  centerZ,
  centerY,
  floorY,
  width,
  rotationY,
}: {
  centerX: number
  centerZ: number
  centerY: number
  floorY: number
  width: number
  rotationY: number
}) {
  // Footprint: a short segment of length `width` along the window's wall axis,
  // centred under the window on the floor. The window faces `rotationY` about Y
  // (its width runs along the wall), so the along-wall direction is
  // (cos, -sin) in XZ.
  const footprint = useMemo(() => {
    const half = width / 2
    const dirX = Math.cos(rotationY)
    const dirZ = -Math.sin(rotationY)
    const position = new Float32BufferAttribute(new Float32Array(6), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new LineSegments(geometry, footprintMaterial)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    line.raycast = () => {}
    position.setXYZ(0, centerX - dirX * half, floorY + 0.002, centerZ - dirZ * half)
    position.setXYZ(1, centerX + dirX * half, floorY + 0.002, centerZ + dirZ * half)
    position.needsUpdate = true
    return line
  }, [centerX, centerZ, floorY, width, rotationY])

  // Dashed vertical tether from the window centre down to the footprint.
  const drop = useMemo(() => {
    const span = Math.max(centerY - floorY, 0)
    const segs: number[] = []
    let y = floorY
    while (y < floorY + span) {
      const top = Math.min(y + DASH, floorY + span)
      segs.push(centerX, y, centerZ, centerX, top, centerZ)
      y += DASH + GAP
    }
    const position = new Float32BufferAttribute(new Float32Array(segs), 3)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', position)
    const line = new LineSegments(geometry, dropMaterial)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1000
    line.raycast = () => {}
    return line
  }, [centerX, centerZ, centerY, floorY])

  useEffect(() => () => footprint.geometry.dispose(), [footprint])
  useEffect(() => () => drop.geometry.dispose(), [drop])

  return (
    <>
      <primitive object={footprint} />
      <primitive object={drop} />
    </>
  )
}
