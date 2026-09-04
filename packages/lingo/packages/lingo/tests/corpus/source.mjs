export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  ['5 meters'],
  ['5 metres'],
  ['5m'],
  ['12 km'],
  ['3 klicks', { kind: 'length' }],
  ['0.5 mm'],
  ['25 microns'],
  ['25 um'],
  ['6 yd'],
  ['2 miles'],
  ['1 nautical mile'],
  ['3 hands'],
  ['15 thou'],
  ['1 light year'],
  ['2 fathoms'],
  ['6 ft.'],
  ['6 feet'],
  ['six foot'],
  ["6'"],
  ['11"', { kind: 'length' }],
  ['72 inches'],
  ['72in'],
  ['80 kg'],
  ['80 kilos'],
  ['80 kilogrammes'],
  ['176 lbs'],
  ['176 pounds'],
  ['176#'],
  ['12 st'],
  ['5 grains'],
  ['2 troy oz'],
  ['3 carats'],
  ['500 mcg'],
  ['2 tonnes'],
  ['2 metric tons'],
  ['20C'],
  ['5 C'],
  ['20 °C'],
  ['5 °C', { kind: 'temperature' }],
  ['20 degrees celsius'],
  ['68 degrees fahrenheit'],
  ['68F'],
  ['300 kelvin'],
  ['minus five degrees celsius'],
  ['-5 °C', { kind: 'temperature' }],
  ['-12.5°C'],
  ['90 seconds'],
  ['90 secs'],
  ['45 mins'],
  ['2 hrs'],
  ['3 days'],
  ['2 weeks'],
  ['a fortnight'],
  ['6 months'],
  ['2 years'],
  ['1.5h'],
  ["12'", { kind: 'duration' }],
  ["45''", { kind: 'duration' }],
  ['250 ml'],
  ['250mL'],
  ['2 litres'],
  ['2L'],
  ['3 cups'],
  ['2 tbsp'],
  ['1 tsp'],
  ['12 fl oz'],
  ['12 fl. oz.'],
  ['12 oz', { kind: 'volume' }],
  ['2 pints'],
  ['1 quart'],
  ['10 gallons'],
  ['5 cc'],
  ['2 cbm'],
  ['3 cubic meters'],
  ['50 sq ft'],
  ['50 sqft'],
  ['50 square feet'],
  ['120 m2'],
  ['120 m²'],
  ['120 sqm'],
  ['5 acres'],
  ['2 hectares'],
  ['60 mph'],
  ['100 km/h'],
  ['100 kph'],
  ['100kmh'],
  ['15 knots'],
  ['9.8 m/s'],
  ['500 GB'],
  ['5gig'],
  ['500 gigabytes'],
  ['2 TiB'],
  ['100 Mbit'],
  ['8 bits'],
  ['5 Mbps'],
  ['10 kbit/s'],
  ['1 gigabit per second'],
  ['20 MB/s'],
  ['2 MiB/s'],
  ['2 liters per second'],
  ['5 gpm'],
  ['250 mL/min'],
  ['250 mL per minute'],
  ['12 cfm'],
  ['12 cfs'],
  ['3 m3/h'],
  ['32 psi'],
  ['1013 hPa'],
  ['1013 mbar'],
  ['2 bar'],
  ['120 mmHg'],
  ['760 torr'],
  ['10 inH2O'],
  ['10 inH₂O'],
  ['20 cmH2O'],
  ['3 mH2O'],
  ['1 kgf/cm2'],
  ['1 technical atmosphere'],
  ['2000 kcal'],
  ['2000 Calories'],
  ['500 calories'],
  ['13 kWh'],
  ['5 N'],
  ['10 kW'],
  ['60 Hz'],
  ['3000 rpm'],
  ['90 degrees'],
  ['1.5 rad'],
  ['30%'],
  ['30 percent'],
  ['12 V'],
  ['3.3 volts'],
  ['500 mV'],
  ['11 kV'],
  ['2 amps'],
  ['500 mA'],
  ['25 microamps'],
  ['10 ohms'],
  ['4.7 kohm'],
  ['1 megaohm'],
  ['5 coulombs'],
  ['500 mAh'],
  ['2 Ah'],
  ['3 moles'],
  ['250 mmol'],
  ['5 umol'],
  ['5 USD'],
  ['USD 5'],
  ['5 dollars'],
  ['5 bucks'],
  ['5 quid'],
  ['5 euros'],
  ['$5'],
  ['$5.50'],
  ['$1,234.50'],
  ['€10'],
  ['£3.50'],
  ['¥1000'],
  ['between $5 and $10'],
  ['$5-$10'],
  ['$5 to $10'],
  ['5 to 10 USD'],
  ['5 EUR to USD', { kind: 'currency' }],
  ['€5-$10', { kind: 'currency' }],
  ['50 cents'],
  ['50 cents', { currency: 'EUR' }],
  ['five dollars and fifty cents'],
  ['5 dollars 50 cents'],
  ['50¢'],
  ['50p'],
  ['50 pence'],
  ['3 quid 50'],
  ['3 quid 05'],
  ['3 quid 99'],
  ['5 pounds sterling 25'],
  ['5 pounds 25', { kind: 'currency' }],
  ['1 234,5 kg'],
  ['12,34,567 m'],
  ['70k km'],
  ['1×10⁻³ kg'],
  ['2.5×10⁻⁴ m'],
  ['3.493e-4 m'],
  ['1.234×10^5 kg'],
  ['¾ cup'],
  ['a dozen inches'],
  ['half a dozen feet'],
  ['one hundred and five kg'],
  ['two point five six kg'],
  ['three point one four kg'],
  // "between A and B" where both sides are spelled scale words: the and-word
  // separates the range instead of composing a single number.
  ['between one thousand and two thousand meters'],
  ['between two hundred and five hundred meters'],
  ['between five and a half and ten kg'],
  ['nineteen hundred kg'],
  ['two hundred thousand kg'],
  [''],
  ['   '],
  ['banana'],
  ['5 blorks'],
  ['5 kg extra words'],
  ['5 kg', { kind: 'length' }],
  ['5 kg to seconds'],
  ['3 and kg'],
  ['5 C 30 F', { kind: 'temperature' }],
  ['99999999999999999999999 kg'],
  ['5 killograms', { kind: 'mass' }],
  ['10 gallons', { system: 'imperial' }],
  ['2 ft to cm'],
  ['2 ft in cm'],
  ['2ft as cm'],
  ['2 ft into cm'],
  ['2ft = cm'],
  ['2 ft → cm'],
  ['2ft -> cm'],
  ['15%', { kind: 'length' }],
  ['5 kg to 10 g'],
  ['5 ft 13 in'],
  ['10 ± 0.5 °C to °F', { kind: 'temperature' }],
  ['½ flurbs'],
  ['several minutes'],
  ['9.8 meters per second'],
  ['100 kilometers per hour'],
  ['60 miles per hour'],
  ['32 pounds per square inch'],
  ['120 millimeters of mercury'],
  ['3 centuries'],
  ['1 M'],
  ['5 mM'],
  ['5 uM'],
  ['5 μM'],
  ['5 µM'],
  ['1 mol/L'],
  ['1 mol / L'],
  ['1 mol per L'],
  ['1 mol per liter'],
  ['250 mmol/L'],
  ['250 mmol per L'],
  ['250 mmol per litre'],
  ['10 umol per L'],
  ['1 μmol per liter'],
  ['1 µmol/L'],
  ['10 micromolar'],
  ['9.8 m/s²'],
  ['32 ft/s2'],
  ['2 gees'],
  ['10 N*m'],
  ['10 Nm'],
  ['80 lb-ft'],
  ['250 cd'],
  ['800 lumens'],
  ['1.2 klm'],
  ['500 lux'],
  ['50 foot-candles'],
  ['100 nits'],
  ['300 cd/m2'],
  ['14 fL'],
  ['2 Gy'],
  ['500 mGy'],
  ['20 mSv'],
  ['2 rem'],
  ['100 Bq'],
  ['5 MBq'],
  ['2 uCi'],
  // Issue-code emit paths locked as behavior (2026-07-05 quality pass):
  ['1.2.3.4 kg'], // NUMBER_FORMAT
  ['5 kb'], // AMBIGUOUS_UNIT (kilobytes assumed, kilobit alt)
  ['5 kg to 10 cm'], // RANGE_KIND_MISMATCH
  ['1013 mb', { kind: 'pressure' }], // mb stays byte-ish, not pressure shorthand
  ['1 kg/cm²'], // kilogram-mass over area stays deferred; use kgf/cm2
  ['5 psig', { kind: 'pressure' }], // gauge/absolute pressure suffixes stay deferred
  ['5 psia', { kind: 'pressure' }],
  ['3 quid 100'], // bare currency minor tails must stay below the currency scale
  ['5 USD 10'], // bare minor tails are for word/slang currency names, not ISO codes
  ['1M'], // glued M stays deferred outside concentration context
  ['1 MC'], // charge prefix case is load-bearing
  ['1 MAh'], // battery charge prefix case is load-bearing
  ['1 UC'], // microcoulomb shorthand is exact-case
  ['1 ah'], // ampere-hour shorthand is exact-case
  ['10 V/A'], // dimensional expressions out of scope
  ['1 C/s'], // electrical rates out of scope
  ['5 Ω*m'], // compound unit expressions out of scope
  ['1 rad', { kind: 'radiation_absorbed_dose' }], // rad remains angle, not absorbed dose
  ['1 gy', { kind: 'radiation_absorbed_dose' }], // Gy is exact-case
  ['1 sv', { kind: 'radiation_equivalent_dose' }], // Sv is exact-case
  ['1 bq', { kind: 'radioactivity' }], // Bq is exact-case
  ['1 ci', { kind: 'radioactivity' }], // Ci is exact-case
  // Natural phrasing pass (plan 002/004): digit-literal negation, fraction-of-a-unit,
  // from…to / X-or-Y ranges, softened bounds, mid-value "ish".
  ['minus 5 kg'],
  ['negative 5 kg'],
  ['minus 20 celsius'],
  ['a quarter of a mile'],
  ['two thirds of a meter'],
  ['a third of an hour'],
  ['three quarters of a mile'],
  ['from 5 to 10 kg'],
  ['5 or 6 kg'],
  ['just under 2 hours'],
  ['just over 2 hours'],
  ['a bit over 2 hours'],
  ['a little over 2 hours'],
  ['slightly under 2 hours'],
  ['5ish kg'],
  ['5 ish kg'],
]

