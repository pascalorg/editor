import { type BlockTopology, blockUndirectedEdgeKey } from '@pascal-app/core'
import type { IfcAPI } from 'web-ifc'

type Point = [number, number, number]

export function extractBeamGeometry(
  ifcApi: IfcAPI,
  modelID: number,
  expressID: number,
  options: { origin: number[]; unitFactor: number; swapYZ: boolean; levelElevation: number },
): { position: Point; topology: BlockTopology } | null {
  const mesh = ifcApi.GetFlatMesh(modelID, expressID)
  const topology: BlockTopology = { vertices: [], edges: [], faces: [] }
  const vertexByPosition = new Map<string, string>()
  const edgeKeys = new Set<string>()

  try {
    for (let g = 0; g < mesh.geometries.size(); g++) {
      const placed = mesh.geometries.get(g)
      const m = placed.flatTransformation
      const geometry = ifcApi.GetGeometry(modelID, placed.geometryExpressID)
      try {
        const vertices = ifcApi.GetVertexArray(
          geometry.GetVertexData(),
          geometry.GetVertexDataSize(),
        )
        const indices = ifcApi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
        const vertexIds: string[] = []
        for (let v = 0; v < vertices.length; v += 6) {
          const x = vertices[v]
          const y = vertices[v + 1]
          const z = vertices[v + 2]
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14]
          // web-ifc meshes are already in meters and use (X, Z, -Y).
          // Undo that basis before applying the converter's origin and axis preset.
          const sx = wx - options.origin[0] * options.unitFactor
          const sy = -wz - options.origin[1] * options.unitFactor
          const sz = wy - options.origin[2] * options.unitFactor - options.levelElevation
          const position: Point = options.swapYZ ? [sx, sz, sy] : [sx, sy, sz]
          if (!position.every(Number.isFinite)) throw new Error('Non-finite beam vertex')
          const key = position.join(',')
          let id = vertexByPosition.get(key)
          if (!id) {
            id = `v${topology.vertices.length}`
            topology.vertices.push({ id, position })
            vertexByPosition.set(key, id)
          }
          vertexIds.push(id)
        }

        const determinant =
          m[0] * (m[5] * m[10] - m[9] * m[6]) -
          m[4] * (m[1] * m[10] - m[9] * m[2]) +
          m[8] * (m[1] * m[6] - m[5] * m[2])
        // Baking a reflection into the vertices also reverses the outward face winding.
        const reverseWinding = determinant < 0 !== options.swapYZ
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const ids = [vertexIds[indices[i]], vertexIds[indices[i + 1]], vertexIds[indices[i + 2]]]
          if (ids.some((id) => id === undefined)) throw new Error('Invalid beam triangle index')
          if (new Set(ids).size < 3) continue
          if (reverseWinding) ids.reverse()
          topology.faces.push({
            id: `f${topology.faces.length}`,
            vertexIds: ids,
            materialSlot: 'body',
          })
          for (let j = 0; j < 3; j++) {
            const a = ids[j]
            const b = ids[(j + 1) % 3]
            const key = blockUndirectedEdgeKey(a, b)
            if (edgeKeys.has(key)) continue
            edgeKeys.add(key)
            topology.edges.push({ id: `e${topology.edges.length}`, vertexIds: [a, b] })
          }
        }
      } finally {
        geometry.delete()
      }
    }
  } finally {
    mesh.delete?.()
  }

  if (topology.faces.length === 0) return null
  const min: Point = [Infinity, Infinity, Infinity]
  const max: Point = [-Infinity, -Infinity, -Infinity]
  for (const vertex of topology.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex.position[axis])
      max[axis] = Math.max(max[axis], vertex.position[axis])
    }
  }
  const position: Point = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  for (const vertex of topology.vertices) {
    vertex.position = vertex.position.map((value, axis) => value - position[axis]) as Point
  }
  return { position, topology }
}
