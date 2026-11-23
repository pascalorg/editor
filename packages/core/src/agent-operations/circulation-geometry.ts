import { resolveLevelId } from '../lib/node-ancestry'
import { area, containsPoint, intersection } from '../lib/polygon-boolean'
import { buildCirculationGraph, type CirculationGraph } from './circulation-graph'
import { spaceRegion } from './circulation-spaces'
import type { SceneNodes } from './types'

export type CirculationGeometryReason = {
  code: string
  message: string
  nodeIds: string[]
}

type AddReason = (code: string, ...ids: string[]) => void

function floorReasons(scene: SceneNodes, graph: CirculationGraph, add: AddReason) {
  for (const floor of graph.floors) {
    for (const slab of floor.slabs) {
      const source = scene[slab.id]
      if (source?.type !== 'slab') continue
      // An open-supported floor outside the enclosed footprint on the ground is outdoor ground.
      if (source.support === 'open') {
        if (!slab.outdoor) add('open_supported_floors', slab.id)
      } else if (
        !slab.outdoor &&
        Math.abs(slab.elevation - floor.elevation) > 1e-6 &&
        (!floor.interior.length ||
          area(intersection({ outer: slab.polygon, holes: slab.holes }, floor.interior)) > 1e-6)
      )
        add('split_interior_floors', slab.id)
    }
    for (const zone of floor.zones) {
      const source = scene[zone.id]
      if (source?.type !== 'zone') continue
      if (zone.outdoor) {
        const regions = floor.pockets.flatMap((pocket) =>
          intersection({ outer: zone.polygon, holes: zone.holes }, pocket.polygon),
        )
        if (regions.length > 1) add('divided_outdoor_spaces', zone.id)
      }
      if (source.floor?.support === 'open' && !zone.outdoor) add('open_supported_floors', zone.id)
      else if (zone.outdoor) continue
      else if (source.hasFloor === false)
        add(floor.ground ? 'floorless_interior_spaces' : 'floorless_upper_spaces', zone.id)
      else if (
        source.floor?.elevation !== undefined &&
        Math.abs(floor.groundElevation + source.floor.elevation - floor.elevation) > 1e-6
      )
        add('split_interior_floors', zone.id)
    }
  }
}

function geometryGroups(scene: SceneNodes, graph: CirculationGraph) {
  const groups = new Map<string, Set<string>>()
  const add = (code: string, ...ids: string[]) => {
    const group = groups.get(code) ?? new Set<string>()
    for (const id of ids) group.add(id)
    groups.set(code, group)
  }
  const buildings = Object.values(scene).filter((node) => node.type === 'building')
  if (buildings.length > 1) add('multiple_buildings', ...buildings.map((node) => node.id))
  for (const node of buildings)
    if (Math.abs(node.rotation[0]) > 1e-8 || Math.abs(node.rotation[2]) > 1e-8)
      add('tilted_buildings', node.id)
  floorReasons(scene, graph, add)
  if (!graph.floors.some((floor) => floor.slabs.length)) {
    const inhabited = graph.floors.filter((floor) => floor.zones.length || floor.pockets.length)
    if (inhabited.length) add('floor_missing', ...inhabited.map((floor) => floor.id))
  }
  for (const node of Object.values(scene)) {
    if (node.type !== 'stair') continue
    const host = scene[node.supportSlabId ?? '']
    const floor = graph.floors.find(
      (candidate) => candidate.id === (node.fromLevelId ?? resolveLevelId(node, scene)),
    )
    const surface = floor?.slabs.find((slab) => slab.id === host?.id)
    const raisedHost =
      host?.type === 'slab' &&
      (host.support === 'open' ||
        (surface &&
          !surface.outdoor &&
          Math.abs(surface.elevation - (floor?.elevation ?? 0)) > 1e-6))
    const measuredEntrySteps =
      graph.entranceFlights.has(node.id) ||
      (floor?.ground &&
        !node.toLevelId &&
        graph.edges.some((edge) => edge.kind === 'stair' && edge.sourceId === node.id))
    if (!measuredEntrySteps && (node.deckSlabId || Math.abs(node.position[1]) > 1e-6 || raisedHost))
      add('deck_stairs', node.id)
  }
  for (const id of graph.unsupportedIds) {
    const node = scene[id]
    add(
      node?.type === 'stair'
        ? 'incomplete_stairs'
        : node?.type === 'door'
          ? 'unhosted_doors'
          : 'disconnected_surfaces',
      id,
    )
  }
  return groups
}