export const dateRows = [
  ['now'],
  ['right now'],
  ['just now'],
  ['a moment ago'],
  ['today'],
  ['tonight'],
  ['tonite'],
  ['tomorrow'],
  ['tmr'],
  ['tmrw'],
  ['tmrw.'],
  ['yesterday'],
  ['yday'],
  ["y'day"],
  ['day after tomorrow'],
  ['overmorrow'],
  ['day before yesterday'],
  ['this morning'],
  ['this afternoon'],
  ['this evening'],
  ['noon'],
  ['midnight'],
  ['in 90 minutes'],
  ['in 10m'],
  ['in 5h'],
  ['in 2d'],
  ['in 2 d'],
  ['90 minutes ago'],
  ['2w ago'],
  ['2 hours from now'],
  ['3mo from now'],
  ['1y from now'],
  ['2 hours and 15 minutes ago'],
  ['half an hour ago'],
  ['an hour ago'],
  ['twenty-five minutes ago'],
  ['in 1h30'],
  ['a week from Friday'],
  ['2 days after tomorrow'],
  ['a month from today'],
  ['3min from tmrw'],
  ['2h after tmr'],
  ['a week from yday'],
  ['a week from tmrw'],
  ['in 1 month', { now: [2026, 0, 31, 9] }, 'jan-end'],
  ['in 1 month', { now: [2028, 0, 31, 9] }, 'leap-jan-end'],
  ['in 1 year', { now: [2028, 1, 29, 9] }],
  ['in 1 month and 1 day', { now: [2026, 0, 31, 9] }],
  ['in 1 month and 1 month', { now: [2026, 0, 31, 9] }],
  ['Friday'],
  ['Monday'],
  ['this Monday'],
  ['this Friday'],
  ['next Monday'],
  ['next Friday'],
  ['last Monday'],
  ['last Friday'],
  ['on Wednesday'],
  ['next tues'],
  ['this thurs'],
  ['last sat'],
  ['on fri'],
  ['Sunday', { now: [2026, 6, 5, 10] }],
  ['next Saturday', { now: [2026, 6, 5, 10] }],
  ['next Sunday', { now: [2026, 6, 5, 10] }],
  ['last Sunday', { now: [2026, 6, 5, 10] }],
  ['this week'],
  ['next week'],
  ['last week'],
  ['this month'],
  ['next month'],
  ['last month'],
  ['this year'],
  ['next year'],
  ['last year'],
  ['this weekend'],
  ['next weekend'],
  ['last weekend'],
  ['beginning of the week'],
  ['start of next month'],
  ['end of week'],
  ['end of month'],
  ['end of year'],
  ['middle of month'],
  ['mid-June'],
  ['2026-07-03'],
  ['2026-07-03T14:30'],
  ['2026-07-03T14:30:05'],
  ['7/3/2026'],
  ['7.3.2026'],
  ['March 5'],
  ['March 5th'],
  ['March 5th, 2026'],
  ['5 March'],
  ['5th of March'],
  ["Mar 5 '26"],
  ['July'],
  ['Jan 2020'],
  ['2024'],
  ['5/3/2026'],
  ['5/3/2026', { dayFirst: true }, 'day-first'],
  ['5/3/2026', { locale: 'en-GB' }, 'en-gb'],
  ['at 3pm'],
  ['@ 3pm'],
  ['3 pm'],
  ['3:05 pm'],
  ['15:30'],
  ['17h30'],
  ['17h'],
  ['5 o’clock'],
  ['5 o’clock pm'],
  ['5.30pm'],
  ['17.30'],
  ['quarter past 5'],
  ['half past 3'],
  ['quarter to 6'],
  ['twenty past 4'],
  ['ten to 6'],
  ['half 5'],
  ['midi'],
  ['minuit'],
  ['midday'],
  ['0900 hours'],
  ['1730 hrs'],
  ['at noon'],
  ['7 in the morning'],
  ['7 in the evening'],
  ['tomorrow at 3pm'],
  ['3pm tomorrow'],
  ['2026-07-03 14:30'],
  ['3pm EST'],
  ['1'],
  ['invoice 2024'],
]

