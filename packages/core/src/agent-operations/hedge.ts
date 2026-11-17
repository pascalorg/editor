import { z } from 'zod'
import { addHedgeTool, HEDGE_MAX_LENGTH_M } from '../agent-tools/hedge'
import { refuse } from '../agent-tools/refusal'
import { hedgeCurrentGen } from '../lib/hedge-build'
import { type HedgeFacts, hedgeFacts } from '../lib/hedge-facts'
import { hedgeCentreline } from '../lib/hedge-line'
import { classifyEdges, outwardNormal, resolveFrontEdge } from '../lib/setback-envelope'
import { levelLocalToWorldXZ } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import { type AnyNode, type BuildingNode, HedgeNode, type SiteNode } from '../schema'
import { HEDGE_LIMITS } from '../schema/nodes/hedge-limits'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.strictObject(addHedgeTool.input)
type Input = z.output<typeof inputSchema>
type Point = [number, number]

/** Two points of a line closer than this are a slip, not a side. */
const HEDGE_MIN_SIDE = 0.1

const round = (value: number) => Math.round(value * 100) / 100
const distance = (a: Point, b: Point) =>
  Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]))

function requireSite(nodes: SceneNodes, siteId: string | undefined): SiteNode {
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (!siteId && sites.length > 1)
    refuse('ambiguous_site', 'Choose the Site that owns this hedge with siteId.')
  const site = siteId ? nodes[siteId] : sites[0]
  if (site?.type !== 'site') refuse('no_site', 'The scene has no matching Site for this hedge.')
  return site
}

function requireBuilding(
  nodes: SceneNodes,
  buildingId: string | undefined,
  site: SiteNode,
): BuildingNode | null {
  if (!buildingId) return null
  const building = nodes[buildingId]
  if (building?.type !== 'building')
    refuse('building_not_found', `Building not found: ${buildingId}.`, { buildingId })
  if (building.parentId !== site.id)
    refuse('building_site_mismatch', 'The building and hedge must belong to the same Site.', {
      buildingId,
      siteId: site.id,
    })
  return building
}

function existingHedge(nodes: SceneNodes, hedgeId: string): HedgeNode {
  const node = nodes[hedgeId]
  if (node?.type !== 'hedge') refuse('hedge_not_found', `Hedge not found: ${hedgeId}.`, { hedgeId })
  return node
}

/**
 * The lot's edges with a role as a line inside the lot: each edge moved in by `inset`, corners
 * kept where the moved edges meet. Where several stretches have the role, the longest.
 */
function lotSide(
  site: SiteNode,
  side: NonNullable<Input['boundary']>['side'],
  inset: number,
): { points: Point[]; closed: boolean } {
  const lot = (site.polygon?.points ?? []) as Point[]
  const count = lot.length
  if (count < 3)
    refuse('hedge_no_boundary', 'The Site has no lot outline: give the hedge points instead.')
  const corner = (index: number, before: number, after: number): Point => {
    const [ax, az] = outwardNormal(lot, before)
    const [bx, bz] = outwardNormal(lot, after)
    const meet = 1 + ax * bx + az * bz
    const [x, z] = lot[((index % count) + count) % count] as Point
    return meet < 0.05
      ? [x - ax * inset, z - az * inset]
      : [x - ((ax + bx) * inset) / meet, z - ((az + bz) * inset) / meet]
  }
  if (side === 'all')
    return {
      points: lot.map((_, i) => corner(i, (i - 1 + count) % count, i)),
      closed: true,
    }
  const roles = classifyEdges(
    lot,
    resolveFrontEdge(lot, site.frontEdge, site.northRotation),
    site.streetEdges,
  )
  const stretches: number[][] = []
  roles.forEach((role, edge) => {
    if (role !== side) return
    const last = stretches.at(-1)
    if (last && last.at(-1) === edge - 1) last.push(edge)
    else stretches.push([edge])
  })
  const [first, last] = [stretches[0], stretches.at(-1)]
  if (first && last && first !== last && first[0] === 0 && last.at(-1) === count - 1)
    stretches[0] = [...(stretches.pop() as number[]), ...first]
  const lengthOf = (edges: number[]) =>
    edges.reduce(
      (sum, edge) => sum + distance(lot[edge] as Point, lot[(edge + 1) % count] as Point),
      0,
    )
  const longest = stretches.sort((a, b) => lengthOf(b) - lengthOf(a))[0]
  if (!longest)
    refuse('hedge_no_boundary', `The lot has no ${side} edge: give the hedge points instead.`, {
      side,
    })
  const [start, end] = [longest[0] as number, longest.at(-1) as number]
  return {
    points: [
      corner(start, start, start),
      ...longest.slice(1).map((edge) => corner(edge, (edge - 1 + count) % count, edge)),
      corner(end + 1, end, end),
    ],
    closed: false,
  }
}

