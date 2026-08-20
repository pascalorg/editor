import { describe, expect, it } from 'vitest'
import type { KindDef, UnitDef } from '../core/types'
import { lingo, quantity } from '../index'
import { allKinds, byteishFallbacks } from './index'

const kind = (kindName: string): KindDef => {
  const found = allKinds.find((candidate) => candidate.kind === kindName)
  if (!found) {
    throw new Error(`Missing kind ${kindName}`)
  }
  return found
}

const unit = (kindName: string, unitId: string): UnitDef => {
  const found = kind(kindName).units.find((candidate) => candidate.id === unitId)
  if (!found) {
    throw new Error(`Missing unit ${kindName}:${unitId}`)
  }
  return found
}

const toBase = (value: number, def: UnitDef): number => value * def.factor + (def.offset ?? 0)
const fromBase = (value: number, def: UnitDef): number => (value - (def.offset ?? 0)) / def.factor

const claimValues = (def: UnitDef): string[] => {
  const exactLower = new Set((def.caseExact ?? []).map((value) => value.toLowerCase()))
  return [
    def.id,
    def.symbol.toLowerCase(),
    def.name.toLowerCase(),
    def.plural?.toLowerCase(),
    ...(def.aliases ?? []).map((alias) => alias.toLowerCase()),
  ].filter((value): value is string => value !== undefined && !exactLower.has(value))
}

