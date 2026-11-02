import type { DesignBrief, FormPlan, Massing } from '../agent-tools/design-brief'
import { type Ring, union } from '../lib/polygon-boolean'
import type { AnyNode, AnyNodeId } from '../schema'
import { isLevelBelowGrade } from '../services/storey'
import { type MassingBuilding, readMassing } from './massing-read'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * The form a brief states against the volumes the scene has. The brief's `form` axis states a
 * massing (a plan shape, a number of volumes, one height or several); this reads the building
 * back through the volumes its rooms form and their footprints, and reports a finding only
 * where the scene is plainer than the brief says. It never refuses a write, and a form that
 * states no massing is not compared.
 */

/** Tops of volumes within this (m) stand at one height. */
const SAME_HEIGHT = 0.3
/** A turn of less than this (sine of the angle) is a straight run, not a corner. */
const STRAIGHT = 0.0175
/** An edge within this many degrees of the building's own axes is not angled. */
const ANGLED_DEGREES = 1

/** What the footprints of the above-grade rooms, seen from above, make of the plan. */
type PlanFacts = {
  /** Separate masses: footprints that share no edge. */
  components: number
  /** Corners of the outlines, straight runs not counted. */
  corners: number
  /** Re-entrant corners of the outlines: 1 for an L, 2 for a U or a T, 4 for an H. */
  reflex: number
  /** Open courts: holes in the footprints' union. */
  holes: number
  /** An outline edge that runs at an angle to the others. */
  angled: boolean
}

const PLAN_WORDS: Record<FormPlan, string> = {
  rectangle: 'a rectangle',
  l: 'an L',
  u: 'a U',
  t: 'a T',
  h: 'an H',
  courtyard: 'rooms around an open court',
  wing: 'a wing at an angle',
  bay: 'a bay with corners cut at 45°',
  polygon: 'a free outline',
  detached: 'volumes standing apart',
}

/**
 * What each plan needs of the built footprints at least: a rectangle nothing; the letters their
 * re-entrant corners (or a court, which closes what they leave open); a court its hole; a wing or
 * a bay an edge at an angle; a free outline anything but one plain rectangle; detached two masses.
 */
const PLAN_MET: Record<FormPlan, (plan: PlanFacts) => boolean> = {
  rectangle: () => true,
  l: (plan) => plan.reflex >= 1 || plan.holes >= 1,
  t: (plan) => plan.reflex >= 2 || plan.holes >= 1,
  u: (plan) => plan.reflex >= 2 || plan.holes >= 1,
  h: (plan) => plan.reflex >= 4 || plan.holes >= 1,
  courtyard: (plan) => plan.holes >= 1,
  wing: (plan) => plan.angled,
  bay: (plan) => plan.angled,
  polygon: (plan) => plan.corners > 4 || plan.angled || plan.components > 1,
  detached: (plan) => plan.components >= 2,
}

