import {
  type AnyNode,
  WallFeatureNode as FeatureSchema,
  getWallPlaneTop,
  getWallThickness,
  isCurvedWall,
  planWallFeaturePlacement,
  resolveWallFeaturePlacement,
  resolveWallTop,
  type SceneApi,
  supportSegmentAt,
  useLiveNodeOverrides,
  useScene,
  WALL_FEATURE_MIN_BACKING,
  type WallFeatureNode,
  type WallFeaturePlacement,
  type WallFeaturePlacementContext,
  wallSupportForNodes,
} from '@pascal-app/core'
import { deferWallFeatureGeometry } from './runtime'

type Nodes = Readonly<Record<string, AnyNode>>
export type WallFeatureHit = {
  wallId: string
  face: 'a' | 'b'
  u: number
  elevation: number
  bumpId?: string
  context?: WallFeaturePlacementContext
}
export type WallFeatureSnap = {
  gridStep?: number
  magnetic?: boolean
  force?: boolean
  vertical?: boolean
}
export type WallFeatureProposal = {
  node: WallFeatureNode
  placement: WallFeaturePlacement | null
  error: string | null
}

export function createWallFeatureDraft(
  nodes: Nodes,
  hostId: string,
  mode: WallFeatureNode['mode'],
): WallFeatureNode {
  const host = nodes[hostId]
  if (host?.type !== 'wall' && host?.type !== 'wall-feature') throw Error('Select a wall or bump.')
  const parent = host.type === 'wall-feature' ? resolveWallFeaturePlacement(nodes, host) : null
  if (
    parent &&
    host.type === 'wall-feature' &&
    (host.mode !== 'bump' || mode !== 'niche' || host.parentId !== parent.wall.id)
  )
    throw Error('Only a niche inside a wall-owned bump is supported.')
  const wall = parent?.wall ?? (host as import('@pascal-app/core').WallNode)
  if (isCurvedWall(wall) || wall.wallType === 'curtain')
    throw Error('Niches and bumps require a straight, solid wall.')
  const support = wallSupportForNodes(wall, nodes)
  const width = Math.min(
    mode === 'niche' ? 0.6 : 0.9,
    parent?.node.width ?? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]),
  )
  const hostHeight =
    parent?.node.height ??
    resolveWallTop(wall, getWallPlaneTop(wall, wall.parentId ?? '', nodes), support.elevation) -
      support.elevation
  const height = Math.min(mode === 'niche' ? 0.35 : 1, hostHeight)
  const depth =
    mode === 'bump'
      ? 0.15
      : Math.min(0.1, getWallThickness(wall) + (parent?.node.depth ?? 0) - WALL_FEATURE_MIN_BACKING)
  if (depth <= 0 || width <= 0 || height <= 0)
    throw Error('The host has no usable space for this feature.')
  return FeatureSchema.parse({
    parentId: host.id,
    mode,
    face: parent ? undefined : 'a',
    width,
    height,
    depth,
    bottom: mode === 'bump' ? 0 : Math.min(1, hostHeight - height),
    metadata: { isNew: true },
  })
}

