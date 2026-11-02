import { describe, expect, test } from 'bun:test'
import {
  CODE_PROFILE_IDS,
  CODE_PROFILES,
  codeProfileOf,
  FR_2015,
  IRC_2021,
  ircValue,
  NCC_2022,
  thresholdOf,
} from './code-profile'

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

  test('the Australian and French profiles hold only the rows read in their own texts, each cited', () => {
    expect(CODE_PROFILE_IDS).toEqual(['irc-2021', 'au-ncc', 'fr'])
    expect(CODE_PROFILES['au-ncc'].thresholds).toBe(NCC_2022)
    expect(CODE_PROFILES.fr.thresholds).toBe(FR_2015)
    for (const [rows, section] of [
      [NCC_2022, /^NCC 2022 HP /],
      [FR_2015, /^arrêté du 24 décembre 2015 art\. 1\d/],
    ] as const)
      for (const [id, row] of Object.entries(rows)) {
        expect([id, row.section]).toEqual([id, expect.stringMatching(section)])
        expect(row.cite.length).toBeGreaterThan(40)
        expect(row.source).toBe('code text')
        expect(row.value).toBeGreaterThan(0)
      }
    // what their texts do not set has no row: a check that needs one reports nothing
    for (const id of ['toiletFrontClear', 'doorThresholdDrop', 'habitableRoomArea'] as const) {
      expect(thresholdOf(CODE_PROFILES['au-ncc'], id)).toBeUndefined()
      expect(thresholdOf(CODE_PROFILES.fr, id)).toBeUndefined()
    }
    // the same id, a different applicability: the IRC landing is at every exterior door, the NCC's only over a drop
    expect(IRC_2021.exteriorDoorLanding.appliesWhen).toBe('every-exterior-door')
    expect(NCC_2022.exteriorDoorLanding.appliesWhen).toEqual({ dropOverM: 0.57, risersOver: 3 })
    expect(
      Object.entries({ ...IRC_2021, ...NCC_2022, ...FR_2015 })
        .filter(([, row]) => 'appliesWhen' in row)
        .map(([id]) => id),
    ).toEqual(['exteriorDoorLanding'])
    expect(NCC_2022.riserMax.value).toBe(0.19)
    expect(NCC_2022.stairLanding.value).toBe(0.75)
    expect(FR_2015.stairWidth.value).toBe(0.8)
    expect(FR_2015.riserMax.value).toBe(0.18)
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
    expect(codeProfileOf(site({ codeProfile: 'au-ncc' }))?.id).toBe('au-ncc')
    expect(codeProfileOf(site({ codeProfile: 'fr' }))?.id).toBe('fr')
  })
})
