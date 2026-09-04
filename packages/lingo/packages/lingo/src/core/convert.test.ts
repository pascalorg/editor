import { describe, expect, it } from 'vitest'
import { convert, convertDelta, createLingo, quantity, tryConvert } from '../index'
import { approxEqual } from './round'

/** Conversion truth table (plan 010 §3) — authoritative exact values. */
describe('conversion truth table', () => {
  it('length', () => {
    expect(convert(1, 'in', 'cm')).toBeCloseTo(2.54, 12)
    expect(convert(72, 'in', 'ft')).toBeCloseTo(6, 12)
    expect(convert(72, 'in', 'm')).toBeCloseTo(1.8288, 12)
    expect(convert(1, 'mi', 'm')).toBeCloseTo(1609.344, 9)
    expect(convert(1, 'nmi', 'm')).toBeCloseTo(1852, 9)
  })

  it('temperature — absolute and delta are different animals', () => {
    expect(convert(100, 'C', 'F')).toBeCloseTo(212, 10)
    expect(convert(-40, 'C', 'F')).toBeCloseTo(-40, 10)
    expect(convert(0, 'C', 'K')).toBeCloseTo(273.15, 10)
    expect(convert(98.6, 'F', 'C')).toBeCloseTo(37, 10)
    // A 5 °C *rise* is a 9 °F rise — factor path, never offsets.
    expect(convertDelta(5, 'C', 'F')).toBeCloseTo(9, 12)
    expect(convertDelta(9, 'F', 'C')).toBeCloseTo(5, 12)
    expect(convertDelta(1, 'C', 'K')).toBeCloseTo(1, 12)
  })

  it('mass', () => {
    expect(convert(1, 'lb', 'g')).toBeCloseTo(453.592_37, 12)
    expect(convert(1, 'st', 'lb')).toBeCloseTo(14, 12)
    expect(convert(1, 'ozt', 'g')).toBeCloseTo(31.103_476_8, 12)
    expect(convert(1, 'oz', 'g')).toBeCloseTo(28.349_523_125, 12)
  })

  it('volume', () => {
    expect(convert(1, 'gal', 'L')).toBeCloseTo(3.785_411_784, 12)
    expect(convert(1, 'gal-imp', 'L')).toBeCloseTo(4.546_09, 12)
    expect(convert(1, 'floz', 'ml')).toBeCloseTo(29.573_529_562_5, 12)
    expect(convert(1, 'cup', 'ml')).toBeCloseTo(236.588_236_5, 12)
  })

  it('data — decimal vs binary', () => {
    expect(convert(1, 'KiB', 'B')).toBe(1024)
    expect(convert(1, 'kB', 'B')).toBe(1000)
    expect(convert(1, 'MiB', 'kB')).toBeCloseTo(1048.576, 12)
  })

  it('data rate — bits vs bytes per second', () => {
    expect(convert(1, 'Mbps', 'bit/s')).toBe(1e6)
    expect(convert(1, 'MB/s', 'Mbit/s')).toBe(8)
    expect(convert(1, 'MiB/s', 'bit/s')).toBe(8 * 1024 ** 2)

    const from: string = 'bps'
    const to: string = 'bit/s'
    expect(tryConvert(25, from, to)).toMatchObject({
      ok: false,
      issues: [
        { code: 'CONVERSION_KIND_MISMATCH', data: { found: 'percent', target: 'data_rate' } },
      ],
    })
  })

  it('flow rate — volume per time without general unit algebra', () => {
    expect(convert(60, 'l/min', 'l/s')).toBeCloseTo(1, 12)
    expect(convert(1, 'gpm', 'l/min')).toBeCloseTo(3.785_411_784, 12)
    expect(convert(1, 'cfm', 'ft3/s')).toBeCloseTo(1 / 60, 12)
    expect(convert(1, 'cfs', 'cfm')).toBeCloseTo(60, 12)
  })

  it('concentration — molarity to SI amount concentration', () => {
    expect(convert(1, 'M', 'mol/m3')).toBe(1000)
    expect(convert(1, 'mM', 'M')).toBe(0.001)
    expect(convert(1000, 'μM', 'mM')).toBe(1)
    expect(convert(1000, 'µM', 'mM')).toBe(1)
    expect(convert(1000, 'µmol/L', 'mM')).toBe(1)
    expect(convert(1, 'mol/l', 'M')).toBe(1)

    const from: string = 'M'
    const to: string = 'mol'
    expect(tryConvert(1, from, to)).toMatchObject({
      ok: false,
      issues: [
        { code: 'CONVERSION_KIND_MISMATCH', data: { found: 'concentration', target: 'substance' } },
      ],
    })
  })

  it('pressure, energy, speed, angle, force, power, frequency, and scientific kinds', () => {
    expect(convert(1, 'psi', 'Pa')).toBeCloseTo(6894.757_293_168, 9)
    expect(convert(1, 'atm', 'Pa')).toBe(101_325)
    expect(convert(10, 'inH2O', 'Pa')).toBeCloseTo(2490.8891, 12)
    expect(convert(1, 'kgf/cm2', 'kPa')).toBeCloseTo(98.0665, 12)
    expect(convert(1, 'kWh', 'J')).toBe(3.6e6)
    expect(convert(1, 'kn', 'km/h')).toBeCloseTo(1.852, 12)
    expect(convert(180, 'deg', 'rad')).toBeCloseTo(Math.PI, 12)
    expect(convert(1, 'kN', 'N')).toBe(1000)
    expect(convert(1, 'lbf', 'N')).toBeCloseTo(4.448_221_615_260_5, 12)
    expect(convert(1, 'hp', 'W')).toBeCloseTo(745.699_872, 12)
    expect(convert(3000, 'rpm', 'Hz')).toBeCloseTo(50, 12)
    expect(convert(500, 'mV', 'V')).toBeCloseTo(0.5, 12)
    expect(convert(500, 'mA', 'A')).toBeCloseTo(0.5, 12)
    expect(convert(4.7, 'kΩ', 'Ω')).toBeCloseTo(4700, 12)
    expect(convert(500, 'mAh', 'C')).toBeCloseTo(1800, 12)
    expect(convert(250, 'mmol', 'mol')).toBeCloseTo(0.25, 12)
  })
})

