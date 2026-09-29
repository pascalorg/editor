import {
  type BlockFace,
  type BlockNode,
  type BlockTopology,
  type GeometryContext,
  getBlockFaceFrame,
  getBlockFaceNormal,
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
import { BLOCK_BODY_SLOT_ID, blockMaterialSlotIds } from './material-slots'

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

export function triangulateBlockFace(
  topology: BlockTopology,
  face: BlockFace,
  vertexById: Map<string, Point> = new Map(
    topology.vertices.map((vertex) => [vertex.id, vertex.position]),
  ),
): { triangles: [Point, Point, Point][]; normal: Point } | null {
  const contour = face.vertexIds
    .map((id) => vertexById.get(id))
    .filter((point): point is Point => !!point)
  const normal = getBlockFaceNormal(topology, face, vertexById)
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

export function buildBlockGeometry(
  node: BlockNode,
  ctx?: Pick<GeometryContext, 'materials'>,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  group.name = 'block-geometry'
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const faceRanges: { faceId: string; start: number; count: number }[] = []
  const slotIds = blockMaterialSlotIds(node.topology, node.slots, node.slotNames)
  // One id map for the whole build: a per-face map made every rebuild O(faces × vertices).
  const vertexById = new Map(
    node.topology.vertices.map((vertex) => [vertex.id, vertex.position] as const),
  )
  const faceNormals = new Map(
    node.topology.faces.flatMap((face) => {
      const normal = getBlockFaceNormal(node.topology, face, vertexById)
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

  // Faces are laid out slot by slot so each material slot is one draw group; the
  // per-face ranges stay contiguous for picking and paint.
  const facesBySlot = new Map(slotIds.map((slotId) => [slotId, [] as BlockFace[]]))
  for (const face of node.topology.faces) {
    ;(facesBySlot.get(face.materialSlot) ?? facesBySlot.get(slotIds[0]!))?.push(face)
  }
  for (const [materialIndex, slotId] of slotIds.entries()) {
    const slotStart = positions.length / 3
    for (const face of facesBySlot.get(slotId) ?? []) {
      const triangulated = triangulateBlockFace(node.topology, face, vertexById)
      // UVs in metres along the face's own frame (level U, up-slope V), the frame
      // face hosting uses; a dominant-axis projection turned X-facing sides 90°,
      // mirrored some faces and stretched slopes.
      const frame = getBlockFaceFrame(node.topology, face.id)
      if (!(triangulated && frame)) continue
      const { xAxis, yAxis } = frame
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
          uvs.push(
            point[0] * xAxis[0] + point[1] * xAxis[1] + point[2] * xAxis[2],
            point[0] * yAxis[0] + point[1] * yAxis[1] + point[2] * yAxis[2],
          )
        }
      }
      faceRanges.push({ faceId: face.id, start, count: positions.length / 3 - start })
    }
    const slotCount = positions.length / 3 - slotStart
    if (slotCount > 0) geometry.addGroup(slotStart, slotCount, materialIndex)
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.blockFaces = faceRanges

  const bodyMaterialRef = node.slots?.[BLOCK_BODY_SLOT_ID]
  const roleMaterial = createSurfaceRoleMaterial('wall', colorPreset, FrontSide, sceneTheme)
  const bodyMaterial =
    (textures && bodyMaterialRef
      ? resolveMaterialRef(bodyMaterialRef, ctx?.materials, shading)
      : null) ?? roleMaterial
  const bodyFallbackSlotIds: string[] = []
  const materials = slotIds.map((slotId) => {
    const materialRef = node.slots?.[slotId]
    if (slotId === BLOCK_BODY_SLOT_ID) return bodyMaterial
    if (!materialRef) {
      bodyFallbackSlotIds.push(slotId)
      return bodyMaterial
    }
    const resolved = textures ? resolveMaterialRef(materialRef, ctx?.materials, shading) : null
    if (resolved) return resolved
    bodyFallbackSlotIds.push(slotId)
    return bodyMaterial
  })
  // A single-slot block draws with one material, so node batching can pack it.
  const mesh = new Mesh(geometry, materials.length === 1 ? materials[0]! : materials)
  mesh.name = 'block-body'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.block = true
  mesh.userData.slotIds = slotIds
  mesh.userData.bodyFallbackSlotIds = bodyFallbackSlotIds
  group.add(mesh)
  return group
}