const REASONS: Record<string, (count: number) => string> = {
  multiple_buildings: (n) => `${n} buildings have separate circulation frames`,
  tilted_buildings: (n) =>
    `${n} tilted building${n === 1 ? ' has' : 's have'} non-horizontal walking planes`,
  split_interior_floors: (n) =>
    `${n} interior floor element${n === 1 ? ' has a different walking height' : 's have different walking heights'} on the same level`,
  open_supported_floors: (n) =>
    `${n} open-supported floor element${n === 1 ? ' forms' : 's form'} stacked walking planes`,
  floorless_upper_spaces: (n) =>
    `${n} upper-level space${n === 1 ? ' has' : 's have'} no walking floor`,
  floorless_interior_spaces: (n) =>
    `${n} interior space${n === 1 ? ' has' : 's have'} no walking floor`,
  deck_stairs: (n) =>
    `${n} stair or deck connection${n === 1 ? '' : 's'} cannot be measured between their walking surfaces`,
  incomplete_stairs: (n) =>
    `${n} stair${n === 1 ? ' has' : 's have'} an incomplete walking path or a missing destination floor`,
  unhosted_doors: (n) => `${n} door${n === 1 ? ' has' : 's have'} no wall host`,
  disconnected_surfaces: (n) =>
    `${n} floor surface${n === 1 ? ' is' : 's are'} split into disconnected walking regions`,
  floor_missing: (n) => `${n} inhabited level${n === 1 ? ' has' : 's have'} no floor slabs`,
  divided_outdoor_spaces: (n) =>
    `${n} outdoor space${n === 1 ? ' spans' : 's span'} disconnected or wall-separated walking regions`,
}

/** The same named measurement limits for the Flow note and agent diagnostics. */
export function circulationGeometryReasons(
  scene: SceneNodes,
  graph: CirculationGraph = buildCirculationGraph(scene),
): CirculationGeometryReason[] {
  return [...geometryGroups(scene, graph)].map(([code, ids]) => {
    const nodeIds = [...ids]
    return {
      code,
      nodeIds,
      message: `${REASONS[code]?.(nodeIds.length) ?? `${nodeIds.length} unsupported elements`}: ${nodeIds
        .map((id) => scene[id]?.name ?? `Unnamed ${scene[id]?.type ?? 'element'}`)
        .join(', ')}.`,
    }
  })
}

/** Losing a route while excluding geometry is missing coverage, not proof of disconnection. */
export function unmeasuredRouteIds(
  rawReachable: Iterable<string>,
  measuredReachable: Iterable<string>,
): Set<string> {
  const measured = new Set(measuredReachable)
  return new Set([...rawReachable].filter((id) => !measured.has(id)))
}

/** Exclude uncertain spaces and connectors, not unrelated measured routes. */
export function measuredCirculationGraph(
  scene: SceneNodes,
  graph: CirculationGraph,
  reasons: CirculationGeometryReason[],
): CirculationGraph {
  const unsupported = new Set(reasons.flatMap((reason) => reason.nodeIds))
  const surfaces = [...unsupported].flatMap((id) => {
    const node = scene[id]
    return node?.type === 'slab' || node?.type === 'zone' ? [node] : []
  })
  const nodes = new Map(
    [...graph.nodes].filter(([, node]) => {
      if (node.sourceId && unsupported.has(node.sourceId)) return false
      return !surfaces.some((surface) => {
        if (resolveLevelId(surface, scene) !== node.levelId) return false
        const region = spaceRegion(scene, graph, node)
        if (region)
          return (
            area(intersection(region, { outer: surface.polygon, holes: surface.holes ?? [] })) >
            1e-6
          )
        return containsPoint(
          [{ outer: surface.polygon, holes: surface.holes ?? [] }],
          [node.position[0], node.position[2]],
        )
      })
    }),
  )
  const edges = graph.edges.filter(
    (edge) =>
      nodes.has(edge.from) &&
      nodes.has(edge.to) &&
      (!edge.sourceId || !unsupported.has(edge.sourceId)),
  )
  return {
    ...graph,
    nodes,
    edges,
  }
}
