import { describe, expect, test } from 'bun:test'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { NodeMap } from '../model'
import { citation } from './general'
import { codeTagOf, inferFloridaCounty, resolveJurisdiction, retagCode } from './jurisdiction'

const TAMPA: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes

/** A Miami Shores site the way the lot drop-in writes it: no county on the parcel, coordinates on it. */
function miamiShores(): NodeMap {
  return {
    site_1: {
      id: 'site_1',
      type: 'site',
      name: 'Site',
      address: { street: '1247 NE 104th St', city: 'Miami Shores', state: 'FL', zip: '33138' },
      parcel: { apn: '3022320010590', source: 'gis-parcel', county: '', state: 'FL', originLngLat: [-80.174093, 25.875961] },
    },
  } as unknown as NodeMap
}

describe('the code a jurisdiction cites under', () => {
  test('Florida cites FBC-R, California CRC, an IRC state the IRC, an unknown state the IRC', () => {
    expect(codeTagOf('FL', true)).toBe('FBC-R')
    expect(codeTagOf('CA', true)).toBe('CRC')
    expect(codeTagOf('TX', true)).toBe('IRC')
    expect(codeTagOf('FL', false)).toBe('IRC')
    expect(resolveJurisdiction(TAMPA).codeTag).toBe('FBC-R')
    expect(resolveJurisdiction({}).codeTag).toBe('IRC')
  })

  test('a note cites the IRC by name; the retag pass renames it for the adopted code and leaves the base-code sentence alone', () => {
    expect(citation({ text: 'x', cite: 'R401.3' })).toBe('(IRC R401.3)')
    expect(citation({ text: 'x', cite: 'R802.5', verify: true })).toBe('(verify: IRC R802.5)')
    expect(citation({ text: 'x', cite: 'Table R403.1(1)' })).toBe('(Table R403.1(1))')
    expect(citation({ text: 'x', cite: '' })).toBe('(drafting standard)')
    expect(retagCode('(IRC R401.3)', 'FBC-R')).toBe('(FBC-R R401.3)')
    expect(retagCode('per IRC Table R602.3(1) and IRC Figure R301.2(2)', 'CRC')).toBe(
      'per CRC Table R602.3(1) and CRC Figure R301.2(2)',
    )
    expect(retagCode('IRC 2021 Table R602.3(1) — common connections', 'FBC-R')).toBe(
      'FBC-R Table R602.3(1) — common connections',
    )
    expect(retagCode('Florida Building Code, Residential — 8th Edition (2023), 2021 IRC base', 'FBC-R')).toBe(
      'Florida Building Code, Residential — 8th Edition (2023), 2021 IRC base',
    )
    expect(retagCode('(IRC R401.3)', 'IRC')).toBe('(IRC R401.3)')
    expect(retagCode('IRC N1102.1.3', 'FBC-R')).toBe('FBC-R N1102.1.3')
  })
})

describe("Florida's counties the code treats specially", () => {
  test('Miami Shores is read as Miami-Dade off its coordinates: HVHZ, zone 1A, the HVHZ wind range, all marked inferred', () => {
    expect(inferFloridaCounty(-80.174093, 25.875961)?.county).toBe('Miami-Dade')
    expect(inferFloridaCounty(-80.14, 26.12)?.county).toBe('Broward')
    expect(inferFloridaCounty(-81.78, 24.56)?.county).toBe('Monroe')
    expect(inferFloridaCounty(-82.5, 27.92)).toBeNull() // Tampa
    const j = resolveJurisdiction(miamiShores())
    expect(j.county).toBe('Miami-Dade')
    expect(j.countyInferred).toBe(true)
    expect(j.hvhz).toBe(true)
    expect(j.climateZone).toBe('1A')
    expect(j.windRange).toBe('170–180 mph')
    expect(j.caveats.join(' ')).toContain('inferred from the site coordinates')
    expect(j.caveats.join(' ')).toContain('High-Velocity Hurricane Zone')
  })

  test('Tampa keeps its recorded county, zone 2A, and is not HVHZ even though the state flag is set', () => {
    const j = resolveJurisdiction(TAMPA)
    expect(j.county).toBe('Hillsborough')
    expect(j.countyInferred).toBe(false)
    expect(j.hvhz).toBe(false)
    expect(j.climateZone).toBe('2A')
    expect(j.windRange).toBeNull()
  })
})
