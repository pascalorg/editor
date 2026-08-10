import type {
  CustomMeshFace,
  CustomMeshNode,
  CustomMeshTopology,
  GeometryContext,
} from '@pascal-app/core'
import { createDefaultMaterial, type RenderShading, resolveMaterialRef } from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import { customMeshFaceNormal } from './commands'

type Point = [number, number, number]

function projectedPoint(point: Point, normal: Point): Vector2 {
  const ax = Math.abs(normal[0])
  const ay = Math.abs(normal[1])
  const az = Math.abs(normal[2])
  if (ax >= ay && ax >= az) return new Vector2(point[1], point[2])
  if (ay >= az) return new Vector2(point[0], point[2])
  return new Vector2(point[0], point[1])
}

export function triangulateCustomMeshFace(
  topology: CustomMeshTopology,
  face: CustomMeshFace,
): { triangles: [Point, Point, Point][]; normal: Point } | null {
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const contour = face.vertexIds
    .map((id) => vertexById.get(id))
    .filter((point): point is Point => !!point)
  const normal = customMeshFaceNormal(topology, face)
  if (!normal || contour.length !== face.vertexIds.length) return null

  const triangleIndices = ShapeUtils.triangulateShape(
    contour.map((point) => projectedPoint(point, normal)),
    [],
  )
  const targetNormal = new Vector3(...normal)
  const triangles: [Point, Point, Point][] = []
  for (const indices of triangleIndices) {
    const aIndex = indices[0]
    const bIndex = indices[1]
    const cIndex = indices[2]
    if (aIndex === undefined || bIndex === undefined || cIndex === undefined) continue
    const a = contour[aIndex]
    let b = contour[bIndex]
    let c = contour[cIndex]
    if (!(a && b && c)) continue
    const triangleNormal = new Vector3(...b)
      .sub(new Vector3(...a))
      .cross(new Vector3(...c).sub(new Vector3(...a)))
    if (triangleNormal.dot(targetNormal) < 0) [b, c] = [c, b]
    triangles.push([a, b, c])
  }
  return { triangles, normal }
}

export function buildCustomMeshGeometry(
  node: CustomMeshNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  group.name = 'custom-mesh-geometry'
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const faceRanges: { faceId: string; start: number; count: number }[] = []
  const slotIds = [...new Set(node.topology.faces.map((face) => face.materialSlot))]
  const materialIndex = new Map(slotIds.map((slotId, index) => [slotId, index]))

  for (const face of node.topology.faces) {
    const triangulated = triangulateCustomMeshFace(node.topology, face)
    if (!triangulated) continue
    const start = positions.length / 3
    for (const triangle of triangulated.triangles) {
      for (const point of triangle) {
        positions.push(...point)
        normals.push(...triangulated.normal)
        const uv = projectedPoint(point, triangulated.normal)
        uvs.push(uv.x, uv.y)
      }
    }
    const count = positions.length / 3 - start
    geometry.addGroup(start, count, materialIndex.get(face.materialSlot) ?? 0)
    faceRanges.push({ faceId: face.id, start, count })
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.customMeshFaces = faceRanges

  const materials = slotIds.map((slotId) => {
    const ref = node.slots?.[slotId]
    return (
      (ref ? resolveMaterialRef(ref, ctx?.materials, shading) : null) ??
      createDefaultMaterial('#b8c5d1', 0.72, shading)
    )
  })
  const mesh = new Mesh(geometry, materials.length === 1 ? materials[0] : materials)
  mesh.name = 'custom-mesh-body'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.customMesh = true
  group.add(mesh)
  return group
}