/** Refuses a line no hedge can follow, before anything is computed from it. */
function requireLine(points: Point[], closed: boolean) {
  if (points.length > HEDGE_LIMITS.maxPoints)
    refuse(
      'hedge_too_many_points',
      `The line has ${points.length} points; a hedge takes ${HEDGE_LIMITS.maxPoints}: plant it as several.`,
      { points: points.length, max: HEDGE_LIMITS.maxPoints },
    )
  const sides: [Point, Point][] = points.slice(1).map((point, i) => [points[i] as Point, point])
  if (closed && points.length > 2) sides.push([points.at(-1) as Point, points[0] as Point])
  const short = sides.find(([a, b]) => distance(a, b) < HEDGE_MIN_SIDE)
  if (short)
    refuse(
      'hedge_side_too_short',
      `The side from [${short[0]}] to [${short[1]}] is shorter than ${HEDGE_MIN_SIDE * 100} cm: drop the repeated point.`,
      { start: short[0], end: short[1] },
    )
  const length = sides.reduce((sum, [a, b]) => sum + distance(a, b), 0)
  if (length > HEDGE_MAX_LENGTH_M)
    refuse(
      'hedge_too_long',
      `The line is ${round(length)} m long; a hedge is at most ${HEDGE_MAX_LENGTH_M} m: plant it as several.`,
      { lengthM: round(length), maxM: HEDGE_MAX_LENGTH_M },
    )
}

type AskedGap = { at: Point; widthM: number; atM?: number; awayM: number }

/** Each opening's place on the line: the metres travelled to the point of the line nearest it. */
function placeGaps(
  gaps: NonNullable<Input['gaps']>,
  line: Pick<HedgeNode, 'path' | 'closed' | 'curve' | 'width'>,
  building: BuildingNode | null,
): AskedGap[] {
  const { points } = hedgeCentreline(line)
  const reach = Math.max(1.5, line.width)
  return gaps.map((gap) => {
    const [x, z] = building
      ? levelLocalToWorldXZ(building, gap.at[0] as number, gap.at[1] as number)
      : (gap.at as Point)
    let [best, bestAt, travelled] = [Number.POSITIVE_INFINITY, 0, 0]
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point]
      const span = distance(a, b)
      const t =
        span > 0
          ? Math.min(
              1,
              Math.max(
                0,
                ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (span * span),
              ),
            )
          : 0
      const away = distance([x, z], [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      if (away < best) [best, bestAt] = [away, travelled + span * t]
      travelled += span
    }
    return {
      at: [round(x), round(z)],
      widthM: gap.width,
      awayM: round(best),
      ...(best <= reach ? { atM: bestAt } : {}),
    }
  })
}

