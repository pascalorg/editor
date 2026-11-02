import type { BriefRoom, DesignBrief, RoomDressing } from '../../agent-tools/design-brief'
import type { SessionRecord } from '../scene-checkpoint'
import type { AgentToolCase } from './cases'
import { BEDROOM_AXES } from './design-brief-cases'
import { massedScene, rect } from './design-form-cases'

/**
 * The dressing a brief announces for a room, and a later brief of the turn against the first: a
 * finding where a later brief announces a kind of wall dressing the first announced for that room
 * and no longer does, none where it announces the same or more.
 */

const house = () => massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' })

const SALON = (dressing?: RoomDressing[]): BriefRoom => ({
  name: 'Salon',
  use: 'living',
  distinct: 'The family room, warm and panelled.',
  finishes: {
    floor: 'oak',
    walls: 'white paint',
    tiled: false,
    skirting: false,
    ...(dressing ? { dressing } : {}),
  },
  pieces: ['sofa'],
})

export const dressingBrief = (...rooms: BriefRoom[]): DesignBrief => ({
  axes: BEDROOM_AXES,
  source: 'open',
  vision: 'A house.',
  beyond: 'none: the test reads the walls.',
  rooms,
})
export const salonBrief = (dressing?: RoomDressing[]) => dressingBrief(SALON(dressing))

const keeping = (
  designBrief: DesignBrief,
  firstDressing?: SessionRecord['firstDressing'],
): AgentToolCase['context'] => ({
  designBrief,
  session: (): SessionRecord => ({
    checkpoints: {},
    made: [],
    designBrief,
    ...(firstDressing ? { firstDressing } : {}),
  }),
})

const REVISED = { type: 'room_dressing_revised_simpler', severity: 'warning' }

export const DESIGN_DRESSING_CASES: AgentToolCase[] = [
  {
    name: 'the dressing revised to less within the turn: a finding says what the brief no longer announces',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(salonBrief(['wainscot']), { salon: ['wainscot', 'chairRail', 'crown'] }),
    expect: {
      result: {},
      contains: { issues: [REVISED] },
      mentions: [
        "The rooms' dressing was revised during the turn; the brief no longer announces Salon: a chair rail and a crown moulding.",
      ],
    },
  },
  {
    name: 'the dressing revised to the same or to more: no revision finding',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(salonBrief(['wainscot', 'chairRail', 'crown', 'splashback']), {
      salon: ['wainscot', 'chairRail'],
    }),
    expect: { result: {}, lacks: { issues: [REVISED] } },
  },
]
