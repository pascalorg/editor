import { liftedManualSlab } from '../lib/floor-construction-lift'
import { withHostedCutterHoles } from '../lib/object-cuts'
import { computePlateSurfacePartition, plateLevelContext } from '../lib/plate-surface'
import { area, intersection } from '../lib/polygon-boolean'
import { getRenderableSlabPolygon, slabPolygonContextForLevel } from '../lib/slab-polygon'
import type { AnyNode, SlabFeatureNode, SlabNode } from '../schema'

export class SlabFeatureValidationError extends Error {
  readonly code = 'slab_feature_invalid_placement'
  override readonly name = 'SlabFeatureValidationError'
}

export const MIN_SLAB_FEATURE_BACKING = 0.02
export type SlabFeaturePlacement = {
  node: SlabFeatureNode
  slab: SlabNode
  x: number
  z: number
  mount: number
  surface: number
  bounds: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }
}
type Nodes = Readonly<Record<string, AnyNode>>

export function resolveSlabFeaturePlacement(
  nodes: Nodes,
  node: SlabFeatureNode,
  resolvedSlab?: SlabNode,
): SlabFeaturePlacement {
  const parent = nodes[node.parentId ?? '']
  let slab: SlabNode,
    x = node.x,
    z = node.z,
    mount: number
  if (parent?.type === 'slab') {
    slab =
      resolvedSlab ??
      (parent.plateRole || parent.autoFromWalls ? parent : liftedManualSlab(nodes, parent))
    x += slab.polygon[0]?.[0] ?? 0
    z += slab.polygon[0]?.[1] ?? 0
    mount = slab.elevation
  } else if (
    parent?.type === 'slab-feature' &&
    parent.mode === 'bump' &&
    nodes[parent.parentId ?? '']?.type === 'slab' &&
    node.mode === 'niche'
  ) {
    const host = resolveSlabFeaturePlacement(nodes, parent, resolvedSlab)
    slab = host.slab
    x += host.x
    z += host.z
    mount = host.surface
  } else throw new SlabFeatureValidationError('Select a solid slab, or add a niche to a slab bump.')
  if (slab.recessed)
    throw new SlabFeatureValidationError(
      'Features require a solid slab; pool shells are not supported.',
    )
  const surface = mount + (node.mode === 'bump' ? 1 : -1) * node.depth
  return {
    node,
    slab,
    x,
    z,
    mount,
    surface,
    bounds: {
      x0: x - node.width / 2,
      x1: x + node.width / 2,
      z0: z - node.length / 2,
      z1: z + node.length / 2,
      y0: Math.min(mount, surface),
      y1: Math.max(mount, surface),
    },
  }
}

export function slabFeatureFootprint(p: SlabFeaturePlacement): [number, number][] {
  const b = p.bounds
  return [
    [b.x0, b.z0],
    [b.x1, b.z0],
    [b.x1, b.z1],
    [b.x0, b.z1],
  ]
}

