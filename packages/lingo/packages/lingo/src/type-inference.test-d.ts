import {
  type AliasByKind,
  type BuiltinKind,
  type BuiltinUnitRef,
  convert,
  convertCurrency,
  convertDelta,
  createLingo,
  defaultRegistry,
  fromMinor,
  type KindDef,
  type KindOfUnit,
  QuantityRange,
  quantity,
  type TryConvertResult,
  tryConvert,
  type UnitIdByKind,
  type UnitRefByKind,
} from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

declare const dynamicKind: string
declare const dynamicTo: string
declare const dynamicUnit: string

const lengthUnit = 'cm' satisfies UnitIdByKind<'length'>
const massAlias = 'kilos' satisfies AliasByKind<'mass'>
const volumeRef = 'L' satisfies UnitRefByKind<'volume'>
const builtinRef = 'kg' satisfies BuiltinUnitRef
const currencyRef = 'USD' satisfies UnitRefByKind<'currency'>
const dataRateRef = 'Mbps' satisfies UnitRefByKind<'data_rate'>
const flowRateRef = 'gpm' satisfies UnitRefByKind<'flow_rate'>
const voltageRef = 'mV' satisfies UnitRefByKind<'voltage'>
const currentRef = 'mA' satisfies UnitRefByKind<'current'>
const resistanceRef = 'kΩ' satisfies UnitRefByKind<'resistance'>
const chargeRef = 'mAh' satisfies UnitRefByKind<'charge'>
const substanceRef = 'mmol' satisfies UnitRefByKind<'substance'>
const concentrationRef = 'uM' satisfies UnitRefByKind<'concentration'>
const microSignConcentrationRef = 'µM' satisfies UnitRefByKind<'concentration'>
const microSignPerLiterRef = 'µmol/L' satisfies UnitRefByKind<'concentration'>

type _LengthUnitKind = Expect<Equal<KindOfUnit<typeof lengthUnit>, 'length'>>
type _MassAliasKind = Expect<Equal<KindOfUnit<typeof massAlias>, 'mass'>>
type _VolumeRefKind = Expect<Equal<KindOfUnit<typeof volumeRef>, 'volume'>>
type _BuiltinRefKind = Expect<Equal<KindOfUnit<typeof builtinRef>, 'mass'>>
type _KgKind = Expect<Equal<KindOfUnit<'kg'>, 'mass'>>
type _CmKind = Expect<Equal<KindOfUnit<'cm'>, 'length'>>
type _LiterKind = Expect<Equal<KindOfUnit<'L'>, 'volume'>>
type _UsdKind = Expect<Equal<KindOfUnit<typeof currencyRef>, 'currency'>>
type _DataRateKind = Expect<Equal<KindOfUnit<typeof dataRateRef>, 'data_rate'>>
type _FlowRateKind = Expect<Equal<KindOfUnit<typeof flowRateRef>, 'flow_rate'>>
type _VoltageKind = Expect<Equal<KindOfUnit<typeof voltageRef>, 'voltage'>>
type _CurrentKind = Expect<Equal<KindOfUnit<typeof currentRef>, 'current'>>
type _ResistanceKind = Expect<Equal<KindOfUnit<typeof resistanceRef>, 'resistance'>>
type _ChargeKind = Expect<Equal<KindOfUnit<typeof chargeRef>, 'charge'>>
type _SubstanceKind = Expect<Equal<KindOfUnit<typeof substanceRef>, 'substance'>>
type _ConcentrationKind = Expect<Equal<KindOfUnit<typeof concentrationRef>, 'concentration'>>
type _MicroSignConcentrationKind = Expect<
  Equal<KindOfUnit<typeof microSignConcentrationRef>, 'concentration'>
>
type _MicroSignPerLiterKind = Expect<
  Equal<KindOfUnit<typeof microSignPerLiterRef>, 'concentration'>
>

