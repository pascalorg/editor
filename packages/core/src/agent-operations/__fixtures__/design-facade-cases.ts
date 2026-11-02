import type { DesignBrief, Treatment } from '../../agent-tools/design-brief'
import type { SessionRecord } from '../scene-checkpoint'
import type { AgentToolCase } from './cases'
import { BEDROOM_AXES, openFacade } from './design-brief-cases'
import { massedScene, rect } from './design-form-cases'

/**
 * The facade a brief states, and a later brief of the turn against the first: a finding where a
 * later brief states a plainer treatment (fewer cladding families, bands or elements, a free
 * rhythm for a regular one), none where it states the same or more or states no treatment.
 */

const house = () => massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' })

const brief = (treatment: Treatment | undefined): DesignBrief => ({
  axes: {
    ...BEDROOM_AXES,
    facade: treatment
      ? openFacade('a stone manor, dressed, its windows shuttered', treatment)
      : BEDROOM_AXES.facade,
  },
  source: 'open',
  vision: 'A manor in stone.',
  beyond: 'none: the test reads the facade.',
})
export const facadeBrief = brief

export const MANOR: Treatment = {
  cladding: ['stone'],
  bands: ['base', 'cornice'],
  elements: ['corners', 'shutters', 'entrance'],
  rhythm: 'regular',
}

const keeping = (designBrief: DesignBrief, firstTreatment?: Treatment): AgentToolCase['context'] => ({
  designBrief,
  session: (): SessionRecord => ({
    checkpoints: {},
    made: [],
    designBrief,
    ...(firstTreatment ? { firstTreatment } : {}),
  }),
})

const REVISED = { type: 'facade_revised_simpler', severity: 'warning' }

export const DESIGN_FACADE_CASES: AgentToolCase[] = [
  {
    name: 'a facade revised to a plainer treatment within the turn: a finding says so',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(brief({ cladding: ['stone'], rhythm: 'free' }), MANOR),
    expect: {
      result: {},
      contains: { issues: [REVISED] },
      mentions: [
        'The facade was revised during the turn: from stone cladding, base and cornice bands, corner chains, shutters, an entrance unit and a regular rhythm to stone cladding and a free rhythm.',
      ],
    },
  },
  {
    name: 'a facade revised to a richer one, or left as it was: no revision finding',
    tool: 'verify_scene',
    scene: house,
    input: {},
    context: keeping(brief(MANOR), { cladding: ['stone'], rhythm: 'free' }),
    expect: { result: {}, lacks: { issues: [REVISED] } },
  },
]

/** A first treatment, the one a later brief of the turn states, and whether the later one is plainer. */
export const FACADE_REVISION_ROWS: {
  name: string
  first: Treatment | undefined
  latest: Treatment | undefined
  plainer: boolean
}[] = [
  { name: 'a manor revised to cladding and a free rhythm', first: MANOR, latest: { cladding: ['stone'], rhythm: 'free' }, plainer: true },
  { name: 'a regular rhythm revised to a free one', first: { cladding: ['stone'], rhythm: 'regular' }, latest: { cladding: ['stone'], rhythm: 'free' }, plainer: true },
  { name: 'a band dropped', first: { cladding: ['stone'], bands: ['base', 'cornice'], rhythm: 'free' }, latest: { cladding: ['stone'], bands: ['cornice'], rhythm: 'free' }, plainer: true },
  { name: 'a stone facade revised to brick: a swap asks as much', first: { cladding: ['stone'], rhythm: 'free' }, latest: { cladding: ['brick'], rhythm: 'free' }, plainer: false },
  { name: 'a facade revised to a richer one', first: { cladding: ['stone'], rhythm: 'free' }, latest: MANOR, plainer: false },
  { name: 'a facade restated as it was', first: MANOR, latest: MANOR, plainer: false },
  { name: 'a later brief that states no treatment has nothing to compare', first: MANOR, latest: undefined, plainer: false },
  { name: 'no first treatment', first: undefined, latest: MANOR, plainer: false },
]
