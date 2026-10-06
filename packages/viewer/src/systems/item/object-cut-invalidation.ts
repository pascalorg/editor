import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveCutterNode,
  resolveCutterHost,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'

/** Geometry remains derived; only dirty marks cross into the scene store. */
export function initializeObjectCutInvalidation() {
  let previous = new Map<string, string>()
  let cutterIds: AnyNodeId[] = []
  const collect = (nodes: Record<AnyNodeId, AnyNode>) => {
    cutterIds = []
    for (const node of Object.values(nodes)) {
      if (node.type === 'item' && node.source?.manifest.cutters?.length) cutterIds.push(node.id)
    }
  }
  // Drags fire every frame: a scene without cutters pays nothing here.
  const refresh = () => {
    if (!cutterIds.length && !previous.size) return
    const state = useScene.getState()
    const nodes: Record<string, AnyNode> = { ...state.nodes }
    for (const id of new Set([
      ...useLiveNodeOverrides.getState().overrides.keys(),
      ...useLiveTransforms.getState().transforms.keys(),
    ])) {
      if (nodes[id]) nodes[id] = getEffectiveCutterNode(nodes[id]!)
    }
    const owners = new Map<string, unknown[]>()
    for (const id of cutterIds) {
      const node = nodes[id]
      if (node?.type !== 'item' || !node.source?.manifest.cutters?.length) continue
      for (const cutter of node.source.manifest.cutters) {
        const host = resolveCutterHost(
          node,
          cutter.host === 'mounted' ? 'cutout' : `cut:${cutter.host}`,
          nodes,
        )
        if (!host) continue
        const entries = owners.get(host.id) ?? []
        entries.push([node.id, node.source.artifact, node.position, node.rotation, node.scale])
        owners.set(host.id, entries)
      }
    }
    const next = new Map([...owners].map(([id, entries]) => [id, JSON.stringify(entries)]))
    const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(
      (id) => previous.get(id) !== next.get(id),
    )
    previous = next
    for (const id of changed) if (nodes[id]) state.markDirty(id as AnyNodeId)
  }
  collect(useScene.getState().nodes)
  refresh()
  const unsubscribeScene = useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    collect(state.nodes)
    refresh()
  })
  const unsubscribeLive = useLiveNodeOverrides.subscribe((state, before) => {
    if (state.overrides !== before.overrides) refresh()
  })
  const unsubscribeTransforms = useLiveTransforms.subscribe((state, before) => {
    if (state.transforms !== before.transforms) refresh()
  })
  return () => {
    unsubscribeScene()
    unsubscribeLive()
    unsubscribeTransforms()
  }
}