describe('conversion properties', () => {
  it('round-trips across random unit pairs', () => {
    // Seeded LCG — deterministic.
    let seed = 42
    const rand = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32) / 2 ** 32
    const pairs: Array<[string, string]> = [
      ['m', 'ft'],
      ['km', 'mi'],
      ['kg', 'lb'],
      ['g', 'oz'],
      ['C', 'F'],
      ['L', 'gal'],
      ['ml', 'floz'],
      ['m2', 'ft2'],
      ['km/h', 'mph'],
      ['Pa', 'psi'],
      ['cmH2O', 'inH2O'],
      ['J', 'cal'],
      ['N', 'lbf'],
      ['W', 'hp'],
      ['Hz', 'rpm'],
      ['rad', 'deg'],
      ['B', 'KiB'],
      ['Mbit/s', 'MB/s'],
      ['l/min', 'gpm'],
      ['h', 'min'],
      ['V', 'mV'],
      ['A', 'mA'],
      ['Ω', 'kΩ'],
      ['Ah', 'mAh'],
      ['mol', 'mmol'],
      ['M', 'μM'],
      ['m/s2', 'ft/s2'],
      ['N*m', 'lbf*ft'],
      ['cd', 'mcd'],
      ['lm', 'klm'],
      ['lx', 'fc'],
      ['cd/m2', 'fL'],
      ['Gy', 'mGy'],
      ['Sv', 'mSv'],
      ['Bq', 'Ci'],
    ]
    for (const [a, b] of pairs) {
      for (let i = 0; i < 50; i++) {
        const x = (rand() - 0.3) * 1000
        const back = convert(convert(x, a, b), b, a)
        expect(approxEqual(back, x, 1e-9), `${x} ${a}↔${b} → ${back}`).toBe(true)
      }
    }
  })

  it('quantity() chains', () => {
    expect(quantity(72, 'in').to('ft').value).toBeCloseTo(6, 12)
    expect(quantity(1500, 'm').toBest().unit).toBe('km')
    expect(quantity(2, 'ft').format()).toBe('2 ft')
    expect(quantity(0.6096, 'm').to('ft').format()).toBe('2 ft')
    expect(quantity(5000, 'N').toBest().unit).toBe('kN')
    expect(quantity(0.002, 'N').toBest().unit).toBe('mN')
    expect(quantity(2_500_000, 'W').toBest().unit).toBe('MW')
    expect(quantity(1200, 'Hz').toBest().unit).toBe('kHz')
    expect(quantity(0.5, 'V').toBest().unit).toBe('mV')
    expect(quantity(0.5, 'A').toBest().unit).toBe('mA')
    expect(quantity(4700, 'Ω').toBest().unit).toBe('kΩ')
    expect(quantity(0.25, 'mol').toBest().unit).toBe('mmol')
    expect(quantity(0.001, 'M').toBest().unit).toBe('mM')
    expect(quantity(0.02, 'm/s2').toBest().unit).toBe('cm/s2')
    expect(quantity(5000, 'N*m').toBest().unit).toBe('kN*m')
    expect(quantity(0.002, 'cd').toBest().unit).toBe('mcd')
    expect(quantity(5000, 'lm').toBest().unit).toBe('klm')
    expect(quantity(1200, 'lx').toBest().unit).toBe('klx')
    expect(quantity(0.002, 'Gy').toBest().unit).toBe('mGy')
    expect(quantity(0.002, 'Sv').toBest().unit).toBe('mSv')
    expect(quantity(1200, 'Bq').toBest().unit).toBe('kBq')
  })
})

