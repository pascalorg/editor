import type { DesignBrief, Massing } from '../../agent-tools/design-brief'
import { BuildingNode, LevelNode, SiteNode, ZoneNode } from '../../schema'
import type { SessionRecord } from '../scene-checkpoint'
import type { AgentToolCase, SceneGraph } from './cases'
import { BEDROOM_AXES, LAMP_AXES, openForm } from './design-brief-cases'

/**
 * The form a brief states, read back against the volumes the scene has: a finding where the scene
 * is plainer than the brief, none where it holds up what is stated or the brief states no massing.
 * Scenes are rooms tagged with the volume they belong to (or untagged, as create_room leaves them), one
 * level per storey, each 3 m tall, on the editor's scaffold: a site and a building.
 */

type Pt = [number, number]
type Part = {
  name: string
  polygon: Pt[]
  /** Tagged with the volume the room belongs to; left out, the room is untagged and read as inferred. */
  shape?: string
  /** Storeys counted from `from`, 1 by default. */
  storeys?: number
  /** The first storey it stands on, 0 by default: -1 is a basement. */
  from?: number
}

export const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Pt[] => [
  [minX, minZ],
  [maxX, minZ],
  [maxX, maxZ],
  [minX, maxZ],
]

export function massedScene(...parts: Part[]): SceneGraph {
  const storeys = parts.flatMap((part) =>
    Array.from({ length: part.storeys ?? 1 }, (_, s) => (part.from ?? 0) + s),
  )
  const levelIds = Array.from(new Set(storeys)).sort((a, b) => a - b)
  const levels = levelIds.map((index) =>
    LevelNode.parse({
      id: `level_${index}`,
      parentId: 'building_a',
      level: index,
      height: 3,
      children: [],
    }),
  )
  const zones = parts.flatMap((part) =>
    Array.from({ length: part.storeys ?? 1 }, (_, s) => {
      const index = (part.from ?? 0) + s
      return ZoneNode.parse({
        id: `zone_${part.name}_${index}`,
        parentId: `level_${index}`,
        name: part.name,
        polygon: part.polygon,
        ...(part.shape
          ? {
              metadata: {
                volume: {
                  id: `volume_${part.name}`,
                  name: part.name,
                  shape: part.shape,
                  storeyIndex: s,
                  partIndex: 0,
                },
              },
            }
          : {}),
      })
    }),
  )
  const site = SiteNode.parse({ id: 'site_a', children: ['building_a'] })
  // Storeys below the ground floor push the stack down: the ground floor stands at the site's grade.
  const building = BuildingNode.parse({
    id: 'building_a',
    parentId: 'site_a',
    position: [0, 3 * Math.min(0, ...levelIds), 0],
    children: levels.map((level) => level.id),
  })
  const nodes = Object.fromEntries(
    [site, building, ...levels, ...zones].map((node) => [node.id, node]),
  )
  for (const level of levels)
    (nodes[level.id] as { children: string[] }).children = zones
      .filter((zone) => zone.parentId === level.id)
      .map((zone) => zone.id)
  return { nodes, rootNodeIds: [building.id] }
}

/** The brief of "Construis-moi un manoir", its form stated: a U of three volumes at two heights. */
const brief = (massing: Massing | undefined): DesignBrief => ({
  axes: {
    ...BEDROOM_AXES,
    form: massing
      ? openForm('a central body with two wings stepping forward, the wings lower', massing)
      : BEDROOM_AXES.form,
  },
  source: 'open',
  vision: 'A manor around its forecourt.',
  beyond: 'none: the test reads the form.',
})

const U_OF_THREE: Massing = { plan: 'u', volumes: 3, heights: 'several' }

/** The U as the brief states it: a two-storey body across the back, a one-storey wing at each end. */
export const U_BUILT = massedScene(
  { name: 'Body', polygon: rect(0, 0, 12, 4), shape: 'rectangle', storeys: 2 },
  { name: 'West wing', polygon: rect(0, 4, 3, 9), shape: 'rectangle' },
  { name: 'East wing', polygon: rect(9, 4, 12, 9), shape: 'rectangle' },
)

/** The same house as two rectangles, an L at one height. */
export const TWO_RECTANGLES = massedScene(
  { name: 'Body', polygon: rect(0, 0, 12, 4), shape: 'rectangle' },
  { name: 'West wing', polygon: rect(0, 4, 3, 9), shape: 'rectangle' },
)

/** The brief in force on every surface: the session's, and the one the host passes where it gates. */
const keeping = (designBrief: DesignBrief, firstMassing?: Massing): AgentToolCase['context'] => ({
  designBrief,
  session: (): SessionRecord => ({
    checkpoints: {},
    made: [],
    designBrief,
    ...(firstMassing ? { firstMassing } : {}),
  }),
})

const FINDING = { type: 'form_simpler_than_brief', severity: 'warning' }
const REVISED = { type: 'form_revised_simpler', severity: 'warning' }
const RECTANGLE: Massing = { plan: 'rectangle', volumes: 1, heights: 'one' }

