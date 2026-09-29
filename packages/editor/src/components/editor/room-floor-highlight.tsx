'use client'

import { type Point, useScene } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { getRoomSelectionIndex } from '../../hooks/use-selected-room'
import { EDITOR_LAYER } from '../../lib/constants'

const HIGHLIGHT_COLOR = '#818cf8'
/** Half width (m) of the outline ribbon. */
const OUTLINE_HALF_WIDTH = 0.025
/** Above the plane it marks, so the floor under it never z-fights. */
const LIFT = 0.004

const fillMaterial = new MeshBasicNodeMaterial({
  color: HIGHLIGHT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.2,
  side: DoubleSide,
  transparent: true,
})
const edgeMaterial = new MeshBasicNodeMaterial({
  color: HIGHLIGHT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.95,
  side: DoubleSide,
  transparent: true,
})
const noRaycast = () => {}

/** Flat quads along each ring edge: a line WebGPU draws at a real width. */
function outlineRibbon(rings: readonly (readonly Point[])[], halfWidth: number) {
  const positions: number[] = []
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 1e-9) continue
      const nx = (-(b[1] - a[1]) / length) * halfWidth
      const nz = ((b[0] - a[0]) / length) * halfWidth
      const [p0, p1, p2, p3] = [
        [a[0] + nx, a[1] + nz],
        [b[0] + nx, b[1] + nz],
        [b[0] - nx, b[1] - nz],
        [a[0] - nx, a[1] - nz],
      ] as const
      for (const [x, z] of [p0, p1, p2, p0, p2, p3]) positions.push(x, 0, z)
    }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
}

/**
 * A room's clear floor drawn on top of every wall (depth test off): a subtle
 * fill and a strong outline, holes included, at `elevation` in the level
 * frame — the plane a draft in that room lands on (Divide on the floor, Add
 * mezzanine on the mezzanine's plane), so the user always sees whether the
 * pointer is inside the room without any wall being cut away.
 */
export function RoomFloorHighlight3D({
  levelId,
  zoneId,
  elevation,
  renderOrder = 998,
}: {
  levelId: string
  zoneId: string
  elevation: number
  /** The fill's order; the outline draws one above it. */
  renderOrder?: number
}) {
  const nodes = useScene((s) => s.nodes)
  const geometry = useMemo(() => {
    const record = getRoomSelectionIndex(levelId)
      .update(nodes)
      .find((room) => room.zoneId === zoneId)
    if (!record) return null
    const shapes = record.clearPolygon.map(({ outer, holes }) => {
      const shape = new Shape(outer.map(([x, z]) => new Vector2(x, z)))
      shape.holes = holes.map((hole) => new Path(hole.map(([x, z]) => new Vector2(x, z))))
      return shape
    })
    return {
      fill: new ShapeGeometry(shapes).rotateX(Math.PI / 2),
      outline: outlineRibbon(
        record.clearPolygon.flatMap(({ outer, holes }) => [outer, ...holes]),
        OUTLINE_HALF_WIDTH,
      ),
    }
  }, [nodes, levelId, zoneId])
  useEffect(
    () => () => {
      geometry?.fill.dispose()
      geometry?.outline.dispose()
    },
    [geometry],
  )
  if (!geometry) return null
  return (
    <group position-y={elevation + LIFT}>
      <mesh
        geometry={geometry.fill}
        layers={EDITOR_LAYER}
        material={fillMaterial}
        raycast={noRaycast}
        renderOrder={renderOrder}
      />
      <mesh
        geometry={geometry.outline}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        raycast={noRaycast}
        renderOrder={renderOrder + 1}
      />
    </group>
  )
}