/** Pointer coordinates use the root wall frame; persisted nested u is measured from the bump's left edge. */
export function proposeWallFeature(
  nodes: Nodes,
  original: WallFeatureNode,
  hit: WallFeatureHit,
  options: WallFeatureSnap = {},
  moving = false,
): WallFeatureProposal {
  const wall = nodes[hit.wallId]
  if (wall?.type !== 'wall') return { node: original, placement: null, error: 'Wall unavailable.' }
  const bump = hit.bumpId ? nodes[hit.bumpId] : undefined
  let node: WallFeatureNode = original
  try {
    if (hit.bumpId && (bump?.type !== 'wall-feature' || original.mode !== 'niche'))
      throw Error('Select a bump to host this niche.')
    const host =
      bump?.type === 'wall-feature' && original.mode === 'niche'
        ? resolveWallFeaturePlacement(nodes, bump, hit.context)
        : null
    if (host && (host.wall.id !== wall.id || host.face !== hit.face))
      throw Error('The cursor must be on the selected bump face.')
    const support = hit.context?.support ?? wallSupportForNodes(wall, nodes)
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const run = support.faceDatum[hit.face].find(
      (run) => hit.u / length >= run.start && hit.u / length <= run.end,
    )
    const base = host?.bottom ?? (run ? supportSegmentAt(run, hit.u / length) : support.elevation)
    let u = hit.u - (host?.bounds.u0 ?? 0)
    let bottom =
      !moving && original.mode === 'bump' ? 0 : hit.elevation - base - original.height / 2
    if (!options.force && options.gridStep && options.gridStep > 0) {
      const step = options.gridStep
      u = Math.round((u - original.width / 2) / step) * step + original.width / 2
      if (options.vertical !== false) bottom = Math.round(bottom / step) * step
    }
    if (!options.force && options.magnetic) {
      const width = host?.node.width ?? length
      const height =
        host?.node.height ??
        resolveWallTop(
          wall,
          hit.context?.planeTop ?? getWallPlaneTop(wall, wall.parentId ?? '', nodes),
          support.elevation,
        ) - base
      const anchorsU = [0, width / 2, width],
        anchorsY = [0, height]
      for (const candidate of Object.values(nodes)) {
        if (
          candidate.type !== 'wall-feature' ||
          candidate.id === original.id ||
          candidate.parentId !== (host?.node.id ?? wall.id)
        )
          continue
        anchorsU.push(
          candidate.u - candidate.width / 2,
          candidate.u,
          candidate.u + candidate.width / 2,
        )
        anchorsY.push(candidate.bottom, candidate.bottom + candidate.height)
      }
      const snap = (value: number, offsets: number[], anchors: number[]) => {
        let best = value,
          distance = 0.1
        for (const anchor of anchors)
          for (const offset of offsets) {
            const delta = anchor - (value + offset)
            if (Math.abs(delta) < distance) {
              distance = Math.abs(delta)
              best = value + delta
            }
          }
        return best
      }
      u = snap(u, [-original.width / 2, 0, original.width / 2], anchorsU)
      if (options.vertical !== false) bottom = snap(bottom, [0, original.height], anchorsY)
    }
    if (options.vertical === false) bottom = original.bottom
    node = {
      ...original,
      parentId: host?.node.id ?? wall.id,
      face: host ? undefined : hit.face,
      u,
      bottom,
    }
    planWallFeaturePlacement(nodes, node)
    return {
      node,
      placement: resolveWallFeaturePlacement({ ...nodes, [node.id]: node }, node, hit.context),
      error: null,
    }
  } catch (error) {
    return {
      node,
      placement: null,
      error: error instanceof Error ? error.message : 'Invalid feature placement.',
    }
  }
}

const previewOwners = new Map<string, symbol>()

/** Scene writes happen only in commit; previews own only their placement override fields. */
export function createWallFeaturePlacementSession(
  original: WallFeatureNode,
  scene: SceneApi,
  moving = false,
) {
  const fields = ['parentId', 'face', 'u', 'bottom']
  let proposal: WallFeatureProposal | null = null
  let ended = false
  const owner = Symbol(original.id)
  const owns = () => previewOwners.get(original.id) === owner
  const clear = () => {
    ended = true
    if (!owns()) return
    previewOwners.delete(original.id)
    useLiveNodeOverrides.getState().clearFields(original.id, fields)
    if (moving) deferWallFeatureGeometry(original.id, false)
    ended = true
  }
  return {
    update(hit: WallFeatureHit | null, options: WallFeatureSnap = {}) {
      if (ended) return null
      previewOwners.set(original.id, owner)
      if (moving) deferWallFeatureGeometry(original.id, true)
      const live = useLiveNodeOverrides.getState().get(original.id)
      const source =
        options.vertical === false && typeof live?.bottom === 'number'
          ? { ...original, bottom: live.bottom }
          : original
      proposal = hit ? proposeWallFeature(scene.nodes(), source, hit, options, moving) : null
      if (proposal?.placement) {
        const { parentId, face, u, bottom } = proposal.node
        useLiveNodeOverrides.getState().set(original.id, { parentId, face, u, bottom })
      } else useLiveNodeOverrides.getState().clearFields(original.id, fields)
      return proposal
    },
    getProposal: () => proposal,
    ownsPreview: owns,
    commit() {
      if (ended || !owns() || !proposal?.placement) return null
      if (useScene.getState().readOnly) {
        clear()
        return null
      }
      const current = scene.get(original.id)
      if (moving && current?.type !== 'wall-feature') {
        clear()
        return null
      }
      const node = moving
        ? ({
            ...current,
            ...Object.fromEntries(
              fields.map((key) => [key, proposal!.node[key as keyof WallFeatureNode]]),
            ),
          } as WallFeatureNode)
        : proposal.node
      try {
        planWallFeaturePlacement(scene.nodes(), node)
      } catch (error) {
        clear()
        throw error
      }
      if (moving)
        scene.update(node.id, {
          parentId: node.parentId,
          face: node.face,
          u: node.u,
          bottom: node.bottom,
        })
      else {
        const { isNew: _new, isTransient: _transient, ...metadata } = node.metadata
        scene.upsert({ ...node, metadata }, node.parentId as Parameters<SceneApi['upsert']>[1])
      }
      clear()
      return node.id
    },
    cancel: clear,
  }
}
