import type {
  CustomMeshFace,
  CustomMeshNode,
  CustomMeshTopology,
  GeometryContext,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import { customMeshFaceNormal } from './commands'
import { CUSTOM_MESH_BODY_SLOT_ID, customMeshMaterialSlotIds } from './material-slots'

type Point = [number, number, number]
const SMOOTH_NORMAL_ANGLE_COSINE = Math.cos(Math.PI / 6)

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
  ctx?: Pick<GeometryContext, 'materials'>,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  group.name = 'custom-mesh-geometry'
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const faceRanges: { faceId: string; start: number; count: number }[] = []
  const slotIds = customMeshMaterialSlotIds(node.topology, node.slots)
  const materialIndexBySlotId = new Map(slotIds.map((slotId, index) => [slotId, index]))
  const faceNormals = new Map(
    node.topology.faces.flatMap((face) => {
      const normal = customMeshFaceNormal(node.topology, face)
      return normal ? [[face.id, normal] as const] : []
    }),
  )
  const adjacentFaceNormals = new Map<string, Point[]>()
  for (const face of node.topology.faces) {
    const normal = faceNormals.get(face.id)
    if (!normal) continue
    for (const vertexId of face.vertexIds) {
      const adjacent = adjacentFaceNormals.get(vertexId) ?? []
      adjacent.push(normal)
      adjacentFaceNormals.set(vertexId, adjacent)
    }
  }
  const cornerNormals = new Map<string, Point>()
  for (const face of node.topology.faces) {
    const faceNormal = faceNormals.get(face.id)
    if (!faceNormal) continue
    for (const vertexId of face.vertexIds) {
      const smoothNormal = new Vector3()
      for (const adjacentNormal of adjacentFaceNormals.get(vertexId) ?? []) {
        const dot =
          faceNormal[0] * adjacentNormal[0] +
          faceNormal[1] * adjacentNormal[1] +
          faceNormal[2] * adjacentNormal[2]
        if (dot >= SMOOTH_NORMAL_ANGLE_COSINE) smoothNormal.add(new Vector3(...adjacentNormal))
      }
      smoothNormal.normalize()
      cornerNormals.set(`${face.id}\u0000${vertexId}`, smoothNormal.toArray() as Point)
    }
  }
  const vertexIdByPosition = new Map(
    node.topology.vertices.map((vertex) => [vertex.position, vertex.id] as const),
  )

  for (const face of node.topology.faces) {
    const triangulated = triangulateCustomMeshFace(node.topology, face)
    if (!triangulated) continue
    const start = positions.length / 3
    for (const triangle of triangulated.triangles) {
      for (const point of triangle) {
        positions.push(...point)
        const vertexId = vertexIdByPosition.get(point)
        normals.push(
          ...(vertexId
            ? (cornerNormals.get(`${face.id}\u0000${vertexId}`) ?? triangulated.normal)
            : triangulated.normal),
        )
        const uv = projectedPoint(point, triangulated.normal)
        uvs.push(uv.x, uv.y)
      }
    }
    const count = positions.length / 3 - start
    geometry.addGroup(start, count, materialIndexBySlotId.get(face.materialSlot) ?? 0)
    faceRanges.push({ faceId: face.id, start, count })
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.customMeshFaces = faceRanges

  const bodyMaterialRef = node.slots?.[CUSTOM_MESH_BODY_SLOT_ID]
  const roleMaterial = createSurfaceRoleMaterial('wall', colorPreset, FrontSide, sceneTheme)
  const bodyMaterial =
    (textures && bodyMaterialRef
      ? resolveMaterialRef(bodyMaterialRef, ctx?.materials, shading)
      : null) ?? roleMaterial
  const bodyFallbackSlotIds: string[] = []
  const materials = slotIds.map((slotId) => {
    const materialRef = node.slots?.[slotId]
    if (slotId === CUSTOM_MESH_BODY_SLOT_ID) return bodyMaterial
    if (!materialRef) {
      bodyFallbackSlotIds.push(slotId)
      return bodyMaterial
    }
    const resolved = textures ? resolveMaterialRef(materialRef, ctx?.materials, shading) : null
    if (resolved) return resolved
    bodyFallbackSlotIds.push(slotId)
    return bodyMaterial
  })
  const mesh = new Mesh(geometry, materials)
  mesh.name = 'custom-mesh-body'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.customMesh = true
  mesh.userData.slotIds = slotIds
  mesh.userData.bodyFallbackSlotIds = bodyFallbackSlotIds
  group.add(mesh)
  return group
}
