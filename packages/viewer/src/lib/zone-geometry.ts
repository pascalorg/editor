import type { Ring } from '@pascal-app/core'
import * as THREE from 'three'

type ZoneFootprint = { polygon: Ring; holes?: Ring[] }
const Y_OFFSET = 0.01
const ZONE_WALL_HEIGHT = 2.3

export function createZoneShape({ polygon, holes = [] }: ZoneFootprint): THREE.Shape {
  const shape = new THREE.Shape()
  const draw = (path: THREE.Path, ring: Ring) => {
    ring.forEach(([x, z], i) => {
      if (i === 0) path.moveTo(x, -z)
      else path.lineTo(x, -z)
    })
    path.closePath()
  }
  draw(shape, polygon)
  for (const ring of holes) {
    if (ring.length < 3) continue
    const path = new THREE.Path()
    draw(path, ring)
    shape.holes.push(path)
  }
  return shape
}

/** Vertical quads along each polygon edge (UV.y 0 at the floor, 1 at the top). */
export function createZoneWallGeometry(footprint: ZoneFootprint): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const polygon of [footprint.polygon, ...(footprint.holes ?? [])]) {
    for (let i = 0; i < polygon.length; i++) {
      const [cx, cz] = polygon[i]!
      const [nx, nz] = polygon[(i + 1) % polygon.length]!
      const base = positions.length / 3
      positions.push(
        cx,
        Y_OFFSET,
        cz,
        nx,
        Y_OFFSET,
        nz,
        nx,
        Y_OFFSET + ZONE_WALL_HEIGHT,
        nz,
        cx,
        Y_OFFSET + ZONE_WALL_HEIGHT,
        cz,
      )
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
