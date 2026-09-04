import { describe, expect, it } from 'vitest'
import { type LingoOptions, lingo } from '../index'

/**
 * Breadth corpus (plan 010 §1): one row per real-world writing habit.
 * Quantity rows assert (kind, resolved unit id, value in that unit) — no
 * hand-computed base math to rot. Failure rows assert issue codes.
 */

type QRow = [input: string, kind: string, unit: string, value: number, opts?: LingoOptions]

const QUANTITIES: QRow[] = [
  // length — spellings, abbreviations, unicode
  ['5 meters', 'length', 'm', 5],
  ['5 metres', 'length', 'm', 5],
  ['5m', 'length', 'm', 5],
  ['12 km', 'length', 'km', 12],
  ['3 klicks', 'length', 'km', 3, { kind: 'length' }],
  ['0.5 mm', 'length', 'mm', 0.5],
  ['25 microns', 'length', 'μm', 25],
  ['25 um', 'length', 'μm', 25],
  ['6 yd', 'length', 'yd', 6],
  ['2 miles', 'length', 'mi', 2],
  ['1 nautical mile', 'length', 'nmi', 1],
  ['3 hands', 'length', 'hand', 3],
  ['15 thou', 'length', 'thou', 15],
  ['1 light year', 'length', 'ly', 1],
  ['2 fathoms', 'length', 'fathom', 2],
  ['6 ft.', 'length', 'ft', 6],
  ['6 feet', 'length', 'ft', 6],
  ['six foot', 'length', 'ft', 6],
  ["6'", 'length', 'ft', 6],
  ['11"', 'length', 'in', 11, { kind: 'length' }],
  ['72 inches', 'length', 'in', 72],
  ['72in', 'length', 'in', 72],

  // mass
  ['80 kg', 'mass', 'kg', 80],
  ['80 kilos', 'mass', 'kg', 80],
  ['80 kilogrammes', 'mass', 'kg', 80],
  ['176 lbs', 'mass', 'lb', 176],
  ['176 pounds', 'mass', 'lb', 176],
  ['176#', 'mass', 'lb', 176],
  ['12 st', 'mass', 'st', 12],
  ['5 grains', 'mass', 'gr', 5],
  ['2 troy oz', 'mass', 'ozt', 2],
  ['3 carats', 'mass', 'ct', 3],
  ['500 mcg', 'mass', 'μg', 500],
  ['2 tonnes', 'mass', 't', 2],
  ['2 metric tons', 'mass', 't', 2],

  // temperature
  ['20C', 'temperature', 'C', 20],
  ['20 °C', 'temperature', 'C', 20],
  ['5 °C', 'temperature', 'C', 5, { kind: 'temperature' }],
  ['20 degrees celsius', 'temperature', 'C', 20],
  ['68 degrees fahrenheit', 'temperature', 'F', 68],
  ['68F', 'temperature', 'F', 68],
  ['300 kelvin', 'temperature', 'K', 300],
  ['minus five degrees celsius', 'temperature', 'C', -5],
  ['-5 °C', 'temperature', 'C', -5, { kind: 'temperature' }],
  ['-12.5°C', 'temperature', 'C', -12.5],

  // duration
  ['90 seconds', 'duration', 's', 90],
  ['90 secs', 'duration', 's', 90],
  ['45 mins', 'duration', 'min', 45],
  ['2 hrs', 'duration', 'h', 2],
  ['3 days', 'duration', 'd', 3],
  ['2 weeks', 'duration', 'wk', 2],
  ['a fortnight', 'duration', 'fortnight', 1],
  ['6 months', 'duration', 'mo', 6],
  ['2 years', 'duration', 'yr', 2],
  ['1.5h', 'duration', 'h', 1.5],
  ["12'", 'duration', 'min', 12, { kind: 'duration' }],
  ["45''", 'duration', 's', 45, { kind: 'duration' }],

  // volume
  ['250 ml', 'volume', 'ml', 250],
  ['250mL', 'volume', 'ml', 250],
  ['2 litres', 'volume', 'l', 2],
  ['2L', 'volume', 'l', 2],
  ['3 cups', 'volume', 'cup', 3],
  ['2 tbsp', 'volume', 'tbsp', 2],
  ['1 tsp', 'volume', 'tsp', 1],
  ['12 fl oz', 'volume', 'floz', 12],
  ['12 fl. oz.', 'volume', 'floz', 12],
  ['12 oz', 'volume', 'floz', 12, { kind: 'volume' }],
  ['2 pints', 'volume', 'pt', 2],
  ['1 quart', 'volume', 'qt', 1],
  ['10 gallons', 'volume', 'gal', 10],
  ['5 cc', 'volume', 'cm3', 5],
  ['2 cbm', 'volume', 'm3', 2],
  ['3 cubic meters', 'volume', 'm3', 3],

  // area
  ['50 sq ft', 'area', 'ft2', 50],
  ['50 sqft', 'area', 'ft2', 50],
  ['50 square feet', 'area', 'ft2', 50],
  ['120 m2', 'area', 'm2', 120],
  ['120 m²', 'area', 'm2', 120],
  ['120 sqm', 'area', 'm2', 120],
  ['5 acres', 'area', 'ac', 5],
  ['2 hectares', 'area', 'ha', 2],

  // speed
  ['60 mph', 'speed', 'mph', 60],
  ['100 km/h', 'speed', 'km/h', 100],
  ['100 kph', 'speed', 'km/h', 100],
  ['100kmh', 'speed', 'km/h', 100],
  ['15 knots', 'speed', 'kn', 15],
  ['9.8 m/s', 'speed', 'm/s', 9.8],

  // data
  ['500 GB', 'data', 'GB', 500],
  ['5gig', 'data', 'GB', 5],
  ['500 gigabytes', 'data', 'GB', 500],
  ['2 TiB', 'data', 'TiB', 2],
  ['100 Mbit', 'data', 'Mbit', 100],
  ['8 bits', 'data', 'bit', 8],

  // data rate
  ['5 Mbps', 'data_rate', 'Mbit/s', 5],
  ['10 kbit/s', 'data_rate', 'kbit/s', 10],
  ['1 gigabit per second', 'data_rate', 'Gbit/s', 1],
  ['20 MB/s', 'data_rate', 'MB/s', 20],
  ['2 MiB/s', 'data_rate', 'MiB/s', 2],

  // flow rate
  ['2 liters per second', 'flow_rate', 'l/s', 2],
  ['5 gpm', 'flow_rate', 'gal/min', 5],
  ['250 mL/min', 'flow_rate', 'ml/min', 250],
  ['250 mL per minute', 'flow_rate', 'ml/min', 250],
  ['12 cfm', 'flow_rate', 'ft3/min', 12],
  ['12 cfs', 'flow_rate', 'ft3/s', 12],
  ['3 m3/h', 'flow_rate', 'm3/h', 3],

  // pressure / energy / angle / percent
  ['32 psi', 'pressure', 'psi', 32],
  ['1013 hPa', 'pressure', 'hPa', 1013],
  ['1013 mbar', 'pressure', 'mbar', 1013],
  ['2 bar', 'pressure', 'bar', 2],
  ['120 mmHg', 'pressure', 'mmHg', 120],
  ['760 torr', 'pressure', 'torr', 760],
  ['10 inH2O', 'pressure', 'inH2O', 10],
  ['10 inH₂O', 'pressure', 'inH2O', 10],
  ['20 cmH2O', 'pressure', 'cmH2O', 20],
  ['3 mH2O', 'pressure', 'mH2O', 3],
  ['1 kgf/cm2', 'pressure', 'kgf/cm2', 1],
  ['1 technical atmosphere', 'pressure', 'kgf/cm2', 1],
  ['2000 kcal', 'energy', 'kcal', 2000],
  ['2000 Calories', 'energy', 'kcal', 2000],
  ['500 calories', 'energy', 'cal', 500],
  ['13 kWh', 'energy', 'kWh', 13],
  ['90 degrees', 'angle', 'deg', 90],
  ['1.5 rad', 'angle', 'rad', 1.5],
  ['30%', 'percent', '%', 30],
  ['30 percent', 'percent', '%', 30],

  // currency
  ['50 cents', 'currency', 'USD', 0.5],
  ['50 cents', 'currency', 'EUR', 0.5, { currency: 'EUR' }],
  ['five dollars and fifty cents', 'currency', 'USD', 5.5],
  ['5 dollars 50 cents', 'currency', 'USD', 5.5],
  ['50¢', 'currency', 'USD', 0.5],
  ['50p', 'currency', 'GBP', 0.5],
  ['50 pence', 'currency', 'GBP', 0.5],
  ['3 quid 50', 'currency', 'GBP', 3.5],
  ['3 quid 05', 'currency', 'GBP', 3.05],
  ['3 quid 99', 'currency', 'GBP', 3.99],
  ['5 pounds sterling 25', 'currency', 'GBP', 5.25],
  ['5 pounds 25', 'currency', 'GBP', 5.25, { kind: 'currency' }],

  // electrical / chemistry scientific units
  ['12 V', 'voltage', 'V', 12],
  ['3.3 volts', 'voltage', 'V', 3.3],
  ['500 mV', 'voltage', 'mV', 500],
  ['11 kV', 'voltage', 'kV', 11],
  ['2 amps', 'current', 'A', 2],
  ['500 mA', 'current', 'mA', 500],
  ['25 microamps', 'current', 'μA', 25],
  ['10 ohms', 'resistance', 'Ω', 10],
  ['4.7 kohm', 'resistance', 'kΩ', 4.7],
  ['1 megaohm', 'resistance', 'MΩ', 1],
  ['5 coulombs', 'charge', 'C', 5],
  ['500 mAh', 'charge', 'mAh', 500],
  ['2 Ah', 'charge', 'Ah', 2],
  ['3 moles', 'substance', 'mol', 3],
  ['250 mmol', 'substance', 'mmol', 250],
  ['5 umol', 'substance', 'μmol', 5],
  ['1 M', 'concentration', 'M', 1],
  ['5 mM', 'concentration', 'mM', 5],
  ['5 uM', 'concentration', 'μM', 5],
  ['5 μM', 'concentration', 'μM', 5],
  ['5 µM', 'concentration', 'μM', 5],
  ['1 mol/L', 'concentration', 'mol/l', 1],
  ['1 mol / L', 'concentration', 'mol/l', 1],
  ['1 mol per L', 'concentration', 'mol/l', 1],
  ['1 mol per liter', 'concentration', 'mol/l', 1],
  ['250 mmol/L', 'concentration', 'mmol/l', 250],
  ['250 mmol per L', 'concentration', 'mmol/l', 250],
  ['250 mmol per litre', 'concentration', 'mmol/l', 250],
  ['10 umol per L', 'concentration', 'μmol/l', 10],
  ['1 μmol per liter', 'concentration', 'μmol/l', 1],
  ['1 µmol/L', 'concentration', 'μmol/l', 1],
  ['10 micromolar', 'concentration', 'μM', 10],
  ['9.8 m/s²', 'acceleration', 'm/s2', 9.8],
  ['32 ft/s2', 'acceleration', 'ft/s2', 32],
  ['2 gees', 'acceleration', 'g0', 2],
  ['10 N*m', 'torque', 'N*m', 10],
  ['10 Nm', 'torque', 'N*m', 10],
  ['80 lb-ft', 'torque', 'lbf*ft', 80],
  ['250 cd', 'luminous_intensity', 'cd', 250],
  ['800 lumens', 'luminous_flux', 'lm', 800],
  ['1.2 klm', 'luminous_flux', 'klm', 1.2],
  ['500 lux', 'illuminance', 'lx', 500],
  ['50 foot-candles', 'illuminance', 'fc', 50],
  ['100 nits', 'luminance', 'nit', 100],
  ['300 cd/m2', 'luminance', 'cd/m2', 300],
  ['14 fL', 'luminance', 'fL', 14],
  ['2 Gy', 'radiation_absorbed_dose', 'Gy', 2],
  ['500 mGy', 'radiation_absorbed_dose', 'mGy', 500],
  ['20 mSv', 'radiation_equivalent_dose', 'mSv', 20],
  ['2 rem', 'radiation_equivalent_dose', 'rem', 2],
  ['100 Bq', 'radioactivity', 'Bq', 100],
  ['5 MBq', 'radioactivity', 'MBq', 5],
  ['2 uCi', 'radioactivity', 'μCi', 2],

  // numbers in the wild
  ['1 234,5 kg', 'mass', 'kg', 1234.5],
  ['12,34,567 m', 'length', 'm', 1_234_567],
  ['70k km', 'length', 'km', 70_000],
  ['1×10⁻³ kg', 'mass', 'kg', 0.001],
  ['2.5×10⁻⁴ m', 'length', 'm', 2.5e-4],
  ['¾ cup', 'volume', 'cup', 0.75],
  ['a dozen inches', 'length', 'in', 12],
  ['half a dozen feet', 'length', 'ft', 6],
  ['one hundred and five kg', 'mass', 'kg', 105],

  // natural phrasing — digit-literal negation, fraction-of-a-unit, mid-value "ish"
  ['minus 5 kg', 'mass', 'kg', -5],
  ['negative 5 kg', 'mass', 'kg', -5],
  ['minus 20 celsius', 'temperature', 'C', -20],
  ['a quarter of a mile', 'length', 'mi', 0.25],
  ['two thirds of a meter', 'length', 'm', 2 / 3],
  ['a third of an hour', 'duration', 'h', 1 / 3],
  ['three quarters of a mile', 'length', 'mi', 0.75],
  ['5ish kg', 'mass', 'kg', 5],
  ['5 ish kg', 'mass', 'kg', 5],
]

