import type { DesignBrief } from '../../agent-tools/design-brief'
import type { MadeEntry, SessionRecord } from '../scene-checkpoint'
import type { AgentToolCase } from './cases'
import { HOUSE_ROOMS, OPEN_AXES } from './design-brief-cases'
import { massedScene, rect } from './design-form-cases'

/**
 * What a brief leaves unstated while the turn built: a form bounded by words that fix no plan, and
 * a brief that lists no rooms for a building of many. A finding at the
 * end of the turn, for a turn that made zones or levels since the brief, never a refusal.
 */

const house = () => massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' })

const bounded = (quote: string, reading: string) => ({
  kind: 'bounded' as const,
  quote,
  reading,
})

/** "Construis-moi une grande maison": the form and the facade bounded by words that state no plan and no treatment. */
const GRANDE_MAISON: DesignBrief = {
  axes: {
    ...OPEN_AXES,
    form: bounded('grande maison', 'a large house'),
    facade: bounded('grande maison', 'a large house'),
  },
  source: 'open',
  vision: 'A large house.',
  beyond: 'none: the test reads the brief.',
}

export const zone = (id: string): MadeEntry => ({ id, type: 'zone', levelId: 'level_0' })
const lamp: MadeEntry = { id: 'item_lamp', type: 'item', levelId: 'level_0' }

/** The session of a turn: what the thread made before the brief, the brief, what was made under it. */
export const underBrief = (
  designBrief: DesignBrief,
  before: MadeEntry[],
  under: MadeEntry[],
): SessionRecord => ({
  checkpoints: {},
  made: [...before, ...under],
  designBrief,
  briefMadeAt: before.length,
})

const keeping = (session: SessionRecord): AgentToolCase['context'] => ({
  designBrief: session.designBrief,
  session: () => session,
})

const FORM = { type: 'form_bounded_without_plan', severity: 'warning' }
const ROOMS = { type: 'rooms_not_listed', severity: 'warning' }

export const BRIEF_GAP_CASES: AgentToolCase[] = [
  {
    name: 'a form bounded by "grande maison" while the turn built a rectangle: the finding names the words and what was built',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(underBrief(GRANDE_MAISON, [], [zone('zone_House_0')])),
    expect: {
      result: { hasIssues: true },
      contains: {
        issues: [
          {
            ...FORM,
            message:
              'The brief bounds the form by "grande maison", words that fix no plan; the scene has 1 volume (rectangle).',
          },
        ],
      },
    },
  },
  {
    name: 'a turn that made no zone or level, a lamp, says nothing of the form: the cheap statement holds',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(underBrief(GRANDE_MAISON, [], [lamp])),
    expect: { result: {}, lacks: { issues: [FORM, ROOMS] } },
  },
  {
    name: 'what the thread built before the brief is not the turn’s: no finding',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(underBrief(GRANDE_MAISON, [zone('zone_House_0'), zone('zone_Study_0')], [lamp])),
    expect: { result: {}, lacks: { issues: [FORM, ROOMS] } },
  },
  {
    name: 'a session record with no marker (before it existed) cannot tell the turn: no finding',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping({
      checkpoints: {},
      made: [zone('zone_House_0'), zone('zone_Study_0')],
      designBrief: GRANDE_MAISON,
    }),
    expect: { result: {}, lacks: { issues: [FORM, ROOMS] } },
  },
  {
    name: 'three rooms built under a brief that lists none: the finding counts them',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(
      underBrief(GRANDE_MAISON, [], [zone('zone_a'), zone('zone_b'), zone('zone_c')]),
    ),
    expect: {
      result: {},
      contains: { issues: [ROOMS] },
      mentions: ['The brief lists no rooms; the turn built 3 rooms.'],
    },
  },
  {
    name: 'one room built, or the rooms listed: no rooms finding',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(
      underBrief({ ...GRANDE_MAISON, rooms: HOUSE_ROOMS }, [], [zone('zone_a'), zone('zone_b')]),
    ),
    expect: { result: {}, lacks: { issues: [ROOMS] } },
  },
  {
    name: 'a form that states its plan is compared and not reported as unstated',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(
      underBrief(
        {
          ...GRANDE_MAISON,
          axes: {
            ...GRANDE_MAISON.axes,
            form: { ...bounded('grande maison', 'a large house'), massing: { plan: 'rectangle' } },
          },
        },
        [],
        [zone('zone_House_0')],
      ),
    ),
    expect: { result: {}, lacks: { issues: [FORM] } },
  },
]
