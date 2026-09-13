import { describe, expect, test } from 'bun:test'
import { defaultWaterHeater, tankGallons, uefMinimum, waterHeaterSpec } from './water-heater'

describe('the water heater by the state and the HVAC fuel (Steve, 2026-09-07: "water heaters too with good specs and standards, heat pumps in CA")', () => {
  test('CA / WA / OR default to a heat-pump heater; a gas furnace brings a gas tank; the South an electric tank', () => {
    expect(defaultWaterHeater('CA', 'heat-pump-split').kind).toBe('heat-pump')
    expect(defaultWaterHeater('CA', 'ac-gas-furnace').kind).toBe('heat-pump')
    expect(defaultWaterHeater('WA', null).kind).toBe('heat-pump')
    expect(defaultWaterHeater('OH', 'ac-gas-furnace').kind).toBe('gas-tank')
    expect(defaultWaterHeater('FL', 'heat-pump-split').kind).toBe('electric-tank')
    expect(defaultWaterHeater('INTL', null).kind).toBe('electric-tank')
  })

  test('tank size by bedrooms and baths, a heat-pump heater a size up; tankless has none', () => {
    expect(tankGallons('electric-tank', 2, 1)).toBe(40)
    expect(tankGallons('electric-tank', 3, 2)).toBe(50)
    expect(tankGallons('gas-tank', 4, 3)).toBe(65)
    expect(tankGallons('electric-tank', 5, 4)).toBe(80)
    expect(tankGallons('heat-pump', 2, 1)).toBe(50)
    expect(tankGallons('heat-pump', 3, 2)).toBe(65)
    expect(tankGallons('tankless-gas', 3, 2)).toBeNull()
  })

  test('the federal UEF floors: electric over 55 gal is a heat-pump class', () => {
    expect(uefMinimum('electric-tank', 50)).toBe(0.92)
    expect(uefMinimum('electric-tank', 65)).toBe(2.0)
    expect(uefMinimum('gas-tank', 40)).toBe(0.6)
    expect(uefMinimum('heat-pump', 65)).toBe(2.0)
    expect(uefMinimum('tankless-gas', null)).toBe(0.81)
  })

  test('the spec carries the standards and the circuit; the seismic straps only where the spec asks', () => {
    const ca = waterHeaterSpec({ stateCode: 'CA', hvacSystem: 'heat-pump-split', bedrooms: 3, baths: 2, inGarage: true, seismicStraps: true })
    expect(ca.kind).toBe('heat-pump')
    expect(ca.gallons).toBe(65)
    expect(ca.label).toContain('Heat-pump water heater — 65 gal')
    expect(ca.label).toContain('P2803')
    expect(ca.label).toContain('P2801.8')
    expect(ca.label).toContain('Title 24')
    expect(ca.circuit).toContain('240 V 30 A')
    expect(ca.notes.some((n) => /700 ft³/.test(n))).toBe(true)
    const fl = waterHeaterSpec({ stateCode: 'FL', hvacSystem: 'heat-pump-split', bedrooms: 3, baths: 2, inGarage: true, seismicStraps: false })
    expect(fl.kind).toBe('electric-tank')
    expect(fl.gallons).toBe(50)
    expect(fl.label).not.toContain('P2801.8')
    expect(fl.label).toContain('M1307.3')
    const chosen = waterHeaterSpec({ choice: 'tankless-gas', stateCode: 'FL', hvacSystem: null, bedrooms: 3, baths: 2, inGarage: false, seismicStraps: false })
    expect(chosen.kind).toBe('tankless-gas')
    expect(chosen.gallons).toBeNull()
    expect(chosen.venting).toBe('direct')
    expect(chosen.label).not.toContain('drain pan')
    expect(chosen.reason).toBe("the panel's choice")
  })
})
