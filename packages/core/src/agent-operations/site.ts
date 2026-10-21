import { refuse } from '../agent-tools/refusal'
import { isSiteFlatwork } from '../lib/site-flatwork'
import {
  describeSiteBrief,
  placeBuildingPose,
  roundedSiteBrief,
  type SiteFootprint,
  siteBrief,
  type YardKey,
} from '../lib/site-placement'
import { targetBuilding } from './add-level'
import { pointInPolygon, type Vec2 } from './plan-geometry'
import { queryNodes } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

type SiteInput = { building?: string; site?: string }
type PlaceBuildingInput = {
  building?: string
  outline?: number[][]
  yards?: Partial<Record<YardKey, number>>
  rotationDeg?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100 || 0

/**
 * `get_site`: the site a building stands on, in its level coordinates; a lot no building stands
 * on yet, in site coordinates.
 */
export const getSite: AgentOperation<SiteInput> = (nodes, input, context) => {
  if (input.site) {
    const site = nodes[input.site]
    if (!site) refuse('site_not_found', `Site not found: ${input.site}.`, { siteId: input.site })
    if (site.type !== 'site')
      refuse('not_a_site', `Node ${input.site} is a ${site.type}, not a site.`, {
        siteId: input.site,
        type: site.type,
      })
  }
  const anyBuilding = queryNodes(nodes, { type: 'building' }).length > 0
  const building =
    input.building || (anyBuilding && !input.site)
      ? targetBuilding(nodes, input.building, context)
      : null
  // a site named alone is read for the building viewed when it stands there
  const brief = siteBrief(
    nodes,
    building ? { buildingId: building.id } : { siteId: input.site, levelId: context.activeLevelId },
  )
  if (!brief) refuse('no_site', 'The scene has no site with a lot: add_level starts one.')
  if (input.site && brief.siteId !== input.site)
    refuse(
      'building_not_on_site',
      `${building?.id} stands on ${brief.siteId}, not on ${input.site}: name one or the other.`,
      { buildingId: building?.id, siteId: input.site },
    )
  return { result: { ...roundedSiteBrief(brief), summary: describeSiteBrief(brief) } }
}

function footprintFacts(footprint: SiteFootprint) {
  const b = footprint.bounds
  return {
    footprint: {
      size: [r2(b.maxX - b.minX), r2(b.maxZ - b.minZ)],
      bounds: { minX: r2(b.minX), minZ: r2(b.minZ), maxX: r2(b.maxX), maxZ: r2(b.maxZ) },
      centre: [r2(footprint.centre[0]), r2(footprint.centre[1])],
    },
    yards: Object.fromEntries(
      Object.entries(footprint.yards).map(([key, m]) => [key, m == null ? null : r2(m)]),
    ),
    fit: footprint.fit,
    overhang: {
      lotM: r2(footprint.overhang.lotM),
      setbacksM: r2(footprint.overhang.setbacksM),
      sides: footprint.overhang.sides,
    },
  }
}

/**
 * What stands on the building's levels outside its footprint and moves with it: fences, paths and
 * the floor items out of doors (a plant cannot be told from a patio chair, so all of them).
 */
function outdoorOnLevels(nodes: SceneNodes, buildingId: string, rings: readonly Vec2[][]) {
  const building = nodes[buildingId]
  const levels = new Set<string>(building?.type === 'building' ? building.children : [])
  const outside = (x: number, z: number) =>
    !rings.some((ring) => pointInPolygon([x, z], ring as Vec2[]))
  const moved: { id: string; type: string; name?: string }[] = []
  for (const node of queryNodes(nodes, { type: ['fence', 'slab', 'item'] })) {
    if (!(node.parentId && levels.has(node.parentId))) continue
    const flatwork = node.type === 'slab' && isSiteFlatwork(node)
    const outdoorItem =
      node.type === 'item' && outside(node.position[0] ?? 0, node.position[2] ?? 0)
    if (node.type === 'fence' || flatwork || outdoorItem)
      moved.push({ id: node.id, type: node.type, ...(node.name ? { name: node.name } : {}) })
  }
  return moved
}

/** `place_building`: stand a building on its site by its pose, its walls untouched. */
export const placeBuilding: AgentOperation<PlaceBuildingInput> = (nodes, input, context) => {
  const building = targetBuilding(nodes, input.building, context)
  const placed = placeBuildingPose(nodes, {
    buildingId: building.id,
    ...(input.outline
      ? { outline: input.outline.map((p) => [p[0] ?? 0, p[1] ?? 0] as const) }
      : {}),
    ...(input.yards ? { yards: input.yards } : {}),
    ...(input.rotationDeg === undefined ? {} : { rotationDeg: input.rotationDeg }),
  })
  if (!placed.ok) refuse(placed.code, placed.message, { buildingId: building.id })
  const facts = footprintFacts(placed.footprint)
  const rotationDeg = Math.round(((placed.rotation[1] * 180) / Math.PI) * 10) / 10 || 0
  const [x, , z] = placed.position
  const movedWithIt = placed.moved
    ? outdoorOnLevels(nodes, building.id, placed.footprint.rings)
    : []
  const where = `${describeSiteBrief({ ...placed.brief, footprint: placed.footprint }).at(-1)}.`
  const message = [
    placed.moved
      ? `${building.name ?? 'The building'} now stands at site [${r2(x)}, ${r2(z)}], ${rotationDeg}°. Its walls keep their level coordinates; draw new ones in the same frame.`
      : `${building.name ?? 'The building'} already stands there: nothing moved.`,
    where,
    placed.brief.placeholder
      ? 'The lot is the new-project placeholder: say so, and ask for the address or the site plan.'
      : '',
    movedWithIt.length
      ? `${movedWithIt.length} outdoor node(s) on its levels moved with it (fences, paths, plants, outdoor furniture): re-trace them to the lot.`
      : '',
  ].filter(Boolean)
  return {
    result: {
      ok: true,
      buildingId: building.id,
      position: placed.position.map(r2),
      rotationDeg,
      moved: placed.moved,
      ...facts,
      ...(movedWithIt.length ? { movedWithIt: movedWithIt.slice(0, 24) } : {}),
      message: message.join(' '),
    },
    ...(placed.moved
      ? {
          changes: {
            update: [
              { id: building.id, data: { position: placed.position, rotation: placed.rotation } },
            ],
          },
        }
      : {}),
  }
}
