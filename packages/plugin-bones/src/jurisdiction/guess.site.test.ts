import { describe, expect, test } from 'bun:test'
import { guessJurisdiction, resolveJurisdiction, siteStateOf } from './guess'

describe('AUTO jurisdiction prefers the site address over the browser', () => {
  const nodes = {
    site_1: { type: 'site', address: { state: 'fl' }, parcel: { state: 'FL' } },
    level_1: { type: 'level' },
  }
  test('the site state is read from the address, then the parcel', () => {
    expect(siteStateOf(nodes)).toBe('FL')
    expect(siteStateOf({ s: { type: 'site', parcel: { state: 'tx' } } })).toBe('TX')
    expect(siteStateOf({ s: { type: 'site', address: { state: 'Florida' } } })).toBeNull()
    expect(siteStateOf({})).toBeNull()
  })
  test("the Plans tab's project-record address counts too — the lot drop-in first when both (2026-09-09)", () => {
    const record = { type: 'sheets:project-record', identity: { address: { state: 'ca' } } }
    expect(siteStateOf({ rec: record })).toBe('CA')
    expect(siteStateOf({ rec: record, site: { type: 'site', address: { state: 'FL' } } })).toBe('FL')
    expect(siteStateOf({ rec: record, site: { type: 'site', address: {} } })).toBe('CA')
    expect(siteStateOf({ rec: { type: 'sheets:project-record', identity: { address: { state: '' } } } })).toBeNull()
  })
  test('a Chicago-timezone browser still gets FL when the site says FL', () => {
    expect(guessJurisdiction({ tz: 'America/Chicago' }, 'FL')).toEqual({
      code: 'FL',
      reason: 'site address state (FL)',
    })
    expect(guessJurisdiction({ tz: 'America/Chicago' }, null).code).toBe('TX')
    expect(resolveJurisdiction('AUTO', 'FL')).toEqual({ code: 'FL', auto: true })
    expect(resolveJurisdiction('NY', 'FL')).toEqual({ code: 'NY', auto: false })
  })
})