describe('tryConvert', () => {
  it('returns a versioned success payload instead of a bare number', () => {
    const r = tryConvert(72, 'in', 'cm')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r).toMatchObject({
      schemaVersion: 3,
      type: 'conversion',
      kind: 'length',
      unit: 'cm',
    })
    expect(r.value).toBeCloseTo(182.88, 12)
  })

  it('returns structured issues for code-side validation failures', () => {
    expect(tryConvert(Number.POSITIVE_INFINITY, 'm', 'cm')).toMatchObject({
      ok: false,
      schemaVersion: 3,
      type: 'failure',
      issues: [{ code: 'NONFINITE', severity: 'error' }],
    })
    expect(tryConvert(5, 'nope', 'cm')).toMatchObject({
      ok: false,
      schemaVersion: 3,
      type: 'failure',
      issues: [{ code: 'UNKNOWN_UNIT', data: { unit: 'nope' } }],
    })
    const from: string = 'kg'
    const to: string = 'cm'
    expect(tryConvert(5, from, to)).toMatchObject({
      ok: false,
      issues: [{ code: 'CONVERSION_KIND_MISMATCH', data: { found: 'mass', target: 'length' } }],
    })
    expect(tryConvert(5, 'USD', 'EUR')).toMatchObject({
      ok: false,
      issues: [{ code: 'RATE_REQUIRED', data: { from: 'USD', to: 'EUR' } }],
    })
  })

  it('uses instance message packs and custom registries', () => {
    const tenant = createLingo({
      messages: { RATE_REQUIRED: 'Pass FX rates for {from} → {to}.' },
    })
    const fx = tenant.tryConvert(5, 'USD', 'EUR')
    expect(fx.ok).toBe(false)
    if (!fx.ok) {
      expect(fx.issues[0]?.message).toBe('Pass FX rates for USD → EUR.')
    }

    const custom = createLingo({
      kinds: [
        {
          kind: 'widget',
          baseUnit: 'widget',
          units: [
            { id: 'widget', symbol: 'wdg', name: 'widget', factor: 1, system: 'shared' },
            { id: 'box', symbol: 'box', name: 'box', factor: 12, system: 'shared' },
          ],
        },
      ],
    })
    expect(custom.tryConvert(2, 'box', 'widget')).toMatchObject({
      ok: true,
      kind: 'widget',
      value: 24,
      unit: 'widget',
    })
  })

  it('keeps throwing convert() but makes dynamic cross-kind failures kind-aware', () => {
    const from: string = 'kg'
    const to: string = 'cm'
    expect(() => convert(5, from, to)).toThrow('Cannot convert mass to length')
  })
})
