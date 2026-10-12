import type { SlabFeaturePlacement } from '@pascal-app/core'
import {
  ADDITION,
  Brush,
  csgGeometry,
  Evaluator,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three'

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal', 'uv', 'uv2']
evaluator.useGroups = false
const EPSILON = 0.001

/** Owns the slab body; feature solids are emitted only as part of that body. */
export function buildSlabFeatureBody(
  body: BufferGeometry,
  placements: readonly SlabFeaturePlacement[],
) {
  if (!placements.length) return { body, features: new Map<string, BufferGeometry>() }
  const ordered = [...placements].sort((a, b) =>
    a.node.mode === b.node.mode
      ? a.node.id.localeCompare(b.node.id)
      : a.node.mode === 'bump'
        ? -1
        : 1,
  )
  const priority = [...ordered].reverse()
  let result = new Brush(body)
  prepareBrushForCSG(result)
  try {
    for (const p of ordered) {
      const start = p.mount + (p.node.mode === 'bump' ? -EPSILON : EPSILON)
      const box = new BoxGeometry(p.node.width, Math.abs(p.surface - start), p.node.length)
      box.translate(p.x, (p.surface + start) / 2, p.z)
      const brush = new Brush(box)
      try {
        prepareBrushForCSG(brush)
        const next = evaluator.evaluate(
          result,
          brush,
          p.node.mode === 'bump' ? ADDITION : SUBTRACTION,
        )
        csgGeometry(result).dispose()
        result = next
      } finally {
        box.dispose()
      }
    }
    const merged = csgGeometry(result)
    const source = merged.index ? merged.toNonIndexed() : merged
    const position = source.getAttribute('position')
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < position.count; i += 3) {
      const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3
      const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3
      const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
      const owner =
        priority.find(
          ({ bounds: b }) =>
            x >= b.x0 - EPSILON &&
            x <= b.x1 + EPSILON &&
            z >= b.z0 - EPSILON &&
            z <= b.z1 + EPSILON &&
            y >= b.y0 - EPSILON &&
            y <= b.y1 + EPSILON,
        )?.node.id ?? ''
      let indices = buckets.get(owner)
      if (!indices) {
        indices = []
        buckets.set(owner, indices)
      }
      indices.push(i, i + 1, i + 2)
    }
    const extract = (indices: number[]) => {
      const geometry = new BufferGeometry()
      for (const [name, attr] of Object.entries(source.attributes)) {
        const array = new Float32Array(indices.length * attr.itemSize)
        for (let i = 0; i < indices.length; i++)
          for (let c = 0; c < attr.itemSize; c++)
            array[i * attr.itemSize + c] = attr.getComponent(indices[i]!, c)
        geometry.setAttribute(name, new BufferAttribute(array, attr.itemSize))
      }
      // CSG box UVs are unit-scaled. Reproject every face in metre coordinates.
      const pos = geometry.getAttribute('position'),
        normal = geometry.getAttribute('normal')
      const uv = new Float32Array(pos.count * 2)
      for (let i = 0; i < pos.count; i++) {
        const ax = Math.abs(normal.getX(i)),
          ay = Math.abs(normal.getY(i)),
          az = Math.abs(normal.getZ(i))
        uv[i * 2] = ay >= ax && ay >= az ? pos.getX(i) : ax > az ? pos.getZ(i) : pos.getX(i)
        uv[i * 2 + 1] = ay >= ax && ay >= az ? pos.getZ(i) : pos.getY(i)
      }
      geometry.setAttribute('uv', new BufferAttribute(uv, 2))
      geometry.setAttribute('uv2', new BufferAttribute(uv.slice(), 2))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      return geometry
    }
    const host = extract(buckets.get('') ?? [])
    const features = new Map(
      [...buckets].filter(([id]) => id).map(([id, indices]) => [id, extract(indices)]),
    )
    if (source !== merged) source.dispose()
    merged.dispose()
    return { body: host, features }
  } catch (error) {
    csgGeometry(result).dispose()
    throw error
  }
}