describe('breadth corpus — quantities', () => {
  for (const [input, kind, unit, value, opts] of QUANTITIES) {
    it(JSON.stringify(input), () => {
      const r = lingo(input, opts)
      if (!r.ok) {
        throw new Error(`failed: ${JSON.stringify(r.issues)}`)
      }
      if (r.type !== 'quantity') {
        throw new Error(`expected quantity, got ${r.type}`)
      }
      expect(r.quantity.kind).toBe(kind)
      expect(r.quantity.unit).toBe(unit)
      expect(r.quantity.value).toBeCloseTo(value, 9)
    })
  }
})

type FRow = [input: string, code: string, opts?: LingoOptions]

const FAILURES: FRow[] = [
  ['', 'EMPTY'],
  ['   ', 'EMPTY'],
  ['banana', 'NO_VALUE'],
  ['5 blorks', 'UNKNOWN_UNIT', {}],
  ['5 kg extra words', 'TRAILING_INPUT'],
  ['5 kg', 'KIND_MISMATCH', { kind: 'length' }],
  ['5 kg to seconds', 'CONVERSION_KIND_MISMATCH'],
  ['3 and kg', 'TRAILING_INPUT'],
  ['5 C 30 F', 'TRAILING_INPUT', { kind: 'temperature' }],
  ['99999999999999999999999 kg', 'NONFINITE'],
]