describe('built-in unit tables', () => {
  it('keeps exact conversion anchors intact', () => {
    expect(72 * unit('length', 'in').factor).toBeCloseTo(1.8288, 12)
    expect(unit('length', 'mi').factor).toBe(1609.344)
    expect(unit('length', 'nmi').factor).toBe(1852)

    const celsius = unit('temperature', 'C')
    const fahrenheit = unit('temperature', 'F')
    expect(toBase(100, celsius)).toBeCloseTo(373.15, 12)
    expect(fromBase(toBase(-40, fahrenheit), celsius)).toBeCloseTo(-40, 12)
    expect(celsius.factor / fahrenheit.factor).toBeCloseTo(9 / 5, 12)

    expect(unit('volume', 'gal').factor / unit('volume', 'l').factor).toBeCloseTo(3.785_411_784, 12)
    expect(unit('volume', 'gal-imp').factor / unit('volume', 'l').factor).toBeCloseTo(4.546_09, 12)
    expect(unit('volume', 'floz').factor / unit('volume', 'ml').factor).toBeCloseTo(
      29.573_529_562_5,
      12,
    )
    expect(unit('volume', 'cup').factor / unit('volume', 'ml').factor).toBeCloseTo(
      236.588_236_5,
      12,
    )

    expect(unit('mass', 'lb').factor / unit('mass', 'g').factor).toBeCloseTo(453.592_37, 12)
    expect(unit('mass', 'st').factor / unit('mass', 'lb').factor).toBeCloseTo(14, 12)
    expect(unit('mass', 'ozt').factor / unit('mass', 'g').factor).toBeCloseTo(31.103_476_8, 12)

    expect(unit('data', 'KiB').factor / unit('data', 'B').factor).toBe(1024)
    expect(unit('data', 'KiB').factor).not.toBe(unit('data', 'kB').factor)
    expect(unit('data_rate', 'Mbit/s').factor).toBe(1e6)
    expect(unit('data_rate', 'MB/s').factor / unit('data_rate', 'Mbit/s').factor).toBe(8)
    expect(unit('data_rate', 'MiB/s').factor).toBe(8 * 1024 ** 2)
    expect(unit('flow_rate', 'l/s').factor).toBe(0.001)
    expect(unit('flow_rate', 'l/min').factor).toBe(0.001 / 60)
    expect(unit('flow_rate', 'gal/min').factor).toBeCloseTo(0.003_785_411_784 / 60, 18)
    expect(unit('flow_rate', 'ft3/min').factor).toBeCloseTo(0.3048 ** 3 / 60, 18)

    expect(unit('pressure', 'psi').factor).toBeCloseTo(6894.757_293_168, 12)
    expect(unit('pressure', 'cmH2O').factor).toBe(98.0665)
    expect(unit('pressure', 'inH2O').factor).toBe(249.088_91)
    expect(unit('pressure', 'kgf/cm2').factor).toBe(98_066.5)
    expect(unit('energy', 'kWh').factor).toBe(3.6e6)
    expect(unit('force', 'lbf').factor).toBeCloseTo(4.448_221_615_260_5, 12)
    expect(unit('power', 'hp').factor).toBeCloseTo(745.699_872, 12)
    expect(unit('frequency', 'rpm').factor).toBeCloseTo(1 / 60, 12)
    expect(unit('speed', 'kn').factor / unit('speed', 'km/h').factor).toBeCloseTo(1.852, 12)
    expect(unit('area', 'ac').factor).toBeCloseTo(4046.856_422_4, 12)
    expect((unit('angle', 'deg').factor * 180) / Math.PI).toBeCloseTo(1, 12)
    expect(unit('voltage', 'mV').factor).toBe(1e-3)
    expect(unit('current', 'mA').factor).toBe(1e-3)
    expect(unit('resistance', 'kΩ').factor).toBe(1000)
    expect(unit('charge', 'mAh').factor).toBe(3.6)
    expect(unit('charge', 'Ah').factor).toBe(3600)
    expect(unit('substance', 'mmol').factor).toBe(1e-3)
    expect(unit('concentration', 'M').factor).toBe(1000)
    expect(unit('concentration', 'mM').factor).toBe(1)
    expect(unit('concentration', 'μM').factor).toBe(1e-3)
    expect(unit('concentration', 'mol/l').factor).toBe(1000)
    expect(unit('acceleration', 'ft/s2').factor).toBe(0.3048)
    expect(unit('acceleration', 'g0').factor).toBe(9.806_65)
    expect(unit('torque', 'lbf*ft').factor).toBeCloseTo(4.448_221_615_260_5 * 0.3048, 12)
    expect(unit('luminous_intensity', 'mcd').factor).toBe(1e-3)
    expect(unit('luminous_flux', 'klm').factor).toBe(1000)
    expect(unit('illuminance', 'fc').factor).toBeCloseTo(10.763_910_416_709_722, 12)
    expect(unit('luminance', 'fL').factor).toBeCloseTo(3.426_259_099_635_39, 12)
    expect(unit('radiation_absorbed_dose', 'mGy').factor).toBe(1e-3)
    expect(unit('radiation_equivalent_dose', 'rem').factor).toBe(0.01)
    expect(unit('radioactivity', 'Ci').factor).toBe(3.7e10)
  })

  it('keeps structural invariants across every kind', () => {
    for (const kindDef of allKinds) {
      const baseUnits = kindDef.units.filter((candidate) => candidate.id === kindDef.baseUnit)
      expect(baseUnits, `${kindDef.kind} must have exactly one declared base unit`).toHaveLength(1)
      expect(baseUnits[0]!.factor, `${kindDef.kind} base factor`).toBe(1)
      expect(baseUnits[0]!.offset ?? 0, `${kindDef.kind} base offset`).toBe(0)

      const ids = new Set<string>()
      for (const def of kindDef.units) {
        expect(Number.isFinite(def.factor), `${kindDef.kind}:${def.id} factor must be finite`).toBe(
          true,
        )
        expect(def.factor, `${kindDef.kind}:${def.id} factor must be positive`).toBeGreaterThan(0)
        expect(ids.has(def.id), `${kindDef.kind} duplicate unit id ${def.id}`).toBe(false)
        ids.add(def.id)

        if (def.offset !== undefined) {
          expect(
            kindDef.kind,
            `${kindDef.kind}:${def.id} offset is only legal for temperature`,
          ).toBe('temperature')
        }

        if (def.subunit) {
          const child = kindDef.units.find((candidate) => candidate.id === def.subunit?.unit)
          expect(
            child,
            `${kindDef.kind}:${def.id} subunit ${def.subunit.unit} must exist`,
          ).toBeDefined()
          expect(child?.factor, `${kindDef.kind}:${def.id} subunit must be smaller`).toBeLessThan(
            def.factor,
          )
          expect(
            def.subunit.per * (child?.factor ?? Number.NaN),
            `${kindDef.kind}:${def.id} subunit ratio`,
          ).toBeCloseTo(def.factor, 9)
        }
      }
    }
  })

  it('keeps aliases unique except the explicit cross-kind mark whitelist', () => {
    const crossKindClaims = new Map<string, Set<string>>()
    const withinKindDuplicates: string[] = []

    for (const kindDef of allKinds) {
      const valueOwners = new Map<string, Set<string>>()

      for (const def of kindDef.units) {
        const ownAliases = def.aliases ?? []
        const duplicateOwnAliases = ownAliases.filter(
          (alias, index) => ownAliases.indexOf(alias) !== index,
        )
        expect(duplicateOwnAliases, `${kindDef.kind}:${def.id} duplicate aliases`).toEqual([])

        for (const value of new Set(claimValues(def))) {
          const owners = valueOwners.get(value) ?? new Set<string>()
          owners.add(def.id)
          valueOwners.set(value, owners)

          const kinds = crossKindClaims.get(value) ?? new Set<string>()
          kinds.add(String(kindDef.kind))
          crossKindClaims.set(value, kinds)
        }
      }

      for (const [value, owners] of valueOwners) {
        if (owners.size > 1) {
          withinKindDuplicates.push(`${value}: ${Array.from(owners).join(', ')}`)
        }
      }
    }

    expect(
      withinKindDuplicates,
      `within-kind duplicates: ${withinKindDuplicates.join('; ')}`,
    ).toEqual([])

    const whitelist = new Set(["'", '"', '′', "''", 'oz', 'oz.', 'ounce', 'ounces', 'C', 'c'])
    const offending = Array.from(crossKindClaims.entries())
      .filter(([value, kinds]) => kinds.size > 1 && !whitelist.has(value))
      .map(([value, kinds]) => `${value}: ${Array.from(kinds).join(', ')}`)

    expect(offending, `cross-kind duplicates: ${offending.join('; ')}`).toEqual([])
    // 'oz' is claimed by mass (default priority) AND volume (kind-context path).
    expect(Array.from(crossKindClaims.get('oz') ?? []).sort()).toEqual(['mass', 'volume'])
    // 'C' stays Celsius by default, while charge context can resolve coulombs.
    expect(Array.from(crossKindClaims.get('C') ?? []).sort()).toEqual(['charge', 'temperature'])
  })

  it('formats multi-word plurals long-style and re-parses them (two-way rule)', () => {
    const cases: Array<[kind: string, unitId: string, expected: string]> = [
      ['speed', 'm/s', '5 meters per second'],
      ['speed', 'km/h', '5 kilometers per hour'],
      ['speed', 'mph', '5 miles per hour'],
      ['pressure', 'psi', '5 pounds per square inch'],
      ['pressure', 'mmHg', '5 millimeters of mercury'],
      ['pressure', 'cmH2O', '5 centimeters of water'],
      ['pressure', 'inH2O', '5 inches of water'],
      ['pressure', 'mH2O', '5 meters of water'],
      ['pressure', 'kgf/cm2', '5 kilogram-force per square centimeter'],
      ['duration', 'century', '5 centuries'],
      ['voltage', 'V', '5 volts'],
      ['current', 'A', '5 amperes'],
      ['resistance', 'Ω', '5 ohms'],
      ['charge', 'C', '5 coulombs'],
      ['substance', 'mol', '5 moles'],
      ['concentration', 'μM', '5 micromolar'],
      ['acceleration', 'm/s2', '5 meters per second squared'],
      ['torque', 'N*m', '5 newton meters'],
      ['luminous_intensity', 'cd', '5 candelas'],
      ['luminous_flux', 'lm', '5 lumens'],
      ['illuminance', 'lx', '5 lux'],
      ['luminance', 'cd/m2', '5 candelas per square meter'],
      ['radiation_absorbed_dose', 'Gy', '5 grays'],
      ['radiation_equivalent_dose', 'Sv', '5 sieverts'],
      ['radioactivity', 'Bq', '5 becquerels'],
      ['data_rate', 'Mbit/s', '5 megabits per second'],
      ['flow_rate', 'l/min', '5 liters per minute'],
    ]
    for (const [kindName, unitId, expected] of cases) {
      const text = quantity(5, unitId, kindName).format({ style: 'long' })
      expect(text, `${kindName}:${unitId} long style`).toBe(expected)
      const back = lingo(text, { kind: kindName })
      if (!(back.ok && back.type === 'quantity')) {
        throw new Error(`"${text}" did not re-parse as a quantity`)
      }
      expect(back.quantity.unit, `"${text}" re-parse unit`).toBe(unitId)
      expect(back.quantity.value, `"${text}" re-parse value`).toBeCloseTo(5, 9)
    }
  })

  it('keeps caseExact scoped to units whose uppercase forms are hazardous', () => {
    expect(byteishFallbacks).toEqual({
      kb: { kind: 'data', unit: 'kB', alt: 'kilobits (kbit)' },
      mb: { kind: 'data', unit: 'MB', alt: 'megabits (Mbit)' },
      gb: { kind: 'data', unit: 'GB', alt: 'gigabits (Gbit)' },
      tb: { kind: 'data', unit: 'TB', alt: 'terabits (Tbit)' },
    })
    const expectedDataCaseExact: Record<string, string[]> = {
      bit: ['b'],
      B: ['B'],
      kbit: ['Kb'],
      Mbit: ['Mb'],
      Gbit: ['Gb'],
      Tbit: ['Tb'],
      kB: ['KB', 'kB'],
      MB: ['MB'],
      GB: ['GB'],
      TB: ['TB'],
      PB: ['PB'],
      KiB: ['KiB'],
      MiB: ['MiB'],
      GiB: ['GiB'],
      TiB: ['TiB'],
      PiB: ['PiB'],
    }

    for (const kindDef of allKinds) {
      for (const def of kindDef.units) {
        const caseExact = def.caseExact ?? []
        const lowercaseAliasSet = new Set(
          [
            def.name.toLowerCase(),
            def.plural?.toLowerCase(),
            ...(def.aliases ?? []).map((alias) => alias.toLowerCase()),
          ].filter((value): value is string => Boolean(value)),
        )

        for (const exact of caseExact) {
          expect(
            lowercaseAliasSet.has(exact.toLowerCase()),
            `${kindDef.kind}:${def.id} caseExact ${exact} must not be a lowercase alias`,
          ).toBe(false)
        }

        if (kindDef.kind === 'data') {
          expect(caseExact, `unexpected data caseExact on ${def.id}`).toEqual(
            expectedDataCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'data_rate') {
          const expectedDataRateCaseExact: Record<string, string[]> = {
            'bit/s': ['b/s'],
            'kbit/s': ['kbps', 'Kbps', 'kb/s', 'Kb/s'],
            'Mbit/s': ['Mbps', 'mbps', 'Mb/s'],
            'Gbit/s': ['Gbps', 'gbps', 'Gb/s'],
            'Tbit/s': ['Tbps', 'tbps', 'Tb/s'],
            'B/s': ['B/s', 'Bps'],
            'kB/s': ['kB/s', 'KB/s', 'kBps', 'KBps'],
            'MB/s': ['MB/s', 'MBps'],
            'GB/s': ['GB/s', 'GBps'],
            'TB/s': ['TB/s', 'TBps'],
            'KiB/s': ['KiB/s', 'KiBps'],
            'MiB/s': ['MiB/s', 'MiBps'],
            'GiB/s': ['GiB/s', 'GiBps'],
          }
          expect(caseExact, `unexpected data_rate caseExact on ${def.id}`).toEqual(
            expectedDataRateCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'flow_rate') {
          const expectedFlowRateCaseExact: Record<string, string[]> = {
            'ml/s': ['ml/s', 'mL/s', 'ml/sec', 'mL/sec', 'ml per s', 'mL per s'],
            'ml/min': [
              'ml/min',
              'mL/min',
              'ml/minute',
              'mL/minute',
              'ml per min',
              'mL per min',
              'ml per minute',
              'mL per minute',
              'ml / min',
              'mL / min',
            ],
          }
          expect(caseExact, `unexpected flow_rate caseExact on ${def.id}`).toEqual(
            expectedFlowRateCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'length') {
          const expectedLengthCaseExact: Record<string, string[]> = {
            nm: ['nm'],
            μm: ['μm', 'um'],
            m: ['m'],
            Mm: ['Mm'],
          }
          expect(caseExact, `unexpected length caseExact on ${def.id}`).toEqual(
            expectedLengthCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'voltage') {
          expect(caseExact, `unexpected voltage caseExact on ${def.id}`).toEqual(
            def.id === 'mV' || def.id === 'MV' ? [def.id] : [],
          )
        } else if (kindDef.kind === 'current') {
          expect(caseExact, `unexpected current caseExact on ${def.id}`).toEqual(
            def.id === 'A' || def.id === 'mA' || def.id === 'MA' ? [def.id] : [],
          )
        } else if (kindDef.kind === 'resistance') {
          expect(caseExact, `unexpected resistance caseExact on ${def.id}`).toEqual(
            def.id === 'mΩ' || def.id === 'MΩ' ? [def.id] : [],
          )
        } else if (kindDef.kind === 'charge') {
          const expectedChargeCaseExact: Record<string, string[]> = {
            μC: ['μC', 'uC'],
            mC: ['mC'],
            mAh: ['mAh', 'mah'],
            Ah: ['Ah'],
          }
          expect(caseExact, `unexpected charge caseExact on ${def.id}`).toEqual(
            expectedChargeCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'concentration') {
          const expectedConcentrationCaseExact: Record<string, string[]> = {
            M: ['M'],
            mM: ['mM'],
            μM: ['μM', 'µM', 'uM'],
            nM: ['nM'],
            pM: ['pM'],
          }
          expect(caseExact, `unexpected concentration caseExact on ${def.id}`).toEqual(
            expectedConcentrationCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'energy') {
          const expectedEnergyCaseExact: Record<string, string[]> = {
            kcal: ['Cal', 'Cals', 'Calorie', 'Calories'],
            mJ: ['mJ'],
            mWh: ['mWh'],
          }
          expect(caseExact, `unexpected energy caseExact on ${def.id}`).toEqual(
            expectedEnergyCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'force') {
          expect(caseExact, `unexpected force caseExact on ${def.id}`).toEqual(
            def.id === 'mN' || def.id === 'kN' || def.id === 'MN' ? [def.id] : [],
          )
        } else if (kindDef.kind === 'torque') {
          const expectedTorqueCaseExact: Record<string, string[]> = {
            'N*m': ['Nm'],
            'kN*m': ['kNm'],
          }
          expect(caseExact, `unexpected torque caseExact on ${def.id}`).toEqual(
            expectedTorqueCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'power') {
          expect(caseExact, `unexpected power caseExact on ${def.id}`).toEqual(
            def.id === 'mW' || def.id === 'MW' ? [def.id] : [],
          )
        } else if (kindDef.kind === 'luminance') {
          expect(caseExact, `unexpected luminance caseExact on ${def.id}`).toEqual(
            def.id === 'fL' ? ['fL'] : [],
          )
        } else if (kindDef.kind === 'radiation_absorbed_dose') {
          const expectedAbsorbedDoseCaseExact: Record<string, string[]> = {
            μGy: ['μGy', 'µGy', 'uGy'],
            mGy: ['mGy'],
            Gy: ['Gy'],
          }
          expect(caseExact, `unexpected absorbed-dose caseExact on ${def.id}`).toEqual(
            expectedAbsorbedDoseCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'radiation_equivalent_dose') {
          const expectedEquivalentDoseCaseExact: Record<string, string[]> = {
            μSv: ['μSv', 'µSv', 'uSv'],
            mSv: ['mSv'],
            Sv: ['Sv'],
          }
          expect(caseExact, `unexpected equivalent-dose caseExact on ${def.id}`).toEqual(
            expectedEquivalentDoseCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'radioactivity') {
          const expectedRadioactivityCaseExact: Record<string, string[]> = {
            Bq: ['Bq'],
            kBq: ['kBq'],
            MBq: ['MBq'],
            Ci: ['Ci'],
            mCi: ['mCi'],
            μCi: ['μCi', 'µCi', 'uCi'],
          }
          expect(caseExact, `unexpected radioactivity caseExact on ${def.id}`).toEqual(
            expectedRadioactivityCaseExact[def.id] ?? [],
          )
        } else if (kindDef.kind === 'mass') {
          // Mg (megagram) is exact-case so it never collapses onto mg
          // (milligram): a bare fold would misread it by 10^9.
          expect(caseExact, `unexpected mass caseExact on ${def.id}`).toEqual(
            def.id === 'Mg' ? ['Mg'] : [],
          )
        } else if (kindDef.kind === 'frequency') {
          // mHz (millihertz) is exact-case so it never collapses onto MHz;
          // sloppy lowercase mhz still reads as megahertz.
          expect(caseExact, `unexpected frequency caseExact on ${def.id}`).toEqual(
            def.id === 'mHz' ? ['mHz'] : [],
          )
        } else if (kindDef.kind === 'pressure') {
          // mPa (millipascal) and Mbar (megabar) are exact-case so they never
          // collapse onto MPa / mbar.
          const expectedPressureCaseExact: Record<string, string[]> = {
            mPa: ['mPa'],
            Mbar: ['Mbar'],
          }
          expect(caseExact, `unexpected pressure caseExact on ${def.id}`).toEqual(
            expectedPressureCaseExact[def.id] ?? [],
          )
        } else {
          // Every other kind must carry no caseExact aliases.
          expect(caseExact, `unexpected caseExact on ${kindDef.kind}:${def.id}`).toEqual([])
        }
      }
    }
  })

  it('resolves metric-prefix case hazards to the right magnitude, never a silent 10^x error', () => {
    // Each mixed-case form must resolve to its own unit, not case-fold onto the
    // opposite-magnitude sibling. Before the megagram/megameter/millihertz/
    // millipascal/megabar/millijoule/milliwatt-hour additions these silently
    // read 10^6–10^9 wrong with ok:true and no issue, even under strict. (ML is
    // deliberately absent — see volume.ts — because it collides with milliliter.)
    const hazards: Array<[string, string]> = [
      ['5 Mg', 'Mg'], // megagram, not mg (milligram)
      ['5 Mm', 'Mm'], // megameter, not mm (millimeter)
      ['5 mHz', 'mHz'], // millihertz, not MHz (megahertz)
      ['5 mPa', 'mPa'], // millipascal, not MPa (megapascal)
      ['5 Mbar', 'Mbar'], // megabar, not mbar (millibar)
      ['5 mJ', 'mJ'], // millijoule, not MJ (megajoule)
      ['5 mWh', 'mWh'], // milliwatt-hour, not MWh (megawatt-hour)
    ]
    for (const [text, expectedUnit] of hazards) {
      const result = lingo(text, { strictness: 'strict' })
      if (!(result.ok && result.type === 'quantity')) {
        throw new Error(`"${text}" did not parse as a quantity`)
      }
      expect(result.quantity.unit, `"${text}" resolved unit`).toBe(expectedUnit)
    }

    // The common milli/mega forms — and sloppy all-lowercase — stay unchanged.
    const preserved: Array<[string, string]> = [
      ['5 mg', 'mg'],
      ['5 ml', 'ml'],
      ['5 mL', 'ml'],
      ['250 ML', 'ml'], // casual milliliter spelling stays milliliter, not megaliter
      ['5 mm', 'mm'],
      ['5 MHz', 'MHz'],
      ['100 mhz', 'MHz'], // sloppy lowercase still reads as megahertz
      ['5 MPa', 'MPa'],
      ['5 mpa', 'MPa'], // sloppy lowercase still reads as megapascal
      ['5 mbar', 'mbar'],
      ['5 MJ', 'MJ'],
    ]
    for (const [text, expectedUnit] of preserved) {
      const result = lingo(text)
      if (!(result.ok && result.type === 'quantity')) {
        throw new Error(`"${text}" did not parse as a quantity`)
      }
      expect(result.quantity.unit, `"${text}" resolved unit`).toBe(expectedUnit)
    }
  })
})