/** What `PLAN_MET` asks of the footprints, in words: how a finding says what the built plan lacks. */
const PLAN_NEEDS: Record<FormPlan, string> = {
  rectangle: 'nothing',
  l: 'a re-entrant corner or a court',
  t: '2 re-entrant corners or a court',
  u: '2 re-entrant corners or a court',
  h: '4 re-entrant corners or a court',
  courtyard: 'an open court',
  wing: 'an edge at an angle',
  bay: 'an edge at an angle',
  polygon: 'more than 4 corners, an angled edge or separate masses',
  detached: '2 separate masses',
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** A stated massing in words: "a U, 3 volumes, at different heights". */
const statedWords = (massing: Massing) =>
  [
    massing.plan ? PLAN_WORDS[massing.plan] : null,
    massing.volumes !== undefined ? plural(massing.volumes, 'volume') : null,
    massing.heights === 'several' ? 'at different heights' : null,
  ]
    .filter(Boolean)
    .join(', ')

/** How much a plan asks of the scene, for telling a revised form plainer: the letters by their notches, a court the most. */
const PLAN_RANK: Record<FormPlan, number> = {
  rectangle: 0,
  bay: 1,
  wing: 1,
  polygon: 1,
  detached: 1,
  l: 2,
  t: 3,
  u: 3,
  h: 4,
  courtyard: 4,
}

const unit = ([x, z]: readonly [number, number], [nx, nz]: readonly [number, number]) => {
  const length = Math.hypot(nx - x, nz - z) || 1
  return [(nx - x) / length, (nz - z) / length] as const
}

/** The shoelace sum: positive when the ring runs one way round, negative the other. */
const winding = (ring: Ring) =>
  ring.reduce((sum, [x, z], i) => {
    const [nx, nz] = ring[(i + 1) % ring.length]!
    return sum + (x * nz - nx * z)
  }, 0)

function planFacts(footprints: Ring[]): PlanFacts {
  const shapes = union(footprints)
  const rings = shapes.map((shape) => shape.outer)
  let corners = 0
  let reflex = 0
  let longest = { length: 0, angle: 0 }
  const angles: number[] = []
  for (const ring of rings) {
    const sign = Math.sign(winding(ring))
    ring.forEach((point, i) => {
      const before = ring[(i + ring.length - 1) % ring.length]!
      const after = ring[(i + 1) % ring.length]!
      const [ax, az] = unit(before, point)
      const [bx, bz] = unit(point, after)
      const turn = ax * bz - az * bx
      if (Math.abs(turn) <= STRAIGHT) return
      corners++
      if (Math.sign(turn) !== sign) reflex++
    })
    ring.forEach(([x, z], i) => {
      const [nx, nz] = ring[(i + 1) % ring.length]!
      const length = Math.hypot(nx - x, nz - z)
      const angle = (Math.atan2(nz - z, nx - x) * 180) / Math.PI
      angles.push(angle)
      if (length > longest.length) longest = { length, angle }
    })
  }
  const angled = angles.some((angle) => {
    const off = (((angle - longest.angle) % 90) + 90) % 90
    return Math.min(off, 90 - off) > ANGLED_DEGREES
  })
  return {
    components: rings.length,
    corners,
    reflex,
    holes: shapes.reduce((sum, shape) => sum + shape.holes.length, 0),
    angled,
  }
}

export type BuiltForm = {
  /** The building read: the one with the most floor above grade. */
  buildingId: string
  volumes: number
  shapes: string[]
  /** The volumes the building's rooms form, each with its shape and top. */
  named: { name: string; shape: string; topM: number }[]
  plan: PlanFacts
  /** Highest and lowest top of a volume in the building's stack (m). */
  tops: [number, number]
}

/** The building the brief is read against: the one with the most floor above grade, its above-grade volumes. */
export function builtForm(nodes: SceneNodes): BuiltForm | null {
  const above = (building: MassingBuilding) =>
    building.volumes.flatMap((volume) => {
      const storeys = volume.storeyFootprints.filter(
        (storey) => !isLevelBelowGrade(nodes as Record<AnyNodeId, AnyNode>, storey.levelId),
      )
      return storeys.length ? [{ volume, storeys }] : []
    })
  const footprint = (volumes: ReturnType<typeof above>) =>
    volumes.flatMap(({ storeys }) =>
      storeys.flatMap((storey) =>
        storey.zoneIds.flatMap((id) => {
          const zone = nodes[id]
          return zone?.type === 'zone' ? [zone.polygon as Ring] : []
        }),
      ),
    )
  const [main] = readMassing(nodes)
    .map((building) => {
      const volumes = above(building)
      return {
        buildingId: building.buildingId,
        volumes,
        footprints: footprint(volumes),
        ground: volumes.reduce(
          (sum, { storeys }) =>
            sum + storeys.reduce((total, storey) => total + storey.areaSqMeters, 0),
          0,
        ),
      }
    })
    .filter(({ footprints }) => footprints.length > 0)
    .sort((a, b) => b.ground - a.ground)
  if (!main) return null
  const tops = main.volumes.map(({ volume }) => volume.topElevationMeters)
  return {
    buildingId: main.buildingId,
    volumes: main.volumes.length,
    shapes: main.volumes.map(({ volume }) => volume.shape ?? 'inferred'),
    named: main.volumes.map(({ volume }) => ({
      name: String(volume.name),
      shape: volume.shape ?? 'inferred',
      topM: volume.topElevationMeters,
    })),
    plan: planFacts(main.footprints),
    tops: [Math.max(...tops), Math.min(...tops)],
  }
}

const planWords = (plan: PlanFacts) =>
  [
    plan.reflex ? plural(plan.reflex, 're-entrant corner') : 'no re-entrant corner',
    ...(plan.holes ? [plural(plan.holes, 'court')] : []),
    ...(plan.angled ? ['edges at an angle'] : []),
    ...(plan.components > 1 ? [`${plan.components} separate masses`] : []),
  ].join(', ')

/** A scene the massing cannot be read from (a room stored without its polygon) says nothing here: verify_scene lists what is wrong with it. */
function readable<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

/**
 * The building the brief is read against: the one with the most floor above grade, else the first
 * building the scene has. The facade is read on it as the form is.
 */
export function mainBuildingId(nodes: SceneNodes): string | undefined {
  return (
    readable(() => builtForm(nodes))?.buildingId ?? queryNodes(nodes, { type: 'building' })[0]?.id
  )
}

export type FormFinding = {
  code: 'form_simpler_than_brief'
  message: string
  /** What differs: volumes, plan, heights. */
  differs: ('volumes' | 'plan' | 'heights')[]
}

/**
 * The finding where the built form is plainer than the brief's stated massing: fewer volumes,
 * a plan that lacks what the stated plan needs, one height where several are stated. Null when
 * the brief states no massing, nothing above grade is built, or the scene holds up what is stated.
 */
export function formFinding(
  brief: Pick<DesignBrief, 'axes'> | null | undefined,
  nodes: SceneNodes,
): FormFinding | null {
  const stated: Massing | undefined = brief?.axes?.form?.massing
  if (!stated) return null
  const built = readable(() => builtForm(nodes))
  if (!built) return null
  const differs: FormFinding['differs'] = []
  if (stated.volumes !== undefined && built.volumes < stated.volumes) differs.push('volumes')
  if (stated.plan !== undefined && !PLAN_MET[stated.plan](built.plan)) differs.push('plan')
  const spread = built.tops[0] - built.tops[1]
  if (stated.heights === 'several' && spread <= SAME_HEIGHT) differs.push('heights')
  if (!differs.length) return null
  const has = [
    `${plural(built.volumes, 'volume')} (${built.shapes.join(', ')})`,
    `a plan with ${planWords(built.plan)}`,
    spread <= SAME_HEIGHT
      ? `one height (${built.tops[0].toFixed(1)} m)`
      : `heights from ${built.tops[1].toFixed(1)} to ${built.tops[0].toFixed(1)} m`,
  ].join(', ')
  const lacking = differs.map((axis) => lackWords(axis, stated, built)).join('; ')
  return {
    code: 'form_simpler_than_brief',
    message: `The brief states a form of ${statedWords(stated)}; the scene has ${has}. Compared on building ${built.buildingId}: ${lacking}. Either the scene or the brief's form changes: a new design_brief replaces the form.`,
    differs,
  }
}

/** One differing axis as stated against built, with the numbers and the volumes that stand. */
function lackWords(
  axis: FormFinding['differs'][number],
  stated: Massing,
  built: BuiltForm,
): string {
  if (axis === 'volumes') {
    const standing = built.named
      .map(({ name, shape, topM }) => `${name} (${shape}, top ${topM.toFixed(1)} m)`)
      .join(', ')
    const missing = (stated.volumes ?? 0) - built.volumes
    return `volumes: ${stated.volumes} stated, ${built.volumes} built (${standing}), ${missing} missing`
  }
  if (axis === 'plan' && stated.plan)
    return `plan: ${PLAN_WORDS[stated.plan]} needs ${PLAN_NEEDS[stated.plan]}, the footprints have ${planWords(built.plan)}`
  return `heights: several stated, every volume tops out at ${built.tops[0].toFixed(1)} m`
}

export type FormRevision = {
  code: 'form_revised_simpler'
  message: string
  /** What the later form asks less of: volumes, plan, heights. */
  differs: ('volumes' | 'plan' | 'heights')[]
}

/**
 * The finding where a later brief of the turn states a plainer massing than the first one did:
 * fewer volumes, a plan lower on the ladder (a letter, a court or an angle for a rectangle), one
 * height for several. A brief is free to revise, so this is a fact to show, not a refusal. Null
 * when either brief states no massing (a form bounded by the person's words has none to compare),
 * or the later one asks as much.
 */
export function formRevision(
  first: Massing | undefined,
  brief: Pick<DesignBrief, 'axes'> | null | undefined,
): FormRevision | null {
  const latest: Massing | undefined = brief?.axes?.form?.massing
  if (!(first && latest)) return null
  const differs: FormRevision['differs'] = []
  if (first.volumes !== undefined && latest.volumes !== undefined && latest.volumes < first.volumes)
    differs.push('volumes')
  if (first.plan && latest.plan && PLAN_RANK[latest.plan] < PLAN_RANK[first.plan])
    differs.push('plan')
  if (first.heights === 'several' && latest.heights === 'one') differs.push('heights')
  if (!differs.length) return null
  return {
    code: 'form_revised_simpler',
    message: `The form was revised during the turn: from ${statedWords(first)} to ${statedWords(latest)}.`,
    differs,
  }
}