function fields(input: Input, line: { points: Point[]; closed: boolean } | null) {
  return {
    ...(line ? { path: line.points } : {}),
    ...(line?.closed || input.closed !== undefined
      ? { closed: line?.closed || (input.closed ?? false) }
      : {}),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.curve === undefined ? {} : { curve: input.curve }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.clip === undefined ? {} : { clip: input.clip }),
    ...(input.leafSize === undefined ? {} : { leafSize: input.leafSize }),
    ...(input.leafColor === undefined ? {} : { leafColor: input.leafColor }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  }
}

type GapAnswer = Partial<HedgeFacts['gaps'][number]> & {
  at?: Point
  widthM: number
  left: boolean
  why?: string
}

function response(hedge: HedgeNode, nodes: SceneNodes, asked: AskedGap[] | null) {
  const facts = hedgeFacts(hedge, { ...nodes, [hedge.id]: hedge as AnyNode })
  if (!(facts.plantedM > 0))
    refuse('hedge_all_open', 'The openings leave nothing planted: narrow them or give fewer.', {
      lengthM: facts.lengthM,
    })
  let stored = 0
  const gaps: GapAnswer[] = asked
    ? asked.map(({ at, widthM, atM, awayM }) =>
        atM === undefined
          ? {
              at,
              widthM,
              left: false,
              why: `${awayM} m from the line: an opening is given on it or within ${Math.max(1.5, hedge.width)} m of it.`,
            }
          : { at, ...(facts.gaps[stored++] as HedgeFacts['gaps'][number]) },
      )
    : facts.gaps
  return { hedgeId: hedge.id, siteId: hedge.parentId, facts: { ...facts, gaps } }
}

/** `add_hedge`: one hedge, added or changed; nothing else in the scene changes. */
export const addHedge: AgentOperation<Input> = (nodes, rawInput) => {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  const previous = input.hedgeId ? existingHedge(nodes, input.hedgeId) : null
  if (input.points && input.boundary)
    refuse('hedge_line_required', 'Give the hedge points or a boundary side, not both.')
  if (!(previous || input.points || input.boundary))
    refuse('hedge_line_required', 'Give the hedge points, or a side of the lot as boundary.')
  const parent = previous?.parentId ? nodes[previous.parentId] : undefined
  const site =
    previous && parent?.type === 'site' && !input.siteId ? parent : requireSite(nodes, input.siteId)
  if (previous && previous.parentId !== site.id)
    refuse(
      'hedge_site_mismatch',
      'An existing hedge stays on its Site; add another hedge on the other Site.',
    )
  const building = requireBuilding(nodes, input.buildingId, site)
  const width = input.width ?? previous?.width ?? HedgeNode.shape.width.parse(undefined)

  const line = input.boundary
    ? lotSide(site, input.boundary.side, input.boundary.insetM ?? width / 2)
    : input.points
      ? {
          points: (input.points as Point[]).map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
          closed: false,
        }
      : null
  const closed = line?.closed || (input.closed ?? previous?.closed ?? false)
  if (line) requireLine(line.points, closed)

  const changed = fields(input, line)
  const asked = input.gaps
    ? placeGaps(
        input.gaps,
        {
          path: (line?.points ?? previous?.path ?? []) as HedgeNode['path'],
          closed,
          curve: input.curve ?? previous?.curve ?? false,
          width,
        },
        building,
      )
    : null
  const gaps = asked
    ? {
        gaps: asked.flatMap(({ atM, widthM }) =>
          atM === undefined ? [] : [{ at: atM, width: widthM }],
        ),
      }
    : {}

  if (previous) {
    const data = { ...changed, ...gaps }
    const next = HedgeNode.parse({ ...previous, ...data })
    return {
      result: response(next, nodes, asked),
      changes: { update: [{ id: next.id, data }] },
    }
  }
  const hedge = HedgeNode.parse({
    name: 'Hedge',
    ...changed,
    ...gaps,
    gen: hedgeCurrentGen(),
    parentId: site.id,
  })
  return {
    result: response(hedge, nodes, asked),
    changes: { create: [{ node: hedge, parentId: site.id }] },
  }
}
