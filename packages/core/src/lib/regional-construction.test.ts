import { describe, expect, it } from 'bun:test'
import { exteriorWallConvention } from './regional-construction'

describe('exteriorWallConvention', () => {
  it('is wood frame outside Florida', () => {
    expect(exteriorWallConvention({ state: 'CA', county: 'Sacramento', lat: 38.5 }).system).toBe('framed')
    expect(exteriorWallConvention({ state: 'tx' }).system).toBe('framed')
  })

  it('is block in the HVHZ and says so', () => {
    const c = exteriorWallConvention({ state: 'FL', county: 'Miami-Dade County', lat: 25.8 })
    expect(c.system).toBe('cmu')
    expect(c.hvhz).toBe(true)
    expect(c.basis).toMatch(/High-Velocity Hurricane Zone/)
  })

  it('is block through the peninsula by county', () => {
    expect(exteriorWallConvention({ state: 'FL', county: 'Lee' }).system).toBe('cmu')
    expect(exteriorWallConvention({ state: 'FL', county: 'Orange County' }).system).toBe('cmu')
    expect(exteriorWallConvention({ state: 'FL', county: 'Lee' }).basis).toMatch(/not a code mandate/)
  })

  it('is wood frame in the north and the Panhandle', () => {
    expect(exteriorWallConvention({ state: 'FL', county: 'Leon', lat: 30.44 }).system).toBe('framed')
    expect(exteriorWallConvention({ state: 'FL', county: 'Duval', lat: 30.33 }).system).toBe('framed')
    expect(exteriorWallConvention({ state: 'FL', county: 'Escambia' }).system).toBe('framed')
  })

  it('falls to the latitude line for a county it does not list', () => {
    expect(exteriorWallConvention({ state: 'FL', county: 'Marion', lat: 29.19 }).system).toBe('cmu')
    expect(exteriorWallConvention({ state: 'FL', county: 'Alachua', lat: 29.65 }).system).toBe('framed')
  })

  it('assumes wood frame when the place is unknown, and says why', () => {
    const c = exteriorWallConvention({ state: 'FL' })
    expect(c.system).toBe('framed')
    expect(c.basis).toMatch(/place unknown/)
  })
})