function validate(nodes: Nodes, node: SlabFeatureNode, resolvedSlab?: SlabNode) {
  if (
    ![node.x, node.z, node.width, node.length, node.depth].every(Number.isFinite) ||
    Math.min(node.width, node.length, node.depth) <= 0
  )
    throw new SlabFeatureValidationError('Feature dimensions must be finite and greater than zero.')
  const p = resolveSlabFeaturePlacement(nodes, node, resolvedSlab)
  const context = slabPolygonContextForLevel(
    nodes[p.slab.parentId ?? ''] ?? null,
    (id) => nodes[id],
  )
  const polygon = getRenderableSlabPolygon(p.slab, context)
  const footprint = slabFeatureFootprint(p)
  const localNodes: Record<string, AnyNode> = { [p.slab.id]: p.slab }
  const level = nodes[p.slab.parentId ?? '']
  if (level) localNodes[level.id] = level
  for (const id of [
    ...(p.slab.children ?? []),
    ...(level && 'children' in level ? level.children : []),
  ])
    if (nodes[id]) localNodes[id] = nodes[id]!
  const slab = withHostedCutterHoles(p.slab, localNodes)
  const covered = area(
    intersection({ outer: polygon, holes: slab.holes }, { outer: footprint, holes: [] }),
  )
  if (node.width * node.length - covered > 1e-7)
    throw new SlabFeatureValidationError(
      'The entire feature must fit inside the slab and clear its openings.',
    )
  if (p.slab.boundary === 'auto') {
    const partition = computePlateSurfacePartition(
      p.slab,
      plateLevelContext(level ?? null, (id) => nodes[id]),
    )
    if (partition && area(intersection(partition.masked, footprint)) > 1e-7)
      throw new SlabFeatureValidationError(
        'Place the feature on the slab that owns the visible top surface.',
      )
  }
  const parent = nodes[node.parentId ?? '']
  if (parent?.type === 'slab-feature') {
    const host = resolveSlabFeaturePlacement(nodes, parent, resolvedSlab)
    if (
      p.bounds.x0 < host.bounds.x0 - 1e-7 ||
      p.bounds.x1 > host.bounds.x1 + 1e-7 ||
      p.bounds.z0 < host.bounds.z0 - 1e-7 ||
      p.bounds.z1 > host.bounds.z1 + 1e-7
    )
      throw new SlabFeatureValidationError('A nested niche must fit inside its bump.')
  }
  if (node.mode === 'niche') {
    const available = p.slab.thickness + (parent?.type === 'slab-feature' ? parent.depth : 0)
    if (node.depth > available - MIN_SLAB_FEATURE_BACKING + 1e-7)
      throw new SlabFeatureValidationError('A niche must leave at least 0.02 m of slab backing.')
  }
  return p
}

export function validateSlabFeatures(nodes: Nodes, slabId?: string, resolvedSlab?: SlabNode): void {
  const candidates: SlabFeatureNode[] = []
  if (slabId) {
    const slab = nodes[slabId]
    if (slab?.type !== 'slab') return
    const pending = [...(slab.children ?? [])]
    const seen = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const child = nodes[id]
      if (child?.type !== 'slab-feature') continue
      candidates.push(child)
      pending.push(...child.children)
    }
  } else
    for (const node of Object.values(nodes)) if (node.type === 'slab-feature') candidates.push(node)
  const slab = slabId ? nodes[slabId] : undefined
  const resolved =
    resolvedSlab ?? (slab?.type === 'slab' ? liftedManualSlab(nodes, slab) : undefined)
  const placements = candidates.map((n) => validate(nodes, n, resolved))
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!,
        b = placements[j]!
      if (a.slab.id !== b.slab.id || a.node.parentId === b.node.id || b.node.parentId === a.node.id)
        continue
      const overlap =
        Math.min(a.bounds.x1, b.bounds.x1) - Math.max(a.bounds.x0, b.bounds.x0) > 1e-7 &&
        Math.min(a.bounds.z1, b.bounds.z1) - Math.max(a.bounds.z0, b.bounds.z0) > 1e-7
      if (!overlap) continue
      throw new SlabFeatureValidationError(
        'Slab features may not overlap unless a niche is nested in a bump.',
      )
    }
}

export function planSlabFeaturePlacement(
  nodes: Nodes,
  node: SlabFeatureNode,
): SlabFeaturePlacement {
  const placement = resolveSlabFeaturePlacement(nodes, node)
  const parent = nodes[node.parentId ?? '']
  const host =
    parent && 'children' in parent
      ? ({ ...parent, children: [...new Set([...parent.children, node.id])] } as AnyNode)
      : parent
  // Validation reads only this host tree; unrelated scene nodes remain untouched.
  const next = new Proxy(nodes, {
    get: (target, key, receiver) =>
      key === node.id ? node : key === parent?.id ? host : Reflect.get(target, key, receiver),
  })
  const p = validate(next, node, placement.slab)
  validateSlabFeatures(next, p.slab.id, placement.slab)
  return p
}