const converted = convert(5, 'in', 'cm')
const tried = tryConvert(5, 'in', 'cm')
const delta = convertDelta(5, 'C', 'F')
const kilograms = quantity(5, 'kg')
const centimeters = quantity(5, 'cm', 'length')
const minorUsd = fromMinor(500, 'USD')
const megabits = quantity(5, 'Mbps')
const gallonsPerMinute = quantity(5, 'gpm')
const volts = quantity(500, 'mV')
const amps = quantity(500, 'mA')
const ohms = quantity(4.7, 'kΩ')
const coulombs = quantity(500, 'mAh')
const moles = quantity(250, 'mmol')
const micromolar = quantity(5, 'uM')
const fx = convertCurrency(100, 'USD', 'EUR', {
  rates: { base: 'USD', rates: { USD: 1, EUR: 0.9 } },
})
const builtInInstance = createLingo()
const instanceKilograms = builtInInstance.quantity(5, 'kg')
const instanceConverted = builtInInstance.convert(5, 'in', 'cm')
const instanceTried = builtInInstance.tryConvert(5, 'in', 'cm')
const instanceMinorUsd = builtInInstance.fromMinor(500, 'USD')
const kilogramRange = new QuantityRange(defaultRegistry, 'mass', {
  min: { base: 5, unit: 'kg' },
  max: { base: 10, unit: 'kg' },
})

const widgetKind = {
  kind: 'widget',
  baseUnit: 'widget',
  units: [
    { id: 'widget', symbol: 'wdg', name: 'widget', factor: 1, system: 'shared' },
    { id: 'box', symbol: 'box', name: 'box', factor: 12, system: 'shared' },
  ],
} satisfies KindDef
const customInstance = createLingo({ kinds: [widgetKind] })

type _ConvertedIsNumber = Expect<Equal<typeof converted, number>>
type _TriedIsResult = Expect<Equal<typeof tried, TryConvertResult>>
type _DeltaIsNumber = Expect<Equal<typeof delta, number>>
type _KilogramsKind = Expect<Equal<typeof kilograms.kind, 'mass'>>
type _CentimetersKind = Expect<Equal<typeof centimeters.kind, 'length'>>
type _MinorUsdKind = Expect<Equal<typeof minorUsd.kind, 'currency'>>
type _MegabitsKind = Expect<Equal<typeof megabits.kind, 'data_rate'>>
type _GallonsPerMinuteKind = Expect<Equal<typeof gallonsPerMinute.kind, 'flow_rate'>>
type _VoltsKind = Expect<Equal<typeof volts.kind, 'voltage'>>
type _AmpsKind = Expect<Equal<typeof amps.kind, 'current'>>
type _OhmsKind = Expect<Equal<typeof ohms.kind, 'resistance'>>
type _CoulombsKind = Expect<Equal<typeof coulombs.kind, 'charge'>>
type _MolesKind = Expect<Equal<typeof moles.kind, 'substance'>>
type _MicromolarKind = Expect<Equal<typeof micromolar.kind, 'concentration'>>
type _FxIsNumber = Expect<Equal<typeof fx, number>>
type _InstanceKilogramsKind = Expect<Equal<typeof instanceKilograms.kind, 'mass'>>
type _InstanceConvertedIsNumber = Expect<Equal<typeof instanceConverted, number>>
type _InstanceTriedIsResult = Expect<Equal<typeof instanceTried, TryConvertResult>>
type _InstanceMinorUsdKind = Expect<Equal<typeof instanceMinorUsd.kind, 'currency'>>

