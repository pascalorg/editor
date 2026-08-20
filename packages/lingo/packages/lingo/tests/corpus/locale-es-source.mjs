export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  // Pre-existing pack behavior
  ['dos kg', { locale: 'es' }, 'basic-word-pin'],
  ['entre 5 y 10 kg', { locale: 'es' }, 'range-pin'],
  ['al menos 2 kg', { locale: 'es' }, 'bound-pin'],
  ['aproximadamente 5 kg', { locale: 'es' }, 'approx-word-pin'],
  // Composed: fused veinti- forms (21-29)
  ['veintiuno kg', { locale: 'es' }],
  ['veintiun kg', { locale: 'es' }],
  ['veintidos kg', { locale: 'es' }],
  ['veinticinco kg', { locale: 'es' }],
  ['veintinueve kg', { locale: 'es' }],
  // Composed: compound hundreds (200-900)
  ['doscientos kg', { locale: 'es' }],
  ['doscientas kg', { locale: 'es' }],
  ['trescientos kg', { locale: 'es' }],
  ['quinientos kg', { locale: 'es' }],
  ['quinientas kg', { locale: 'es' }],
  ['novecientos kg', { locale: 'es' }],
  ['novecientas kg', { locale: 'es' }],
  // bareScales
  ['cien kg', { locale: 'es' }],
  ['mil kg', { locale: 'es' }],
  ['ciento cincuenta kg', { locale: 'es' }],
  ['mil quinientos kg', { locale: 'es' }],
  // decimalWords
  ['dos coma cinco kg', { locale: 'es' }],
  ['dos coma cinco seis kg', { locale: 'es' }],
  ['quinientos coma cero cinco kg', { locale: 'es' }],
  // tens + y + ones composition
  ['treinta y cinco kg', { locale: 'es' }],
  ['cuarenta y dos kg', { locale: 'es' }],
  ['noventa y nueve kg', { locale: 'es' }],
  // approximatePhrases
  ['mas o menos 5 kg', { locale: 'es' }],
  ['por ahi de 5 kg', { locale: 'es' }],
  ['alrededor de 5 kg', { locale: 'es' }],
  ['cerca de 5 kg', { locale: 'es' }],
  ['cosa de 5 kg', { locale: 'es' }],
  // approximateWords additions
  ['unos 5 kg', { locale: 'es' }],
  ['unas 3 kg', { locale: 'es' }],
  // trailingApproxPhrases
  ['5 kg y pico', { locale: 'es' }],
  ['5 kg y tantos', { locale: 'es' }],
  ['5 kg y algo', { locale: 'es' }],
  // rangeAlternativeWords
  ['5 o 6 kg', { locale: 'es' }],
  // rangeFromWords 'de'
  ['de 5 a 10 kg', { locale: 'es' }],
  // fuzzyAmounts
  ['un par de kg', { locale: 'es' }],
  // Hundreds attach to the group in front of them, not the running total
  ['ciento veinte kg', { locale: 'es' }],
  // Long scale: "mil millones" is 10^9, "billón" is 10^12
  ['un millon de kg', { locale: 'es' }],
  ['mil millones de kg', { locale: 'es' }],
  ['dos mil millones de kg', { locale: 'es' }],
  ['un billon de kg', { locale: 'es' }],
  // Currency
  ['20 euros', { locale: 'es' }],
  // The range and-word wins over number composition on both sides
  ['entre mil y dos mil kg', { locale: 'es' }],
  ['entre cien y mil kg', { locale: 'es' }],
]

export const dateRows = [
  // Pre-existing date behavior
  ['hace tres dias', { locale: 'es' }, 'relative-past-pin'],
  ['manana', { locale: 'es' }, 'tomorrow-pin'],
  ['ayer', { locale: 'es' }, 'yesterday-pin'],
  // dayOffsets: +2, -2
  ['pasado manana', { locale: 'es' }],
  ['anteayer', { locale: 'es' }],
  ['antier', { locale: 'es' }],
  // localized spoken clock
  ['las dos y media', { locale: 'es' }],
  ['las tres menos cuarto', { locale: 'es' }],
  // localized period edges
  ['a principios de mes', { locale: 'es' }],
  ['a mediados de julio', { locale: 'es' }],
  ['a finales de mes', { locale: 'es' }],
  ['a finales de julio', { locale: 'es' }],
  // Day-of-month, ordinal and cardinal
  ['el 1º de marzo', { locale: 'es' }],
  ['el 3 de marzo', { locale: 'es' }],
  ['el proximo lunes', { locale: 'es' }],
  ['lunes que viene', { locale: 'es' }],
]

export const dateRangeRows = []

export function buildContract({ lingo, localePacks, parseDate, parseDateRange }) {
  return {
    version: 1,
    fixedNow: FIXED_NOW,
    breadth: entriesFromRows(breadthRows, (input, opts) => lingo(input, opts)),
    date: entriesFromRows(
      dateRows,
      (input, opts) => parseDate(input, reviveDateOptions(opts, localePacks)),
      { defaultNow: true },
    ),
    dateRange: entriesFromRows(
      dateRangeRows,
      (input, opts) => parseDateRange(input, reviveDateOptions(opts, localePacks)),
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

function reviveDateOptions(opts, localePacks) {
  if (!opts) return { ...(localePacks ? { localePacks } : {}), now: dateFromParts(FIXED_NOW) }
  const out = { ...(localePacks ? { localePacks } : {}), ...opts }
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
