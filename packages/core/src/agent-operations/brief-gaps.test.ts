import { describe, expect, test } from 'bun:test'
import { underBrief, zone } from './__fixtures__/brief-gaps-cases'
import { formBrief, massedScene, rect } from './__fixtures__/design-form-cases'
import { briefGaps } from './brief-gaps'
import { EMPTY_SESSION, keepInSession, parseSessionRecord } from './scene-checkpoint'
import type { SceneNodes } from './types'

describe('the turn’s marker in the session', () => {
  const brief = formBrief(undefined)

  test('the first brief marks how much the thread had made; later briefs keep it', () => {
    const session = { ...EMPTY_SESSION, made: [zone('zone_a'), zone('zone_b')] }
    const first = keepInSession(session, { designBrief: brief })
    expect(first.briefMadeAt).toBe(2)
    const grown = keepInSession(first, { made: [zone('zone_c')] })
    const revised = keepInSession(grown, { designBrief: brief })
    expect(revised.briefMadeAt).toBe(2)
    expect(revised.made).toHaveLength(3)
  })

  test('it goes with the brief, and the next turn marks anew', () => {
    const first = keepInSession(
      { ...EMPTY_SESSION, made: [zone('zone_a')] },
      { designBrief: brief },
    )
    const cleared = keepInSession(first, { designBrief: null })
    expect(cleared.briefMadeAt).toBeUndefined()
    const next = keepInSession(
      { ...cleared, made: [zone('zone_a'), zone('zone_b')] },
      { designBrief: brief },
    )
    expect(next.briefMadeAt).toBe(2)
  })

  test('it is kept with the session record, and a record without it reads', () => {
    const kept = keepInSession({ ...EMPTY_SESSION, made: [zone('zone_a')] }, { designBrief: brief })
    expect(parseSessionRecord(JSON.parse(JSON.stringify(kept))).briefMadeAt).toBe(1)
    const { briefMadeAt: _marker, ...older } = kept
    expect(parseSessionRecord(older).designBrief).toBeDefined()
  })
})

describe('what a brief leaves unstated, read for the turn that built', () => {
  const nodes = massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' })
    .nodes as SceneNodes

  test('nothing to read without a brief, or without a marker', () => {
    expect(briefGaps({ made: [zone('zone_a')], designBrief: undefined }, nodes)).toEqual([])
    expect(
      briefGaps(
        { made: [zone('zone_a'), zone('zone_b')], designBrief: formBrief(undefined) },
        nodes,
      ),
    ).toEqual([])
  })

  test('two rooms built under a brief that bounds the form by words and lists no rooms: the two are said, in order', () => {
    const findings = briefGaps(
      underBrief(formBrief(undefined), [], [zone('zone_a'), zone('zone_b')]),
      nodes,
    )
    expect(findings.map((finding) => finding.code)).toEqual([
      'form_bounded_without_plan',
      'rooms_not_listed',
    ])
  })
})