kilograms.to('lb')
kilograms.to(dynamicTo)
kilogramRange.to('lb')
kilogramRange.to(dynamicTo)
quantity(5, dynamicUnit)
quantity(5, dynamicUnit, 'length')
quantity(5, 'kg', dynamicKind)
convert(5, dynamicUnit, 'cm')
convert(5, 'kg', dynamicTo)
tryConvert(5, dynamicUnit, 'cm')
tryConvert(5, 'kg', dynamicTo)
convertDelta(5, dynamicUnit, 'cm')
convertDelta(5, 'kg', dynamicTo)
fromMinor(500, dynamicUnit)
convertCurrency(100, dynamicUnit, 'EUR', { rates: { base: 'USD', rates: { USD: 1, EUR: 0.9 } } })
convertCurrency(100, 'USD', dynamicTo, { rates: { base: 'USD', rates: { USD: 1, EUR: 0.9 } } })
customInstance.quantity(1, 'widget')
customInstance.convert(1, 'widget', 'box')
customInstance.tryConvert(1, 'widget', 'box')

// @ts-expect-error cross-kind conversion is rejected for literal refs.
convert(5, 'kg', 'cm')

// @ts-expect-error tryConvert uses the same literal kind check as convert().
tryConvert(5, 'kg', 'cm')

// @ts-expect-error delta conversion uses the same kind constraint.
convertDelta(5, 'kg', 'cm')

// @ts-expect-error Quantity.to rejects cross-kind literal targets.
kilograms.to('cm')

// @ts-expect-error QuantityRange.to rejects cross-kind literal targets.
kilogramRange.to('cm')

// @ts-expect-error a literal unit must belong to the literal kind.
quantity(5, 'kg', 'length')

// @ts-expect-error unknown literal units are rejected.
quantity(5, 'nope')

// @ts-expect-error built-in instances keep the same unit-kind check as top-level convert().
builtInInstance.convert(5, 'kg', 'cm')

// @ts-expect-error built-in instances keep the same unit-kind check as top-level tryConvert().
builtInInstance.tryConvert(5, 'kg', 'cm')

// @ts-expect-error built-in instances keep the same literal-unit check as top-level quantity().
builtInInstance.quantity(5, 'nope')

// @ts-expect-error literal currency codes must be known built-in currency refs.
fromMinor(500, 'nope')

// @ts-expect-error literal currency conversion codes must be known built-in currency refs.
convertCurrency(100, 'nope', 'EUR', { rates: { base: 'USD', rates: { USD: 1, EUR: 0.9 } } })

// --- Cross-kind colliding refs resolve to the SINGLE runtime kind, not a union.
// These are the refs a real user hits (oz, C, R, "); before KindOfUnit walked
// the kind tuple they widened to a union and let cross-kind conversions compile.
type _OzResolvesToMass = Expect<Equal<KindOfUnit<'oz'>, 'mass'>>
type _CelsiusResolvesToTemperature = Expect<Equal<KindOfUnit<'C'>, 'temperature'>>
type _RankineResolvesToTemperature = Expect<Equal<KindOfUnit<'R'>, 'temperature'>>
type _DoubleQuoteResolvesToLength = Expect<Equal<KindOfUnit<'"'>, 'length'>>
const ozQuantity = quantity(5, 'oz')
type _OzQuantityKindIsMass = Expect<Equal<typeof ozQuantity.kind, 'mass'>>

// A colliding ref only converts within its resolved kind — the runtime throw
// `convert(5, 'oz', 'ml')` used to hit is now a compile error.
// @ts-expect-error oz resolves to mass, so a volume target is rejected.
convert(5, 'oz', 'ml')
// @ts-expect-error C resolves to temperature, so a charge target is rejected.
convert(5, 'C', 'mAh')
convert(5, 'oz', 'kg') // same-kind conversion for a colliding ref still compiles.

