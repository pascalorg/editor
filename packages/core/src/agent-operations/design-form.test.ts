import { describe, expect, test } from 'bun:test'
import {
  FORM_ROWS,
  formBrief,
  massedScene,
  REVISION_ROWS,
  rect,
  U_BUILT,
} from './__fixtures__/design-form-cases'
import { formFinding, formRevision } from './design-form'
import { EMPTY_SESSION, keepInSession, parseSessionRecord } from './scene-checkpoint'
import type { SceneNodes } from './types'

describe('the form a brief states against the volumes built', () => {
  test.each(FORM_ROWS)('$name', ({ scene, massing, differs }) => {
    const finding = formFinding(formBrief(massing), scene.nodes as SceneNodes)
    expect(finding?.differs ?? []).toEqual(differs)
    expect(finding?.code ?? 'form_simpler_than_brief').toBe('form_simpler_than_brief')
  })

  test('no brief, and a brief stored before the form axis, have nothing to compare', () => {
    const nodes = U_BUILT.nodes as SceneNodes
    expect(formFinding(null, nodes)).toBeNull()
    expect(formFinding(undefined, nodes)).toBeNull()
    expect(formFinding({ axes: {} }, nodes)).toBeNull()
  })

  test('a scene the massing cannot be read from has no finding, and no throw', () => {
    const scene = massedScene({ name: 'House', polygon: rect(0, 0, 12, 9), shape: 'rectangle' })
    const broken = {
      ...scene.nodes,
      zone_House_0: { ...(scene.nodes.zone_House_0 as object), polygon: undefined },
    }
    expect(
      formFinding(formBrief({ plan: 'u', volumes: 3, heights: 'several' }), broken as SceneNodes),
    ).toBeNull()
  })
})

describe('a form revised within the turn', () => {
  test.each(REVISION_ROWS)('$name', ({ first, latest, differs }) => {
    const revision = formRevision(first, formBrief(latest))
    expect(revision?.differs ?? []).toEqual(differs)
  })

  test('the first massing the turn stated stays while later briefs replace the brief', () => {
    const U = { plan: 'u', volumes: 3, heights: 'several' } as const
    const box = { plan: 'rectangle', volumes: 1, heights: 'one' } as const
    const first = keepInSession(EMPTY_SESSION, { designBrief: formBrief(U) })
    expect(first.firstMassing).toEqual(U)
    const revised = keepInSession(first, { designBrief: formBrief(box) })
    expect(revised.firstMassing).toEqual(U)
    expect(revised.designBrief?.axes?.form?.massing).toEqual(box)
    expect(keepInSession(revised, { made: [] }).firstMassing).toEqual(U)
  })

  test('it goes with the brief: taking the brief away clears it, and the next turn starts anew', () => {
    const U = { plan: 'u', volumes: 3, heights: 'several' } as const
    const box = { plan: 'rectangle', volumes: 1, heights: 'one' } as const
    const kept = keepInSession(EMPTY_SESSION, { designBrief: formBrief(U) })
    const cleared = keepInSession(kept, { designBrief: null })
    expect(cleared.firstMassing).toBeUndefined()
    expect(keepInSession(cleared, { designBrief: formBrief(box) }).firstMassing).toEqual(box)
  })

  test('a first brief that states no massing sets none; the first one that states one does', () => {
    const none = keepInSession(EMPTY_SESSION, { designBrief: formBrief(undefined) })
    expect(none.firstMassing).toBeUndefined()
    const box = { plan: 'rectangle', volumes: 1, heights: 'one' } as const
    expect(keepInSession(none, { designBrief: formBrief(box) }).firstMassing).toEqual(box)
  })

  test('it is kept with the session record, and a record without it still reads', () => {
    const U = { plan: 'u', volumes: 3, heights: 'several' } as const
    const kept = keepInSession(EMPTY_SESSION, { designBrief: formBrief(U) })
    expect(parseSessionRecord(JSON.parse(JSON.stringify(kept))).firstMassing).toEqual(U)
    const { firstMassing: _first, ...older } = kept
    expect(parseSessionRecord(older).designBrief).toBeDefined()
  })
})
