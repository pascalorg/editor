import { describe, expect, test } from 'bun:test'
import { CODE_PROFILES, codeProfileOf, IRC_2021, ircValue, thresholdOf } from './code-profile'

describe('the code profile table', () => {
  test('every IRC row says its section, its citation and whether its text was read', () => {
    for (const [id, row] of Object.entries(IRC_2021)) {
      expect([id, row.section]).toEqual([id, expect.stringMatching(/^IRC R\d/)])
      expect(row.cite.length).toBeGreaterThan(20)
      expect(['code text', 'secondary source']).toContain(row.source)
      expect(row.value).toBeGreaterThan(0)
    }
  })

  test('the bathroom clearances and the shower figure are marked as secondary sources: their text was not read', () => {
    for (const id of [
      'toiletSideClear',
      'toiletFrontClear',
      'lavatorySideClear',
      'lavatoryFrontClear',
      'showerFrontClear',
    ] as const)
      expect(IRC_2021[id].source).toBe('secondary source')
    expect(IRC_2021.stairHeadroom).toMatchObject({ source: 'code text', value: 80 * 0.0254 })
  })

  test('a profile hands back the row of an id', () => {
    expect(thresholdOf(CODE_PROFILES['irc-2021'], 'toiletFrontClear')?.value).toBe(
      ircValue('toiletFrontClear'),
    )
  })
})

describe('the jurisdiction of a scene', () => {
  const site = (metadata?: unknown) => ({ site_1: { type: 'site', metadata } })

  test('a scene that does not name a code has none: nothing is guessed from an address or a state', () => {
    expect(codeProfileOf({})).toBeNull()
    expect(codeProfileOf(site({}))).toBeNull()
    expect(codeProfileOf(site({ codeOverrides: { state: 'WA' } }))).toBeNull()
    expect(codeProfileOf(site({ codeProfile: 'ncc' }))).toBeNull()
    expect(codeProfileOf(site({ codeProfile: 42 }))).toBeNull()
  })

  test('site.metadata.codeProfile names it', () => {
    expect(codeProfileOf(site({ codeProfile: 'irc-2021' }))?.id).toBe('irc-2021')
  })
})