// --- Every built-in kind carries literal inference (not just the original 12).
// Representative non-colliding ref per kind; a removed/renamed kind breaks here.
type _TemperatureKind = Expect<Equal<KindOfUnit<'kelvin'>, 'temperature'>>
type _DurationKind = Expect<Equal<KindOfUnit<'hour'>, 'duration'>>
type _AreaKind = Expect<Equal<KindOfUnit<'acre'>, 'area'>>
type _SpeedKind = Expect<Equal<KindOfUnit<'mph'>, 'speed'>>
type _DataKind = Expect<Equal<KindOfUnit<'GB'>, 'data'>>
type _AccelerationKind = Expect<Equal<KindOfUnit<'m/s2'>, 'acceleration'>>
type _PressureKind = Expect<Equal<KindOfUnit<'psi'>, 'pressure'>>
type _EnergyKind = Expect<Equal<KindOfUnit<'kWh'>, 'energy'>>
type _ForceKind = Expect<Equal<KindOfUnit<'newton'>, 'force'>>
type _TorqueKind = Expect<Equal<KindOfUnit<'newton meter'>, 'torque'>>
type _PowerKind = Expect<Equal<KindOfUnit<'kW'>, 'power'>>
type _FrequencyKind = Expect<Equal<KindOfUnit<'kHz'>, 'frequency'>>
type _AngleKind = Expect<Equal<KindOfUnit<'degree'>, 'angle'>>
type _PercentKind = Expect<Equal<KindOfUnit<'percent'>, 'percent'>>
type _LuminousIntensityKind = Expect<Equal<KindOfUnit<'cd'>, 'luminous_intensity'>>
type _LuminousFluxKind = Expect<Equal<KindOfUnit<'lm'>, 'luminous_flux'>>
type _IlluminanceKind = Expect<Equal<KindOfUnit<'lx'>, 'illuminance'>>
type _LuminanceKind = Expect<Equal<KindOfUnit<'nit'>, 'luminance'>>
type _AbsorbedDoseKind = Expect<Equal<KindOfUnit<'Gy'>, 'radiation_absorbed_dose'>>
type _EquivalentDoseKind = Expect<Equal<KindOfUnit<'Sv'>, 'radiation_equivalent_dose'>>
type _RadioactivityKind = Expect<Equal<KindOfUnit<'Bq'>, 'radioactivity'>>

// The metric-prefix hazard units added to close the silent wrong-magnitude bug
// carry literal inference to their own kind.
type _MegagramKind = Expect<Equal<KindOfUnit<'Mg'>, 'mass'>>
type _MegameterKind = Expect<Equal<KindOfUnit<'Mm'>, 'length'>>
type _MillihertzKind = Expect<Equal<KindOfUnit<'mHz'>, 'frequency'>>
type _MillipascalKind = Expect<Equal<KindOfUnit<'mPa'>, 'pressure'>>
type _MegabarKind = Expect<Equal<KindOfUnit<'Mbar'>, 'pressure'>>
type _MillijouleKind = Expect<Equal<KindOfUnit<'mJ'>, 'energy'>>

// --- Drift gate: every kind must have at least one literal unit id, and the
// covered set below must equal BuiltinKind. Add a new kind → it must appear
// here (and above) or these two lines fail to compile.
type _EveryKindHasUnitIds = Expect<
  Equal<{ [K in BuiltinKind]: UnitIdByKind<K> extends never ? K : never }[BuiltinKind], never>
>
type CoveredKind =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'duration'
  | 'volume'
  | 'area'
  | 'speed'
  | 'data'
  | 'data_rate'
  | 'flow_rate'
  | 'acceleration'
  | 'pressure'
  | 'energy'
  | 'force'
  | 'torque'
  | 'power'
  | 'frequency'
  | 'angle'
  | 'percent'
  | 'luminous_intensity'
  | 'luminous_flux'
  | 'illuminance'
  | 'luminance'
  | 'voltage'
  | 'current'
  | 'resistance'
  | 'charge'
  | 'substance'
  | 'concentration'
  | 'radiation_absorbed_dose'
  | 'radiation_equivalent_dose'
  | 'radioactivity'
  | 'currency'
type _AllBuiltinKindsCovered = Expect<Equal<CoveredKind, BuiltinKind>>