describe('breadth corpus — failures carry the right code', () => {
  for (const [input, code, opts] of FAILURES) {
    it(`${JSON.stringify(input)} → ${code}`, () => {
      const r = lingo(input, opts)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(
          r.issues.some((i) => i.code === code),
          `got: ${r.issues.map((i) => i.code).join(',')}`,
        ).toBe(true)
      }
    })
  }
})

type HazardRow = [input: string, code: string, opts?: LingoOptions]

const DEFERRED_UNIT_HAZARDS: HazardRow[] = [
  ['1013 mb', 'AMBIGUOUS_UNIT'],
  ['1013 mb', 'UNKNOWN_UNIT', { kind: 'pressure' }],
  ['1 kg/cm²', 'TRAILING_INPUT'],
  ['5 psig', 'UNKNOWN_UNIT', { kind: 'pressure' }],
  ['5 psia', 'UNKNOWN_UNIT', { kind: 'pressure' }],
  ['5 NM', 'UNKNOWN_UNIT'],
  ['12 oz', 'AMBIGUOUS_UNIT'],
  ['3 quid 100', 'COMPOUND_OVERFLOW'],
  ['5 USD 10', 'TRAILING_INPUT'],
  ['1M', 'UNKNOWN_UNIT'],
  ['1 MC', 'UNKNOWN_UNIT'],
  ['1 MAh', 'UNKNOWN_UNIT'],
  ['1 UC', 'UNKNOWN_UNIT'],
  ['1 ah', 'UNKNOWN_UNIT'],
  ['10 V/A', 'TRAILING_INPUT'],
  ['1 C/s', 'TRAILING_INPUT'],
  ['5 Ω*m', 'TRAILING_INPUT'],
  ['1 rad', 'KIND_MISMATCH', { kind: 'radiation_absorbed_dose' }],
  ['1 gy', 'UNKNOWN_UNIT', { kind: 'radiation_absorbed_dose' }],
  ['1 sv', 'UNKNOWN_UNIT', { kind: 'radiation_equivalent_dose' }],
  ['1 bq', 'UNKNOWN_UNIT', { kind: 'radioactivity' }],
  ['1 ci', 'UNKNOWN_UNIT', { kind: 'radioactivity' }],
]

