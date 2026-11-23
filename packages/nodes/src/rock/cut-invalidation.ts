import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  effectiveBuilding,
  effectiveRock,
  getEffectiveNode,
  getLevelElevations,
  type LevelNode,
  type RockNode,
  useLiveNodeOverrides,
  useLiveTerrain,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'

type Nodes = Record<string, AnyNode>

function buildingsOn(siteId: string, nodes: Nodes): BuildingNode[] {
  return Object.values(nodes).filter(
    (node): node is BuildingNode => node.type === 'building' && node.parentId === siteId,
  )
}

/**
 * What a Site's rocks and floors depend on, as it is on screen now: its rocks (mid-gesture
 * included), the ground, where each building stands and how high each of its levels is.
 * Anything that changes it changes a rock's mesh or a floor's holes.
 */
function signatureOf(siteId: string, rocks: RockNode[], nodes: Nodes): string {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const siteBuildings = buildingsOn(siteId, nodes)
  const buildingIds = new Set(siteBuildings.map((building) => building.id))
  const levelIds = new Set<string>(siteBuildings.flatMap((building) => building.children))
  for (const node of Object.values(nodes))
    if (
      node.type === 'level' &&
      node.parentId &&
      buildingIds.has(node.parentId as BuildingNode['id'])
    )
      levelIds.add(node.id)
  const buildings = siteBuildings.map((stored) => {
    const building = effectiveBuilding(stored)
    return [
      building.id,
      building.position,
      building.rotation,
      building.children.map((id) => [id, elevations.get(id as LevelNode['id'])?.baseY]),
    ]
  })
  const shapes = rocks.map((stored) => {
    const rock = effectiveRock(stored)
    return [
      rock.id,
      rock.polygon,
      rock.height,
      rock.seed,
      rock.form,
      rock.rockType,
      rock.weathering,
      rock.visible,
    ]
  })
  // Main's slab plane is construction-dependent: a footprint can lift a manual slab,
  // and lower-storey footprints/room zones can move the storey above. Include the
  // same-Site inputs, not just authored level heights or the slab being rebuilt.
  // These are input snapshots only; no derived cut or dirty flag feeds the signature.
  const construction = Object.values(nodes)
    .filter(
      (node) =>
        node.parentId &&
        levelIds.has(node.parentId) &&
        (node.type === 'slab' ||
          node.type === 'zone' ||
          node.type === 'wall' ||
          node.type === 'separator' ||
          node.type === 'ceiling'),
    )
    .map((node) => getEffectiveNode(node))
  return JSON.stringify([
    shapes,
    (nodes[siteId] as { terrain?: unknown } | undefined)?.terrain,
    buildings,
    construction,
  ])
}

function rocksBySite(nodes: Nodes): Map<string, RockNode[]> {
  const bySite = new Map<string, RockNode[]>()
  for (const node of Object.values(nodes))
    if (node.type === 'rock' && node.parentId)
      bySite.set(node.parentId, [...(bySite.get(node.parentId) ?? []), node])
  return bySite
}

/** The slabs of the buildings on a Site: what a rock cuts. */
function slabsOnSite(siteId: string, nodes: Nodes): AnyNodeId[] {
  const levelIds = new Set<string>(
    buildingsOn(siteId, nodes).flatMap((building) => building.children),
  )
  return Object.values(nodes)
    .filter((node) => node.type === 'slab' && node.parentId && levelIds.has(node.parentId))
    .map((slab) => slab.id)
}

/**
 * A floor's holes are derived from the rocks that pass through it, and a rock's mesh from the
 * ground under it, so both must be rebuilt when a rock, the ground or the building moves, in the
 * store and in a gesture still in flight. Only dirty marks cross into the store.
 */
export function initializeRockCutInvalidation(): () => void {
  let previous = new Map<string, string>()
  const refresh = (terrainMoved: boolean) => {
    const { nodes, markDirty } = useScene.getState()
    const bySite = rocksBySite(nodes)
    if (!bySite.size && !previous.size) return
    const next = new Map(
      [...bySite].map(([siteId, rocks]) => [siteId, signatureOf(siteId, rocks, nodes)]),
    )
    const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(
      (siteId) => terrainMoved || previous.get(siteId) !== next.get(siteId),
    )
    previous = next
    for (const siteId of changed) {
      for (const rock of bySite.get(siteId) ?? []) markDirty(rock.id)
      for (const slabId of slabsOnSite(siteId, nodes)) markDirty(slabId)
    }
  }
  previous = new Map(
    [...rocksBySite(useScene.getState().nodes)].map(([siteId, rocks]) => [
      siteId,
      signatureOf(siteId, rocks, useScene.getState().nodes),
    ]),
  )
  const unsubscribers = [
    useScene.subscribe((state, before) => {
      if (state.nodes !== before.nodes) refresh(false)
    }),
    useLiveNodeOverrides.subscribe((state, before) => {
      if (state.overrides !== before.overrides) refresh(false)
    }),
    useLiveTransforms.subscribe((state, before) => {
      if (state.transforms !== before.transforms) refresh(false)
    }),
    // A sculpt stroke is not written into the scene per dab: the rock follows the live field.
    useLiveTerrain.subscribe(() => refresh(true)),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