// Time slots (plan 030). A morning `now` keeps afternoon slots on the same
// civil day; civil endpoints read back host-independently (local wall-clock).
const MORNING = [2026, 6, 3, 9, 0, 0]
/** A Sunday, so weekend phrasing is pinned on the day that used to read wrong. */
const SUNDAY = [2026, 5, 28, 9, 0, 0]

export const dateRangeRows = [
  ['9-5', { now: MORNING }],
  ['9 to 5', { now: MORNING }],
  ['2pm to 4pm', { now: MORNING }],
  ['between 9am and 5pm', { now: MORNING }],
  ['2 to 4pm', { now: MORNING }],
  ['from 13:30 to 15:45', { now: MORNING }],
  ['from 3pm', { now: MORNING }],
  ['until 5pm', { now: MORNING }],
  ['10pm to 2am', { now: MORNING }],
  ['half past 9 to noon', { now: MORNING }],
  // A trailing zone applies to the whole slot; civil endpoints are kept (no
  // applyZone) so the row is host-independent, and both TZ issues ride along.
  ['9am to 5pm EST', { now: MORNING }],
  // Calendar ranges. Date endpoints reuse the same separators as clock slots;
  // the end anchors to the start, so "July 1 to July 5" cannot read backwards.
  ['July 1 to July 5', { now: MORNING }],
  ['Aug 3 - Aug 9', { now: MORNING }],
  ['from tomorrow to friday', { now: MORNING }],
  ['2026-08-01 to 2026-08-05', { now: MORNING }],
  ['2026-08-01 - 2026-08-05', { now: MORNING }],
  ['Mon-Fri', { now: MORNING }],
  ['from monday', { now: MORNING }],
  ['until august 9', { now: MORNING }],
  // A date coarser than a day names a period, so the range spans it.
  ['next week', { now: MORNING }],
  ['this month', { now: MORNING }],
  ['next month', { now: MORNING }],
  ['this year', { now: MORNING }],
  ['August', { now: MORNING }],
  ['this weekend', { now: MORNING }],
  ['next weekend', { now: MORNING }],
  ['July 1 3pm to July 2 5pm', { now: MORNING }],
  // A coarse endpoint widens on the closing side too, so these end on the last
  // day of the period rather than its first (D72).
  ['July to August', { now: MORNING }],
  ['until August', { now: MORNING }],
  ['from August', { now: MORNING }],
  ['2026 to 2027', { now: MORNING }],
  ['this weekend to next weekend', { now: MORNING }],
  // Absolute endpoints given backwards swap and warn; an overnight clock slot
  // is left alone, which is why 10pm-to-2am sits above without an issue.
  ['2026-08-09 to 2026-08-03', { now: MORNING }],
  // Sunday is the reference that breaks a naive round-forward-to-Saturday.
  ['this weekend', { now: SUNDAY }],
  ['next weekend', { now: SUNDAY }],
  ['last weekend', { now: SUNDAY }],
]

