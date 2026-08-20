export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  ['5キロ', { locale: 'ja' }, 'kg-arabic-pin'],
  ['三キロ', { locale: 'ja' }],
  ['三十五キロ', { locale: 'ja' }],
  ['百五十グラム', { locale: 'ja' }],
  ['千五百メートル', { locale: 'ja' }],
  ['三万五千円', { locale: 'ja' }],
  ['3万5千キロ', { locale: 'ja' }],
  ['二億三千万', { locale: 'ja' }],
  ['二億三千万円', { locale: 'ja' }],
  ['二キロ半', { locale: 'ja' }],
  ['一時間半', { locale: 'ja' }],
  ['３５キロ', { locale: 'ja' }],
  ['5〜10キロ', { locale: 'ja' }],
  ['5～10キロ', { locale: 'ja' }],
  ['三〜五日', { locale: 'ja' }],
  ['約5キロ', { locale: 'ja' }],
  ['5キロ ほど', { locale: 'ja' }],
  ['三個', { locale: 'ja' }],
  // Currency: the pack default disambiguates ￥ from the yuan
  ['1000円', { locale: 'ja' }],
  ['￥1000', { locale: 'ja' }],
  // Postpositional bounds
  ['5キロ未満', { locale: 'ja' }],
  ['5キロ以上', { locale: 'ja' }],
  ['5キロ以下', { locale: 'ja' }],
  ['5キロ以内', { locale: 'ja' }],
  ['5キロ超', { locale: 'ja' }],
  // Prepositional bound
  ['最低5キロ', { locale: 'ja' }],
  // Trailing approximation, unspaced
  ['5キロほど', { locale: 'ja' }],
  ['5キロ前後', { locale: 'ja' }],
]

export const dateRows = [
  ['3日前', { locale: 'ja' }, 'compact-days-ago-pin'],
  ['一昨日', { locale: 'ja' }],
  ['おととい', { locale: 'ja' }],
  ['明後日', { locale: 'ja' }],
  ['あさって', { locale: 'ja' }],
  ['しあさって', { locale: 'ja' }],
  ['今朝', { locale: 'ja' }],
  ['今晩', { locale: 'ja' }],
  ['今夜', { locale: 'ja' }],
  ['来週', { locale: 'ja' }],
  ['再来週', { locale: 'ja' }],
  ['再来月', { locale: 'ja' }],
  ['先々週', { locale: 'ja' }],
  ['先々月', { locale: 'ja' }],
  ['週末', { locale: 'ja' }],
  ['月末', { locale: 'ja' }],
  // Numeric dates written with 年/月/日 suffixes
  ['2026年3月5日', { locale: 'ja' }],
  ['3月5日', { locale: 'ja' }],
  // Weekdays
  ['水曜日', { locale: 'ja' }],
  ['水曜', { locale: 'ja' }],
  ['来週の月曜日', { locale: 'ja' }],
  // Clock with 時/分 and day periods
  ['午後3時', { locale: 'ja' }],
  ['午前9時半', { locale: 'ja' }],
  ['3時15分', { locale: 'ja' }],
  // Date + time with no separating space
  ['明日午後3時', { locale: 'ja' }],
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
