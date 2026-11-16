import { type SlabTerrainFrame, surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import { BufferGeometry, Float32BufferAttribute } from 'three'

type Vertex = {
  x: number
  y: number
  z: number
  u: number
  v: number
  siteX: number
  siteZ: number
}
const EPSILON = 1e-9

function interpolate(from: Vertex, to: Vertex, fraction: number): Vertex {
  const mix = (key: keyof Vertex) => from[key] + (to[key] - from[key]) * fraction
  return {
    x: mix('x'),
    y: mix('y'),
    z: mix('z'),
    u: mix('u'),
    v: mix('v'),
    siteX: mix('siteX'),
    siteZ: mix('siteZ'),
  }
}

function clipHalf(polygon: Vertex[], distance: (vertex: Vertex) => number, sign: number): Vertex[] {
  const result: Vertex[] = []
  for (const [index, from] of polygon.entries()) {
    const to = polygon[(index + 1) % polygon.length]
    if (!to) continue
    const fromDistance = distance(from) * sign
    const toDistance = distance(to) * sign
    if (fromDistance >= -EPSILON) result.push(from)
    if (
      (fromDistance > EPSILON && toDistance < -EPSILON) ||
      (fromDistance < -EPSILON && toDistance > EPSILON)
    ) {
      result.push(interpolate(from, to, fromDistance / (fromDistance - toDistance)))
    }
  }
  return result
}

function splitFamily(
  polygons: Vertex[][],
  coordinate: (vertex: Vertex) => number,
  maximum: number,
): Vertex[][] {
  const result: Vertex[][] = []
  for (const polygon of polygons) {
    const coordinates = polygon.map(coordinate)
    const first = Math.max(0, Math.ceil(Math.min(...coordinates)))
    const last = Math.min(maximum, Math.floor(Math.max(...coordinates)))
    let parts = [polygon]
    for (let crease = first; crease <= last; crease++) {
      parts = parts.flatMap((part) => {
        const distances = part.map((vertex) => coordinate(vertex) - crease)
        if (
          !distances.some((distance) => distance < -EPSILON) ||
          !distances.some((distance) => distance > EPSILON)
        )
          return [part]
        const distance = (vertex: Vertex) => coordinate(vertex) - crease
        return [clipHalf(part, distance, 1), clipHalf(part, distance, -1)].filter(
          (half) => half.length >= 3,
        )
      })
    }
    result.push(...parts)
  }
  return result
}

function terrainPieces(triangle: Vertex[], field: TerrainField | null): Vertex[][] {
  if (!field) return [triangle]
  const column = (vertex: Vertex) => (vertex.siteX - field.origin[0]) / field.spacing
  const row = (vertex: Vertex) => (vertex.siteZ - field.origin[1]) / field.spacing
  const columns = splitFamily([triangle], column, field.cols - 1)
  const rows = splitFamily(columns, row, field.rows - 1)
  return splitFamily(rows, (vertex) => column(vertex) + row(vertex), field.cols + field.rows - 2)
}

/** Split at every terrain crease before lifting, so interior hills cannot pass through a cap. */
export function drapeSlabGeometry(source: BufferGeometry, frame: SlabTerrainFrame): BufferGeometry {
  const position = source.getAttribute('position')
  const uv = source.getAttribute('uv')
  const index = source.getIndex()
  const positions: number[] = []
  const uvs: number[] = []
  const vertexAt = (offset: number): Vertex => {
    const vertex = index ? index.getX(offset) : offset
    const x = position.getX(vertex)
    const z = position.getZ(vertex)
    const [siteX, siteZ] = frame.toSite(x, z)
    return {
      x,
      y: position.getY(vertex),
      z,
      u: uv?.getX(vertex) ?? x,
      v: uv?.getY(vertex) ?? -z,
      siteX,
      siteZ,
    }
  }
  for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
    const triangle = [vertexAt(offset), vertexAt(offset + 1), vertexAt(offset + 2)]
    for (const polygon of terrainPieces(triangle, frame.field)) {
      const first = polygon[0]
      if (!first) continue
      for (let corner = 1; corner < polygon.length - 1; corner++) {
        const second = polygon[corner]
        const third = polygon[corner + 1]
        if (!(second && third)) continue
        for (const vertex of [first, second, third]) {
          const ground = frame.field ? surfaceHeightAt(frame.field, vertex.siteX, vertex.siteZ) : 0
          positions.push(vertex.x, vertex.y + ground - frame.baseY, vertex.z)
          uvs.push(vertex.u, vertex.v)
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}