export function buildContract({ lingo, parseDate, parseDateRange }) {
  return {
    version: 1,
    fixedNow: FIXED_NOW,
    breadth: entriesFromRows(breadthRows, (input, opts) => lingo(input, opts)),
    date: entriesFromRows(dateRows, (input, opts) => parseDate(input, reviveDateOptions(opts)), {
      defaultNow: true,
    }),
    dateRange: entriesFromRows(
      dateRangeRows,
      (input, opts) => parseDateRange(input, reviveDateOptions(opts)),
      { defaultNow: true },
    ),
  }
}

function entriesFromRows(rows, parse, options = {}) {
  const entries = {}
  for (const row of rows) {
    const [input, opts, label] = row
    const key = uniqueKey(input, opts, label)
    const parseOpts = options.defaultNow ? { now: FIXED_NOW, ...(opts ?? {}) } : opts
    entries[key] = {
      input,
      ...(opts ? { opts } : {}),
      ...summarize(parse(input, parseOpts)),
    }
  }
  return entries
}

function uniqueKey(input, opts, label) {
  if (label) return `${input} [${label}]`
  if (!opts?.now) return input
  return `${input} [now:${opts.now.join(',')}]`
}

function reviveDateOptions(opts) {
  if (!opts) return { now: dateFromParts(FIXED_NOW) }
  const out = { ...opts }
  const now = opts.now ?? FIXED_NOW
  out.now = dateFromParts(now)
  return out
}