describe('breadth corpus — deferred unit hazards do not parse silently', () => {
  for (const [input, code, opts] of DEFERRED_UNIT_HAZARDS) {
    it(`${JSON.stringify(input)} carries ${code}`, () => {
      const r = lingo(input, opts)
      expect(
        r.issues.some((issue) => issue.code === code),
        `got ok=${r.ok} type=${r.type} issues=${r.issues.map((issue) => issue.code).join(',')}`,
      ).toBe(true)
    })
  }
})

describe('breadth corpus — behaviors', () => {
  it('keeps glued C as Celsius, warns on spaced C, and resolves coulomb under charge context', () => {
    const glued = lingo('20C')
    if (!glued.ok || glued.type !== 'quantity') {
      throw new Error('expected glued Celsius quantity')
    }
    expect(glued.quantity.kind).toBe('temperature')
    expect(glued.quantity.unit).toBe('C')
    expect(glued.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)

    const temperature = lingo('5 C')
    if (!temperature.ok || temperature.type !== 'quantity') {
      throw new Error('expected default C quantity')
    }
    expect(temperature.quantity.kind).toBe('temperature')
    expect(temperature.quantity.unit).toBe('C')
    expect(temperature.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')).toMatchObject({
      data: { assumed: 'degree Celsius' },
      suggestions: ['coulomb (charge)'],
    })

    const confirm = lingo('5 C', { strictness: 'confirm' })
    expect(confirm.ok).toBe(false)
    if (confirm.ok) {
      throw new Error('expected confirm-mode C ambiguity failure')
    }
    expect(confirm.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')?.severity).toBe('error')
    expect(confirm.candidate?.type).toBe('quantity')

    const charge = lingo('5 C', { kind: 'charge' })
    if (!charge.ok || charge.type !== 'quantity') {
      throw new Error('expected charge C quantity')
    }
    expect(charge.quantity.kind).toBe('charge')
    expect(charge.quantity.unit).toBe('C')
  })

  it('keeps concentration exact-case shorthands from stealing length units', () => {
    const meter = lingo('5 m')
    if (!meter.ok || meter.type !== 'quantity') {
      throw new Error('expected meter quantity')
    }
    expect(meter.quantity.kind).toBe('length')
    expect(meter.quantity.unit).toBe('m')

    const molar = lingo('5 M')
    if (!molar.ok || molar.type !== 'quantity') {
      throw new Error('expected molar quantity')
    }
    expect(molar.quantity.kind).toBe('concentration')
    expect(molar.quantity.unit).toBe('M')

    const millimeter = lingo('5 mm')
    if (!millimeter.ok || millimeter.type !== 'quantity') {
      throw new Error('expected millimeter quantity')
    }
    expect(millimeter.quantity.kind).toBe('length')
    expect(millimeter.quantity.unit).toBe('mm')

    const millimolar = lingo('5 mM')
    if (!millimolar.ok || millimolar.type !== 'quantity') {
      throw new Error('expected millimolar quantity')
    }
    expect(millimolar.quantity.kind).toBe('concentration')
    expect(millimolar.quantity.unit).toBe('mM')

    const micrometerAscii = lingo('5 um')
    if (!micrometerAscii.ok || micrometerAscii.type !== 'quantity') {
      throw new Error('expected ascii micrometer quantity')
    }
    expect(micrometerAscii.quantity.kind).toBe('length')
    expect(micrometerAscii.quantity.unit).toBe('μm')

    const micromolarAscii = lingo('5 uM')
    if (!micromolarAscii.ok || micromolarAscii.type !== 'quantity') {
      throw new Error('expected ascii micromolar quantity')
    }
    expect(micromolarAscii.quantity.kind).toBe('concentration')
    expect(micromolarAscii.quantity.unit).toBe('μM')

    const micrometer = lingo('5 μm')
    if (!micrometer.ok || micrometer.type !== 'quantity') {
      throw new Error('expected micrometer quantity')
    }
    expect(micrometer.quantity.kind).toBe('length')
    expect(micrometer.quantity.unit).toBe('μm')

    const micromolar = lingo('5 μM')
    if (!micromolar.ok || micromolar.type !== 'quantity') {
      throw new Error('expected micromolar quantity')
    }
    expect(micromolar.quantity.kind).toBe('concentration')
    expect(micromolar.quantity.unit).toBe('μM')

    const micromolarSign = lingo('5 µM')
    if (!micromolarSign.ok || micromolarSign.type !== 'quantity') {
      throw new Error('expected micro-sign micromolar quantity')
    }
    expect(micromolarSign.quantity.kind).toBe('concentration')
    expect(micromolarSign.quantity.unit).toBe('μM')

    const gluedWithKind = lingo('1M', { kind: 'concentration' })
    if (!gluedWithKind.ok || gluedWithKind.type !== 'quantity') {
      throw new Error('expected concentration-context glued molar quantity')
    }
    expect(gluedWithKind.quantity.unit).toBe('M')

    expect(lingo('5 NM').ok).toBe(false)
  })

  it('keeps new scientific shorthand hazards explicit', () => {
    const nanometer = lingo('10 nm')
    if (!nanometer.ok || nanometer.type !== 'quantity') {
      throw new Error('expected nanometer quantity')
    }
    expect(nanometer.quantity.kind).toBe('length')
    expect(nanometer.quantity.unit).toBe('nm')

    const newtonMeter = lingo('10 Nm')
    if (!newtonMeter.ok || newtonMeter.type !== 'quantity') {
      throw new Error('expected torque quantity')
    }
    expect(newtonMeter.quantity.kind).toBe('torque')
    expect(newtonMeter.quantity.unit).toBe('N*m')

    const gram = lingo('2 g')
    if (!gram.ok || gram.type !== 'quantity') {
      throw new Error('expected gram quantity')
    }
    expect(gram.quantity.kind).toBe('mass')
    expect(gram.quantity.unit).toBe('g')

    const absorbedRad = lingo('1 rad', { kind: 'radiation_absorbed_dose' })
    expect(absorbedRad.ok).toBe(false)

    for (const text of ['10 V/A', '1 C/s', '5 Ω*m']) {
      expect(lingo(text).ok, `${text} should remain outside unit algebra`).toBe(false)
    }
  })

  it('keeps pressure gauge/absolute suffixes deferred instead of typo-correcting them', () => {
    for (const text of ['5 psig', '5 psia']) {
      const result = lingo(text, { kind: 'pressure' })
      expect(result.ok, `${text} should not become plain psi`).toBe(false)
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.code === 'UNKNOWN_UNIT')).toBe(true)
      }
    }
  })

  it('keeps bare pounds as mass outside explicit currency context', () => {
    const mass = lingo('5 pounds 25')
    if (!mass.ok || mass.type !== 'quantity') {
      throw new Error('expected bare pounds to remain a mass quantity')
    }
    expect(mass.quantity.kind).toBe('mass')
    expect(mass.quantity.unit).toBe('lb')
    expect(mass.issues.some((issue) => issue.code === 'COMPOUND_OVERFLOW')).toBe(true)

    const currency = lingo('5 pounds 25', { kind: 'currency' })
    if (!currency.ok || currency.type !== 'quantity') {
      throw new Error('expected currency-context pounds to parse as GBP')
    }
    expect(currency.quantity.kind).toBe('currency')
    expect(currency.quantity.unit).toBe('GBP')
    expect(currency.quantity.value).toBeCloseTo(5.25, 12)
  })

  it('unknown unit with kind context suggests corrections', () => {
    const r = lingo('5 killograms', { kind: 'mass' })
    if (r.ok) {
      // typo-corrected path is fine too
      expect(r.type).toBe('quantity')
    } else {
      const u = r.issues.find((i) => i.code === 'UNKNOWN_UNIT')
      expect(u?.suggestions?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('imperial system option remaps the gallon family', () => {
    const r = lingo('10 gallons', { system: 'imperial' })
    if (!r.ok || r.type !== 'quantity') {
      throw new Error('expected quantity')
    }
    expect(r.quantity.unit).toBe('gal-imp')
    expect(r.quantity.valueIn('l')).toBeCloseTo(45.4609, 9)
  })

  it('conversion phrasings all work', () => {
    for (const text of [
      '2 ft to cm',
      '2 ft in cm',
      '2ft as cm',
      '2 ft into cm',
      '2ft = cm',
      '2 ft → cm',
      '2ft -> cm',
    ]) {
      const r = lingo(text)
      if (!r.ok || r.type !== 'conversion') {
        throw new Error(`${text}: ${JSON.stringify(r)}`)
      }
      expect((r.converted as { value: number }).value).toBeCloseTo(60.96, 9)
    }
  })

  it('percent is rejected in a length field', () => {
    const r = lingo('15%', { kind: 'length' })
    expect(r.ok).toBe(false)
  })

  it('keeps bare bps as basis points and uses bit/s for data rates', () => {
    const finance = lingo('25 bps')
    if (!finance.ok || finance.type !== 'quantity') {
      throw new Error('expected basis-point quantity')
    }
    expect(finance.quantity.kind).toBe('percent')
    expect(finance.quantity.unit).toBe('bps')
    expect(finance.quantity.to('%').value).toBeCloseTo(0.25, 12)

    const network = lingo('25 bit/s')
    if (!network.ok || network.type !== 'quantity') {
      throw new Error('expected data-rate quantity')
    }
    expect(network.quantity.kind).toBe('data_rate')
    expect(network.quantity.unit).toBe('bit/s')

    const explicit = lingo('25 bps', { kind: 'data_rate' })
    expect(explicit.ok).toBe(false)
    if (!explicit.ok) {
      expect(explicit.issues.some((issue) => issue.code === 'KIND_MISMATCH')).toBe(true)
    }
  })

  it('keeps data-rate abbreviations case-sensitive where bits and bytes diverge', () => {
    const megabits = lingo('5 Mbps')
    const casualMegabits = lingo('5 mbps')
    const megabytes = lingo('5 MBps')
    if (!megabits.ok || megabits.type !== 'quantity') {
      throw new Error('expected Mbps quantity')
    }
    if (!casualMegabits.ok || casualMegabits.type !== 'quantity') {
      throw new Error('expected mbps quantity')
    }
    if (!megabytes.ok || megabytes.type !== 'quantity') {
      throw new Error('expected MBps quantity')
    }
    expect(megabits.quantity.kind).toBe('data_rate')
    expect(megabits.quantity.unit).toBe('Mbit/s')
    expect(casualMegabits.quantity.kind).toBe('data_rate')
    expect(casualMegabits.quantity.unit).toBe('Mbit/s')
    expect(megabytes.quantity.kind).toBe('data_rate')
    expect(megabytes.quantity.unit).toBe('MB/s')
    expect(megabytes.quantity.base / megabits.quantity.base).toBe(8)

    const wrongMegaSlash = lingo('5 mb/s')
    expect(wrongMegaSlash.ok, '5 mb/s should not parse silently').toBe(false)

    const slashCases: Array<[text: string, unit: string]> = [
      ['5 b/s', 'bit/s'],
      ['5 bits/s', 'bit/s'],
      ['5 Kb/s', 'kbit/s'],
      ['5 Mb/s', 'Mbit/s'],
      ['5 byte/s', 'B/s'],
      ['5 megabit/s', 'Mbit/s'],
    ]
    for (const [text, unit] of slashCases) {
      const r = lingo(text)
      if (!r.ok || r.type !== 'quantity') {
        throw new Error(`${text} should parse as data rate`)
      }
      expect(r.quantity.kind).toBe('data_rate')
      expect(r.quantity.unit).toBe(unit)
    }

    expect(lingo('10 kbit/s').ok).toBe(true)
    expect(lingo('10 Kbit/s').ok).toBe(true)
    expect(lingo('10 kbps').ok).toBe(true)
    expect(lingo('10 Kbps').ok).toBe(true)
  })

  it('keeps flow-rate shorthand explicit without accepting hazardous mega-liter casing', () => {
    const accepted: Array<[text: string, unit: string]> = [
      ['250 mL/min', 'ml/min'],
      ['250 ml/min', 'ml/min'],
      ['250 mL per minute', 'ml/min'],
      ['5 L per min', 'l/min'],
      ['2 L per s', 'l/s'],
      ['2 L / s', 'l/s'],
      ['12 cu ft per min', 'ft3/min'],
      ['12 cubic feet/min', 'ft3/min'],
      ['3 m3 per hour', 'm3/h'],
      ['3 m^3/hour', 'm3/h'],
    ]
    for (const [text, unit] of accepted) {
      const r = lingo(text, { kind: 'flow_rate' })
      if (!r.ok || r.type !== 'quantity') {
        throw new Error(`${text} should parse as flow rate`)
      }
      expect(r.quantity.kind).toBe('flow_rate')
      expect(r.quantity.unit).toBe(unit)
    }

    for (const text of ['250 ML/min', '250 Ml/min']) {
      const r = lingo(text, { kind: 'flow_rate' })
      expect(r.ok, `${text} should not silently parse as milliliters per minute`).toBe(false)
    }
  })

  it('uses imperial gallons per minute only under explicit wording or imperial system context', () => {
    const us = lingo('5 gpm')
    const imperialSystem = lingo('5 gpm', { system: 'imperial' })
    const imperialText = lingo('5 imperial gpm')

    if (
      !us.ok ||
      us.type !== 'quantity' ||
      !imperialSystem.ok ||
      imperialSystem.type !== 'quantity' ||
      !imperialText.ok ||
      imperialText.type !== 'quantity'
    ) {
      throw new Error('expected gpm variants to parse')
    }

    expect(us.quantity.unit).toBe('gal/min')
    expect(imperialSystem.quantity.unit).toBe('gal-imp/min')
    expect(imperialText.quantity.unit).toBe('gal-imp/min')
    expect(imperialSystem.quantity.base).toBeGreaterThan(us.quantity.base)
  })

  it('range with per-side units validates kind', () => {
    const r = lingo('5 kg to 10 g')
    if (!r.ok || r.type !== 'range') {
      throw new Error('expected range')
    }
    expect(r.range.minBase).toBeCloseTo(0.01, 9) // reversed + swapped: 10 g
    expect(r.range.maxBase).toBeCloseTo(5, 9)
    expect(r.issues.some((i) => i.code === 'RANGE_REVERSED')).toBe(true)
  })

  it('warns instead of folding overflowing explicit compound tails', () => {
    const r = lingo('5 ft 13 in')
    if (!r.ok || r.type !== 'quantity') {
      throw new Error('expected quantity')
    }
    expect(r.quantity.unit).toBe('ft')
    expect(r.quantity.value).toBeCloseTo(5, 12)
    expect(r.issues.some((i) => i.code === 'COMPOUND_OVERFLOW')).toBe(true)
  })

  it('keeps plus-minus temperature conversion in delta semantics', () => {
    const r = lingo('10 ± 0.5 °C to °F', { kind: 'temperature' })
    if (!r.ok || r.type !== 'conversion' || !('plusMinus' in r.converted)) {
      throw new Error(`expected plus-minus conversion, got ${JSON.stringify(r)}`)
    }
    expect(r.converted.center()?.value).toBeCloseTo(50, 12)
    expect(r.converted.widthIn('F')).toBeCloseTo(1.8, 12)
  })

  it('spans point into the original string even with unicode', () => {
    const input = '½ flurbs'
    const r = lingo(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      for (const i of r.issues) {
        if (i.span) {
          expect(i.span.start).toBeGreaterThanOrEqual(0)
          expect(i.span.end).toBeLessThanOrEqual(input.length)
        }
      }
    }
  })
})
