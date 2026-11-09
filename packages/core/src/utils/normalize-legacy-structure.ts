export function normalizeLegacyStructure(source: Record<string, unknown>): Record<string, unknown> {
  const nodes: Record<string, any> = { ...source }
  let changed = false
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.type !== 'site' || !Array.isArray(node.children)) continue
    const children = node.children.map((child: any) => {
      if (!child || typeof child !== 'object' || typeof child.id !== 'string') return child
      if (!nodes[child.id]) nodes[child.id] = { ...child, parentId: id }
      changed = true
      return child.id
    })
    if (children.some((child: unknown, index: number) => child !== node.children[index])) {
      nodes[id] = { ...node, children }
    }
  }
  for (const [id, node] of Object.entries(nodes)) {
    // Door/window normalization parses defaults before structural migration.
    // Retain absence here so old openings cannot look like newly created ones.
    if (
      (node?.type === 'door' || node?.type === 'window') &&
      node.floorThresholdVersion === undefined
    ) {
      nodes[id] = { ...node, floorThresholdVersion: 0 }
      changed = true
      continue
    }
    // Legacy documentation-only zones have no boundary. Preserve their metadata
    // as an empty generic zone instead of feeding an absent ring to topology.
    if (
      node?.type === 'zone' &&
      node.polygon === undefined &&
      (node.spaceRole === undefined || node.spaceRole === 'generic') &&
      node.autoFromWalls !== true
    ) {
      nodes[id] = {
        ...node,
        name: typeof node.name === 'string' ? node.name : 'Zone',
        polygon: [],
      }
      changed = true
      continue
    }
    if (node?.type === 'zone' && typeof node.name !== 'string') {
      nodes[id] = { ...node, name: node.spaceRole === 'room' ? 'Room' : 'Zone' }
      changed = true
      continue
    }
    if (node?.type !== 'wall' || !Object.hasOwn(node, 'assemblyLayers')) continue
    const thickness = Array.isArray(node.assemblyLayers)
      ? node.assemblyLayers.reduce(
          (total: number, layer: any) =>
            typeof layer?.thickness === 'number' &&
            Number.isFinite(layer.thickness) &&
            layer.thickness > 0
              ? total + layer.thickness
              : total,
          0,
        )
      : 0
    const { assemblyLayers: _layers, ...wall } = node
    nodes[id] = thickness > 0 ? { ...wall, thickness } : wall
    changed = true
  }
  return changed ? nodes : source
}
