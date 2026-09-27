import {
  type Evaluation,
  evaluateRecipe,
  type ProceduralItemNode,
} from '@pascal-app/core/procedural-items'
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
export type Batch = {
  slot: string
  motionGroup?: string
  geometry: BufferGeometry
  motionGeometry?: BufferGeometry
  ranges: { end: number; partId: string; shapeId: string }[]
}
export type BuiltItem = {
  batches: Batch[]
  evaluation: Evaluation
  milliseconds: number
  triangles: number
}
const TAU = 2 * Math.PI
function flipped(geometry: BufferGeometry) {
  const flat = geometry.toNonIndexed()
  geometry.dispose()
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = flat.getAttribute(name)
    for (let i = 0; i < attribute.count; i += 3)
      for (let k = 0; k < attribute.itemSize; k++) {
        const a = attribute.getComponent(i + 1, k)
        attribute.setComponent(i + 1, k, attribute.getComponent(i + 2, k))
        attribute.setComponent(i + 2, k, a)
      }
  }
  const normal = flat.getAttribute('normal')
  for (let i = 0; i < normal.count; i++)
    normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i))
  return flat
}
/** Flat triangles facing `normal` (winding fixed per triangle), with placeholder UVs. */
function facing(triangles: Vector3[][], normal: (triangle: Vector3[]) => Vector3) {
  const position: number[] = [],
    normals: number[] = []
  const ab = new Vector3(),
    ac = new Vector3()
  for (const triangle of triangles) {
    const want = normal(triangle)
    const face = ab
      .subVectors(triangle[1]!, triangle[0]!)
      .cross(ac.subVectors(triangle[2]!, triangle[0]!))
    const [a, b, c] = face.dot(want) < 0 ? [triangle[0]!, triangle[2]!, triangle[1]!] : triangle
    for (const v of [a, b, c]) {
      position.push(v.x, v.y, v.z)
      normals.push(want.x, want.y, want.z)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(new Float32Array((position.length / 3) * 2), 2),
  )
  return geometry
}
// A unit cylinder (diameter 1, height 1, centred) with v2's segments, open, inner and arc.
// Counts match `shapeTriangles`; with no options this is exactly today's 24-gon.
function cylinderSource(shape: Evaluation['shapes'][number]): BufferGeometry {
  const { segments = 24, open = false, inner, arc = TAU } = shape
  const top = 0.5 * shape.topScale
  if (shape.segments === undefined && !open && inner === undefined && shape.arc === undefined)
    return new CylinderGeometry(top, 0.5, 1, 24, 1)
  const hollow = inner !== undefined
  const pieces: BufferGeometry[] = [
    new CylinderGeometry(top, 0.5, 1, segments, 1, open || hollow, 0, arc).toNonIndexed(),
  ]
  const at = (radius: number, theta: number, y: number) =>
    new Vector3(radius * Math.sin(theta), y, radius * Math.cos(theta))
  // Materials are front-sided, so an open solid also draws the back of its wall.
  if (open && !hollow)
    pieces.push(flipped(new CylinderGeometry(top, 0.5, 1, segments, 1, true, 0, arc)))
  if (hollow) {
    pieces.push(
      flipped(new CylinderGeometry(top * inner, 0.5 * inner, 1, segments, 1, true, 0, arc)),
    )
    if (!open)
      for (const [y, outer] of [
        [-0.5, 0.5],
        [0.5, top],
      ] as const) {
        if (outer === 0) continue
        const rings: Vector3[][] = []
        for (let i = 0; i < segments; i++) {
          const a = (arc * i) / segments,
            b = (arc * (i + 1)) / segments
          const quad = [
            at(outer * inner, a, y),
            at(outer, a, y),
            at(outer, b, y),
            at(outer * inner, b, y),
          ]
          rings.push([quad[0]!, quad[1]!, quad[2]!], [quad[0]!, quad[2]!, quad[3]!])
        }
        pieces.push(facing(rings, () => new Vector3(0, Math.sign(y), 0)))
      }
  }
  if (arc < TAU - 1e-9 && !open)
    for (const theta of [0, arc]) {
      const from = hollow ? inner : 0
      const quad = [
        at(0.5 * from, theta, -0.5),
        at(0.5, theta, -0.5),
        at(top, theta, 0.5),
        at(top * from, theta, 0.5),
      ]
      const outward = new Vector3(Math.cos(theta), 0, -Math.sin(theta)).multiplyScalar(
        theta === 0 ? -1 : 1,
      )
      pieces.push(
        facing(
          [
            [quad[0]!, quad[1]!, quad[2]!],
            [quad[0]!, quad[2]!, quad[3]!],
          ],
          () => outward,
        ),
      )
    }
  const merged = mergeGeometries(pieces, false)!
  for (const piece of pieces) piece.dispose()
  return merged
}
export const proceduralMetrics = { builds: 0, cacheHits: 0, lastBuildMs: 0, liveEntries: 0 }
const cache = new Map<string, { value: BuiltItem; users: number }>()
export const geometrySignature = (node: ProceduralItemNode) =>
  JSON.stringify([node.recipe, node.parameters])
export function buildProceduralGeometry(node: ProceduralItemNode): BuiltItem {
  const start = performance.now(),
    evaluation = evaluateRecipe(node.recipe, node.parameters)
  const bySlot = new Map<
    string,
    { geometries: BufferGeometry[]; ranges: Batch['ranges']; faces: number }
  >()
  for (const shape of evaluation.shapes) {
    const [w, h, d] = shape.size
    const source =
      shape.primitive === 'roundedBox'
        ? new RoundedBoxGeometry(w, h, d, 2, shape.radius)
        : shape.primitive === 'cylinder'
          ? cylinderSource(shape)
          : shape.primitive === 'ellipsoid'
            ? new SphereGeometry(0.5, 24, 16)
            : new BoxGeometry(w, h, d)
    if (shape.primitive === 'cylinder' || shape.primitive === 'ellipsoid') source.scale(w, h, d)
    const geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) source.dispose()
    geometry.clearGroups()
    const vertices = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv')
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        y = vertices.getY(i),
        z = vertices.getZ(i)
      const nx = Math.abs(normals.getX(i)),
        ny = Math.abs(normals.getY(i)),
        nz = Math.abs(normals.getZ(i))
      uv.setXY(i, nx > ny && nx > nz ? z : x, ny > nx && ny > nz ? z : y)
    }
    geometry.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...shape.position),
        new Quaternion().setFromEuler(new Euler(...shape.rotation)),
        new Vector3(1, 1, 1),
      ),
    )
    const key = JSON.stringify([shape.motionGroup ?? null, shape.slot])
    const entry = bySlot.get(key) ?? { geometries: [], ranges: [], faces: 0 }
    entry.geometries.push(geometry)
    entry.faces += geometry.getAttribute('position').count / 3
    entry.ranges.push({ end: entry.faces, partId: shape.partId, shapeId: shape.id })
    bySlot.set(key, entry)
  }
  const batches: Batch[] = []
  for (const [key, entry] of bySlot) {
    const [motionGroup, slot] = JSON.parse(key) as [string | null, string]
    const geometry = mergeGeometries(entry.geometries, false)
    for (const g of entry.geometries) g.dispose()
    if (!geometry) throw new Error('Unable to batch procedural geometry')
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    // Catalog captures and placement previews consume geometry in design coordinates.
    const pivot = evaluation.motions.find((motion) => motion.id === motionGroup)?.pivot
    const motionGeometry = pivot
      ? geometry.clone().translate(-pivot[0], -pivot[1], -pivot[2])
      : undefined
    motionGeometry?.computeBoundingBox()
    motionGeometry?.computeBoundingSphere()
    batches.push({
      slot,
      motionGroup: motionGroup ?? undefined,
      geometry,
      motionGeometry,
      ranges: entry.ranges,
    })
  }
  const milliseconds = performance.now() - start
  proceduralMetrics.builds++
  proceduralMetrics.lastBuildMs = milliseconds
  return {
    batches,
    evaluation,
    milliseconds,
    triangles: batches.reduce((n, b) => n + b.geometry.getAttribute('position').count / 3, 0),
  }
}
export function acquireProceduralGeometry(node: ProceduralItemNode) {
  const key = geometrySignature(node)
  let entry = cache.get(key)
  if (entry) proceduralMetrics.cacheHits++
  else {
    entry = { value: buildProceduralGeometry(node), users: 0 }
    cache.set(key, entry)
  }
  entry.users++
  proceduralMetrics.liveEntries = cache.size
  let released = false
  return {
    value: entry.value,
    release: () => {
      if (released) return
      released = true
      const current = cache.get(key)
      if (current && --current.users === 0) {
        for (const batch of current.value.batches) {
          batch.geometry.dispose()
          batch.motionGeometry?.dispose()
        }
        cache.delete(key)
      }
      proceduralMetrics.liveEntries = cache.size
    },
  }
}
export function partAtFace(ranges: Batch['ranges'], face: number) {
  return ranges.find((r) => face < r.end)?.partId ?? null
}
