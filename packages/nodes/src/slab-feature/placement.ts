import {
  type AnyNode,
  type AnyNodeId,
  planSlabFeaturePlacement,
  resolveSlabFeaturePlacement,
  type SceneApi,
  SlabFeatureNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { clearSlabFeatureEditPreview, showSlabFeatureEditPreview } from './preview'

type Nodes = Readonly<Record<string, AnyNode>>
export function createSlabFeatureDraft(
  nodes: Nodes,
  hostId: string,
  mode: SlabFeatureNode['mode'],
) {
  const host = nodes[hostId]
  if (host?.type !== 'slab' && host?.type !== 'slab-feature')
    throw Error('Select a slab or slab bump.')
  if (host.type === 'slab-feature' && (mode !== 'niche' || host.mode !== 'bump'))
    throw Error('Only a niche can be added to a bump.')
  const spanX =
    host.type === 'slab'
      ? Math.max(...host.polygon.map(([x]) => x)) - Math.min(...host.polygon.map(([x]) => x))
      : host.width
  const spanZ =
    host.type === 'slab'
      ? Math.max(...host.polygon.map(([, z]) => z)) - Math.min(...host.polygon.map(([, z]) => z))
      : host.length
  const width = Math.min(0.6, spanX * 0.6)
  const length = Math.min(0.6, spanZ * 0.6)
  const slab = host.type === 'slab' ? host : resolveSlabFeaturePlacement(nodes, host).slab
  const available = slab.thickness + (host.type === 'slab-feature' ? host.depth : 0) - 0.02
  if (slab.recessed) throw Error('Features require a solid slab.')
  if (mode === 'niche' && available <= 1e-7)
    throw Error('The slab is too thin for a niche with 0.02 m of backing.')
  return SlabFeatureNode.parse({
    parentId: hostId,
    mode,
    width,
    length,
    depth: mode === 'bump' ? 0.1 : Math.min(0.1, available * 0.5),
  })
}
export function proposeSlabFeature(
  nodes: Nodes,
  original: SlabFeatureNode,
  point: readonly [number, number],
  force = false,
) {
  const host = nodes[original.parentId ?? '']
  if (host?.type !== 'slab' && host?.type !== 'slab-feature')
    throw Error('The feature host no longer exists.')
  const origin =
    host.type === 'slab'
      ? (host.polygon[0] ?? [0, 0])
      : (() => {
          const p = resolveSlabFeaturePlacement(nodes, host)
          return [p.x, p.z]
        })()
  let x = point[0] - origin[0]!,
    z = point[1] - origin[1]!
  if (!force && isGridSnapActive()) {
    const step = useEditor.getState().gridSnapStep
    if (step > 0) {
      x = Math.round(x / step) * step
      z = Math.round(z / step) * step
    }
  }
  if (!force && isMagneticSnapActive()) {
    const candidates: [number, number][] =
      host.type === 'slab'
        ? host.polygon.map(([x, z]) => [x - origin[0]!, z - origin[1]!])
        : [[0, 0]]
    for (const [cx, cz] of candidates) {
      if (Math.abs(x - cx) < 0.08) x = cx
      if (Math.abs(z - cz) < 0.08) z = cz
    }
  }
  const node = { ...original, x, z }
  const placement = planSlabFeaturePlacement(nodes, node)
  return { node, placement }
}
const previewOwners = new Map<string, symbol>()

export function createSlabFeaturePlacementSession(
  original: SlabFeatureNode,
  scene: SceneApi,
  moving = false,
) {
  let proposal: ReturnType<typeof proposeSlabFeature> | null = null,
    ended = false
  const owner = Symbol(original.id)
  const ownsPreview = () => previewOwners.get(original.id) === owner
  const clear = () => {
    if (!ownsPreview()) return
    previewOwners.delete(original.id)
    if (usePlacementPreview.getState().node?.id === original.id)
      usePlacementPreview.getState().clear()
    useLiveNodeOverrides.getState().clearFields(original.id, ['x', 'z'])
    clearSlabFeatureEditPreview(original.id)
  }
  return {
    ownsPreview,
    update(point: readonly [number, number] | null, force = false) {
      if (ended) return null
      previewOwners.set(original.id, owner)
      if (!point) {
        proposal = null
        clear()
        return null
      }
      try {
        proposal = proposeSlabFeature(scene.nodes(), original, point, force)
        if (moving) {
          useLiveNodeOverrides
            .getState()
            .set(original.id, { x: proposal.node.x, z: proposal.node.z })
          showSlabFeatureEditPreview(proposal.node, scene)
        }
        return { ...proposal, error: null }
      } catch (err) {
        proposal = null
        clear()
        return {
          node: original,
          placement: null,
          error: err instanceof Error ? err.message : 'Invalid feature placement.',
        }
      }
    },
    commit() {
      if (ended || !ownsPreview() || !proposal) return null
      if (useScene.getState().readOnly) {
        ended = true
        clear()
        return null
      }
      try {
        const latest = moving ? scene.get(original.id) : original
        if (latest?.type !== 'slab-feature') return null
        const node = { ...latest, x: proposal.node.x, z: proposal.node.z }
        planSlabFeaturePlacement(scene.nodes(), node)
        if (moving) scene.update(node.id, { x: node.x, z: node.z })
        else scene.upsert(node, node.parentId as AnyNodeId)
        return node.id
      } finally {
        ended = true
        clear()
      }
    },
    cancel() {
      ended = true
      clear()
    },
  }
}
