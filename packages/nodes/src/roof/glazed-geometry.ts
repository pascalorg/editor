import {
  type AnyNode,
  type GlazedRoofFace,
  getBarrelRoofSolidPieces,
  getEffectiveNode,
  getGlazedRoofPieces,
  isGlazedRoofSegment,
  nodeRegistry,
  type RoofSegmentNode,
} from '@pascal-app/core'
import {
  Brush,
  clipDirectRoofGeometryAgainstSiblings,
  clipGeometryBySegmentTrim,
  Evaluator,
  ensureRenderableGeometryAttributes,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import {
  BufferGeometry,
  ExtrudeGeometry,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const cutMaterials: Material[] = Array.from({ length: 4 }, () => new MeshBasicMaterial())

function prism(
  face: GlazedRoofFace,
  polygon: [number, number][],
  thickness: number,
): BufferGeometry | null {
  if (polygon.length < 3) return null
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  if (Math.abs(area) < 1e-8) return null
  const shape = new Shape(polygon.map(([u, v]) => new Vector2(u, v)))
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  const u = new Vector3(...face.u),
    v = new Vector3(...face.v),
    normal = new Vector3(...face.normal)
  const matrix = new Matrix4().makeBasis(u, v, normal.clone().negate())
  matrix.setPosition(new Vector3(...face.origin))
  geometry.applyMatrix4(matrix)
  if (matrix.determinant() < 0) {
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(position, i)
      position.setXYZ(i, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2))
      position.setXYZ(i + 2, a.x, a.y, a.z)
      const x = uv.getX(i),
        y = uv.getY(i)
      uv.setXY(i, uv.getX(i + 2), uv.getY(i + 2))
      uv.setXY(i + 2, x, y)
    }
  }
  // In face coordinates, one UV unit is one metre, including the edge profiles.
  geometry.computeVertexNormals()
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}

/** Local-space glazing, including cut pane edges and the members surrounding them. */
export function buildGlazedRoofGeometry(
  node: RoofSegmentNode,
  nodes: Readonly<Record<string, AnyNode>> = {},
): BufferGeometry {
  const pieces: BufferGeometry[] = []
  const add = (face: GlazedRoofFace, polygon: [number, number][], depth: number, slot: number) => {
    const geometry = prism(face, polygon, depth)
    if (!geometry) return
    geometry.clearGroups()
    geometry.addGroup(0, geometry.getAttribute('position').count, slot)
    pieces.push(geometry)
  }
  for (const piece of isGlazedRoofSegment(node)
    ? getGlazedRoofPieces(node)
    : getBarrelRoofSolidPieces(node))
    add(piece.face, piece.polygon, piece.depth, piece.slot)
  let geometry = mergeGeometries(pieces, true) ?? new BufferGeometry()
  for (const piece of pieces) piece.dispose()
  // mergeGeometries assigns one group per input; restore each piece's semantic slot.
  geometry.groups.forEach((group, index) => {
    group.materialIndex = pieces[index]?.groups[0]?.materialIndex ?? 0
  })
  geometry = clipGeometryBySegmentTrim(geometry, node) ?? geometry
  const evaluator = new Evaluator()
  evaluator.useGroups = true
  evaluator.attributes = ['position', 'normal', 'uv', 'uv2']
  for (const id of node.children ?? []) {
    const stored = nodes[id]
    if (!stored) continue
    const child = getEffectiveNode(stored)
    if ((child.metadata as Record<string, unknown> | undefined)?.isTransient) continue
    const cutGeometry = nodeRegistry
      .get(child.type)
      ?.capabilities.roofAccessory?.buildCut?.(child, node)
    if (!cutGeometry) continue
    const brush = new Brush(geometry, cutMaterials),
      cutter = new Brush(cutGeometry, cutMaterials[0])
    try {
      prepareBrushForCSG(brush)
      prepareBrushForCSG(cutter)
      const result = evaluator.evaluate(brush, cutter, SUBTRACTION)
      const next = result.geometry.clone()
      const materials = Array.isArray(result.material) ? result.material : [result.material]
      for (const group of next.groups)
        group.materialIndex = Math.max(
          0,
          cutMaterials.indexOf(materials[group.materialIndex ?? 0]!),
        )
      result.geometry.dispose()
      geometry.dispose()
      geometry = next
    } finally {
      cutGeometry.dispose()
    }
  }
  geometry = clipDirectRoofGeometryAgainstSiblings(
    geometry,
    node,
    nodes as Record<string, AnyNode>,
    'segment',
  )
  for (const group of geometry.groups) group.materialIndex = (group.materialIndex ?? 0) % 4
  geometry.computeVertexNormals()
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}

export const glazedRoofGeometryAdapter = {
  independent: (node: RoofSegmentNode) => isGlazedRoofSegment(node) || node.roofType === 'barrel',
  syncGeometry(node: RoofSegmentNode, mesh: Mesh) {
    if (!isGlazedRoofSegment(node)) return
    const shadow = mesh.getObjectByName('glazed-roof-shadow') as Mesh | undefined
    if (!shadow) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const indices: number[] = []
    for (const group of mesh.geometry.groups) {
      const material = materials[group.materialIndex ?? 0]
      if (material?.transparent && material.opacity < 1) continue
      for (let i = group.start; i < group.start + group.count; i++)
        indices.push(mesh.geometry.index ? mesh.geometry.index.getX(i) : i)
    }
    const geometry = mesh.geometry.clone()
    geometry.clearGroups()
    geometry.setIndex(indices)
    geometry.setDrawRange(0, indices.length)
    shadow.geometry.dispose()
    shadow.geometry = geometry
  },
  buildGeometry: (node: RoofSegmentNode, nodes: Record<string, AnyNode>) =>
    isGlazedRoofSegment(node) || node.roofType === 'barrel'
      ? buildGlazedRoofGeometry(node, nodes)
      : null,
}