function summarize(result) {
  const base = {
    type: result.ok ? result.type : 'fail',
    kind: null,
    base: null,
    unit: null,
    issues: result.issues.map((issue) => issue.code),
    span: result.ok ? { ...result.span } : null,
    confidence: result.ok ? result.confidence : null,
  }
  if (!result.ok) return base
  if (result.type === 'quantity') return { ...base, ...quantityShape(result.quantity) }
  if (result.type === 'range') return { ...base, ...rangeShape(result.range) }
  if (result.type === 'conversion') {
    return {
      ...base,
      kind: result.converted.kind,
      base: {
        source: valueShape(result.source),
        converted: valueShape(result.converted),
      },
      unit: result.targetUnit,
    }
  }
  if (result.type === 'number') {
    return { ...base, base: number(result.value), unit: null }
  }
  if (result.type === 'date') {
    return {
      ...base,
      kind: 'date',
      base: dateParts(result.date),
      unit: result.grain,
    }
  }
  if (result.type === 'date-range') {
    return {
      ...base,
      kind: 'date-range',
      base: {
        start: result.start ? dateParts(result.start.date) : null,
        end: result.end ? dateParts(result.end.date) : null,
      },
      unit: {
        start: result.start ? result.start.grain : null,
        end: result.end ? result.end.grain : null,
      },
    }
  }
  return base
}

function valueShape(value) {
  return 'base' in value ? quantityShape(value) : rangeShape(value)
}

function quantityShape(quantity) {
  return {
    kind: quantity.kind,
    base: number(quantity.base),
    unit: quantity.unit,
  }
}

function rangeShape(range) {
  return {
    kind: range.kind,
    base: {
      min: nullableNumber(range.minBase),
      max: nullableNumber(range.maxBase),
      ...(range.plusMinus
        ? {
            plusMinus: {
              center: number(range.plusMinus.centerBase),
              delta: number(range.plusMinus.deltaBase),
            },
          }
        : {}),
    },
    unit: {
      min: range.minUnit,
      max: range.maxUnit,
      ...(range.plusMinus ? { plusMinus: range.plusMinus.unit } : {}),
    },
  }
}


function dateFromParts(parts) {
  return new Date(...parts)
}

function dateParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  }
}

function nullableNumber(value) {
  return value === null ? null : number(value)
}

function number(value) {
  return Number(Number(value).toPrecision(15))
}