export const DESIGN_FORM_CASES: AgentToolCase[] = [
  {
    name: 'two rectangle volumes against a U of three at different heights: one finding naming both sides',
    tool: 'verify_scene',
    scene: () => TWO_RECTANGLES,
    input: {},
    context: keeping(brief(U_OF_THREE)),
    expect: {
      result: { hasIssues: true },
      contains: { issues: [FINDING] },
      mentions: [
        'The brief states a form of a U, 3 volumes, at different heights; the scene has 2 volumes (rectangle, rectangle), a plan with 1 re-entrant corner, one height (3.0 m).',
      ],
    },
  },
  {
    name: 'the finding says what is missing, on which building, and which read lists it',
    tool: 'verify_scene',
    scene: () => TWO_RECTANGLES,
    input: {},
    context: keeping(brief(U_OF_THREE)),
    expect: {
      result: { hasIssues: true },
      mentions: [
        'Compared on building building_a: volumes: 3 stated, 2 built (Body (rectangle, top 3.0 m), West wing (rectangle, top 3.0 m)), 1 missing; plan: a U needs 2 re-entrant corners or a court, the footprints have 1 re-entrant corner; heights: several stated, every volume tops out at 3.0 m.',
      ],
    },
  },
  {
    name: 'a U of three volumes at two heights, as the brief states it: no finding',
    tool: 'verify_scene',
    scene: () => U_BUILT,
    input: {},
    context: keeping(brief(U_OF_THREE)),
    expect: { result: {}, lacks: { issues: [FINDING] } },
  },
  {
    name: 'a form stated with no massing (a focused edit bounds it by its words): no finding on any scene',
    tool: 'verify_scene',
    scene: () => TWO_RECTANGLES,
    input: {},
    context: keeping({
      axes: LAMP_AXES,
      source: 'open',
      vision: 'One lamp.',
      beyond: 'none: one lamp.',
    }),
    expect: { result: {}, lacks: { issues: [FINDING] } },
  },
  {
    name: 'a U of three revised to a rectangle within the turn: a finding says so, though the scene matches the later brief',
    tool: 'verify_scene',
    scene: () => massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' }),
    input: {},
    context: keeping(brief(RECTANGLE), U_OF_THREE),
    expect: {
      result: { hasIssues: true },
      contains: { issues: [REVISED] },
      lacks: { issues: [FINDING] },
      mentions: [
        'The form was revised during the turn: from a U, 3 volumes, at different heights to a rectangle, 1 volume.',
      ],
    },
  },
  {
    name: 'a form revised to a richer one, or left as it was: no revision finding',
    tool: 'verify_scene',
    scene: () => U_BUILT,
    input: {},
    context: keeping(brief(U_OF_THREE), RECTANGLE),
    expect: { result: {}, lacks: { issues: [REVISED] } },
  },
  {
    name: 'a form stated once and not revised: no revision finding',
    tool: 'verify_scene',
    scene: () => U_BUILT,
    input: {},
    context: keeping(brief(U_OF_THREE), U_OF_THREE),
    expect: { result: {}, lacks: { issues: [REVISED] } },
  },
  {
    name: 'a brief stored before the form axis existed: no finding, no throw',
    tool: 'verify_scene',
    scene: () => TWO_RECTANGLES,
    input: {},
    context: keeping({
      axes: { ...BEDROOM_AXES, form: undefined },
      source: 'open',
      vision: 'A bedroom.',
      beyond: 'none: older brief.',
    }),
    expect: { result: {}, lacks: { issues: [FINDING] } },
  },
]

