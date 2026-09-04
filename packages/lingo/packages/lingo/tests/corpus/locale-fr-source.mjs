export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  // Pre-existing pack behavior
  ['deux kg', { locale: 'fr' }, 'basic-word-pin'],
  ['entre 5 et 10 kg', { locale: 'fr' }, 'range-pin'],
  ['au moins 2 kg', { locale: 'fr' }, 'bound-pin'],
  ['environ 5 kg', { locale: 'fr' }, 'approx-word-pin'],
  // Composed: vigesimal (70-79)
  ['soixante-dix kg', { locale: 'fr' }],
  ['soixante-quinze kg', { locale: 'fr' }],
  ['soixante-dix-neuf kg', { locale: 'fr' }],
  // Composed: vigesimal (80-89)
  ['quatre-vingts kg', { locale: 'fr' }],
  ['quatre-vingt-cinq kg', { locale: 'fr' }],
  ['quatre-vingt-neuf kg', { locale: 'fr' }],
  // Composed: vigesimal (90-99)
  ['quatre-vingt-dix kg', { locale: 'fr' }],
  ['quatre-vingt-quinze kg', { locale: 'fr' }],
  ['quatre-vingt-dix-neuf kg', { locale: 'fr' }],
  // Regional (Belgian/Swiss) — already worked
  ['septante-cinq kg', { locale: 'fr' }],
  ['nonante-deux kg', { locale: 'fr' }],
  ['huitante kg', { locale: 'fr' }],
  // bareScales
  ['cent kg', { locale: 'fr' }],
  ['mille kg', { locale: 'fr' }],
  // tens + et + ones
  ['vingt et un kg', { locale: 'fr' }],
  ['trente et un kg', { locale: 'fr' }],
  // decimalWords
  ['deux virgule cinq kg', { locale: 'fr' }],
  ['trois virgule quatorze kg', { locale: 'fr' }],
  ['deux virgule cinq six kg', { locale: 'fr' }],
  // approximatePhrases
  ['a peu pres 5 kg', { locale: 'fr' }],
  ['plus ou moins 5 kg', { locale: 'fr' }],
  ['grosso modo 5 kg', { locale: 'fr' }],
  // trailingApproxWords
  ['5 kg environ', { locale: 'fr' }],
  // trailingApproxPhrases
  ['5 kg et quelques', { locale: 'fr' }],
  ['5 kg a peu pres', { locale: 'fr' }],
  // rangeAlternativeWords
  ['5 ou 6 kg', { locale: 'fr' }],
  // fuzzyAmounts
  ['une dizaine de kg', { locale: 'fr' }],
  ['une vingtaine de kg', { locale: 'fr' }],
  ['une trentaine de kg', { locale: 'fr' }],
  ['une centaine de kg', { locale: 'fr' }],
  ['un millier de kg', { locale: 'fr' }],
  ['quelques kg', { locale: 'fr' }],
  // Teens: the hyphen must not read as a range separator
  ['dix-sept kg', { locale: 'fr' }],
  ['dix-huit kg', { locale: 'fr' }],
  ['dix-neuf kg', { locale: 'fr' }],
  // Hundreds attach to the group in front of them, not the running total
  ['mille cinq cents kg', { locale: 'fr' }],
  ['deux cent cinquante mille kg', { locale: 'fr' }],
  ['cent vingt kg', { locale: 'fr' }],
  // Long scale: milliard is 10^9, billion is 10^12
  ['un million de kg', { locale: 'fr' }],
  ['deux milliards de kg', { locale: 'fr' }],
  ['un billion de kg', { locale: 'fr' }],
  ['mille millions de kg', { locale: 'fr' }],
  // Currency
  ['20 euros', { locale: 'fr' }],
  // The range and-word wins over number composition on both sides
  ['entre mille et deux mille kg', { locale: 'fr' }],
]

export const dateRows = [
  // Pre-existing date behavior
  ['il y a trois jours', { locale: 'fr' }, 'relative-past-pin'],
  ['demain', { locale: 'fr' }, 'tomorrow-pin'],
  ['hier', { locale: 'fr' }, 'yesterday-pin'],
  // dayOffsets: +2, -2
  ['apres-demain', { locale: 'fr' }],
  ['avant-hier', { locale: 'fr' }],
  // localized spoken clock
  ['deux heures et quart', { locale: 'fr' }],
  ['trois heures moins le quart', { locale: 'fr' }],
  ['midi et demi', { locale: 'fr' }],
  // localized period edges
  ['debut juillet', { locale: 'fr' }],
  ['mi-juillet', { locale: 'fr' }],
  ['fin juillet', { locale: 'fr' }],
  // localized weekday offsets
  ['lundi en huit', { locale: 'fr' }],
  ['mardi en quinze', { locale: 'fr' }],
  // Ordinal day-of-month ("1er" only; other days are cardinal in French)
  ['le 1er mars', { locale: 'fr' }],
  ['le 3 mars', { locale: 'fr' }],
  ['lundi prochain', { locale: 'fr' }],
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
