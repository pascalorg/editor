import {
  type Evaluation,
  evaluateRecipe,
  type ProceduralItemNode,
} from '@pascal-app/core/procedural-items'
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
export type Batch = {
  slot: string
  geometry: BufferGeometry
  ranges: { end: number; partId: string; shapeId: string }[]
}
export type BuiltItem = {
  batches: Batch[]
  evaluation: Evaluation
  milliseconds: number
  triangles: number
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
          ? new CylinderGeometry(0.5, 0.5, 1, 24, 1)
          : new BoxGeometry(w, h, d)
    if (shape.primitive === 'cylinder') source.scale(w, h, d)
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
    const entry = bySlot.get(shape.slot) ?? { geometries: [], ranges: [], faces: 0 }
    entry.geometries.push(geometry)
    entry.faces += geometry.getAttribute('position').count / 3
    entry.ranges.push({ end: entry.faces, partId: shape.partId, shapeId: shape.id })
    bySlot.set(shape.slot, entry)
  }
  const batches: Batch[] = []
  for (const [slot, entry] of bySlot) {
    const geometry = mergeGeometries(entry.geometries, false)
    for (const g of entry.geometries) g.dispose()
    if (!geometry) throw new Error('Unable to batch procedural geometry')
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    batches.push({ slot, geometry, ranges: entry.ranges })
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
        for (const batch of current.value.batches) batch.geometry.dispose()
        cache.delete(key)
      }
      proceduralMetrics.liveEntries = cache.size
    },
  }
}
export function partAtFace(ranges: Batch['ranges'], face: number) {
  return ranges.find((r) => face < r.end)?.partId ?? null
}