/** A scene, the massing the brief states, and what differs (none: no finding). */
export const FORM_ROWS: {
  name: string
  scene: SceneGraph
  massing: Massing | undefined
  differs: string[]
}[] = [
  {
    name: 'one box against a U of one volume',
    scene: massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' }),
    massing: { plan: 'u', volumes: 1, heights: 'one' },
    differs: ['plan'],
  },
  {
    name: 'an L built as one letter volume against an L',
    scene: massedScene({
      name: 'House',
      shape: 'l',
      polygon: [
        [0, 0],
        [12, 0],
        [12, 4],
        [3, 4],
        [3, 9],
        [0, 9],
      ],
    }),
    massing: { plan: 'l', volumes: 1, heights: 'one' },
    differs: [],
  },
  {
    name: 'an L of untagged rooms against an L: the outline is read, not the tags',
    scene: massedScene(
      { name: 'Hall', polygon: rect(0, 0, 12, 4) },
      { name: 'Study', polygon: rect(0, 4, 3, 9) },
    ),
    massing: { plan: 'l', volumes: 1, heights: 'one' },
    differs: [],
  },
  {
    name: 'a U built as a U against a courtyard',
    scene: U_BUILT,
    massing: { plan: 'courtyard', volumes: 3, heights: 'several' },
    differs: ['plan'],
  },
  {
    name: 'a court closed on four sides against a U: the court holds up what the U leaves open',
    scene: massedScene(
      { name: 'North', polygon: rect(0, 0, 12, 3), shape: 'courtyard' },
      { name: 'South', polygon: rect(0, 9, 12, 12), shape: 'courtyard' },
      { name: 'West', polygon: rect(0, 3, 3, 9), shape: 'courtyard' },
      { name: 'East', polygon: rect(9, 3, 12, 9), shape: 'courtyard' },
    ),
    massing: { plan: 'u', volumes: 4, heights: 'one' },
    differs: [],
  },
  {
    name: 'volumes that touch against detached volumes',
    scene: TWO_RECTANGLES,
    massing: { plan: 'detached', volumes: 2, heights: 'one' },
    differs: ['plan'],
  },
  {
    name: 'volumes that stand apart against detached volumes',
    scene: massedScene(
      { name: 'House', polygon: rect(0, 0, 10, 6), shape: 'rectangle' },
      { name: 'Pavilion', polygon: rect(14, 0, 18, 6), shape: 'rectangle' },
    ),
    massing: { plan: 'detached', volumes: 2, heights: 'one' },
    differs: [],
  },
  {
    name: 'one height against several',
    scene: massedScene(
      { name: 'Body', polygon: rect(0, 0, 10, 6), shape: 'rectangle' },
      { name: 'Wing', polygon: rect(10, 0, 14, 6), shape: 'rectangle' },
    ),
    massing: { plan: 'rectangle', volumes: 2, heights: 'several' },
    differs: ['heights'],
  },
  {
    name: 'a taller body and a lower wing against several heights',
    scene: massedScene(
      { name: 'Body', polygon: rect(0, 0, 10, 6), shape: 'rectangle', storeys: 2 },
      { name: 'Wing', polygon: rect(10, 0, 14, 6), shape: 'rectangle' },
    ),
    massing: { plan: 'rectangle', volumes: 2, heights: 'several' },
    differs: [],
  },
  {
    name: 'more volumes than the brief states are not simpler',
    scene: U_BUILT,
    massing: { plan: 'rectangle', volumes: 1, heights: 'one' },
    differs: [],
  },
  {
    name: 'a basement under the whole plan does not fill the notch of a U or count as a volume',
    scene: massedScene(
      { name: 'Body', polygon: rect(0, 0, 12, 4), shape: 'rectangle' },
      { name: 'West wing', polygon: rect(0, 4, 3, 9), shape: 'rectangle' },
      { name: 'East wing', polygon: rect(9, 4, 12, 9), shape: 'rectangle' },
      { name: 'Cellar', polygon: rect(0, 0, 12, 9), shape: 'rectangle', from: -1 },
    ),
    massing: { plan: 'u', volumes: 3, heights: 'one' },
    differs: [],
  },
  {
    name: 'a scene with no building above grade has nothing to compare',
    scene: massedScene({ name: 'Cellar', polygon: rect(0, 0, 12, 9), shape: 'rectangle', from: -1 }),
    massing: { plan: 'u', volumes: 3, heights: 'several' },
    differs: [],
  },
  {
    name: 'a form that states only the plan its words fix, "an L-shaped house", built as a box',
    scene: massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' }),
    massing: { plan: 'l' },
    differs: ['plan'],
  },
  {
    name: 'no massing stated',
    scene: TWO_RECTANGLES,
    massing: undefined,
    differs: [],
  },
]

export const formBrief = brief

/** A form stated first, the one a later brief of the turn states, and what the later one asks less of. */
export const REVISION_ROWS: {
  name: string
  first: Massing | undefined
  latest: Massing | undefined
  differs: string[]
}[] = [
  {
    name: 'a U of three at different heights revised to a rectangle of one',
    first: U_OF_THREE,
    latest: RECTANGLE,
    differs: ['volumes', 'plan', 'heights'],
  },
  {
    name: 'three volumes revised to two',
    first: { plan: 'u', volumes: 3, heights: 'one' },
    latest: { plan: 'u', volumes: 2, heights: 'one' },
    differs: ['volumes'],
  },
  {
    name: 'a letter plan revised to a plainer one',
    first: { plan: 'h', volumes: 3, heights: 'one' },
    latest: { plan: 'l', volumes: 3, heights: 'one' },
    differs: ['plan'],
  },
  {
    name: 'a court revised to a letter',
    first: { plan: 'courtyard', volumes: 4, heights: 'one' },
    latest: { plan: 'u', volumes: 4, heights: 'one' },
    differs: ['plan'],
  },
  {
    name: 'several heights revised to one',
    first: U_OF_THREE,
    latest: { ...U_OF_THREE, heights: 'one' },
    differs: ['heights'],
  },
  {
    name: 'a form revised to a richer one',
    first: RECTANGLE,
    latest: U_OF_THREE,
    differs: [],
  },
  {
    name: 'a form restated as it was',
    first: U_OF_THREE,
    latest: U_OF_THREE,
    differs: [],
  },
  {
    name: 'a plan of the same rank, a U for a T',
    first: { plan: 'u', volumes: 3, heights: 'one' },
    latest: { plan: 't', volumes: 3, heights: 'one' },
    differs: [],
  },
  {
    name: 'a later brief that states no massing has nothing to compare',
    first: U_OF_THREE,
    latest: undefined,
    differs: [],
  },
  {
    name: 'no first massing',
    first: undefined,
    latest: RECTANGLE,
    differs: [],
  },
]
