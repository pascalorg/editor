export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  ['5公斤', { locale: 'zh' }, 'kg-arabic-pin'],
  ['三公斤', { locale: 'zh' }],
  ['十五公斤', { locale: 'zh' }],
  ['一百五十公斤', { locale: 'zh' }],
  ['一百五十米', { locale: 'zh' }],
  ['一百五', { locale: 'zh' }],
  ['三万五', { locale: 'zh' }],
  ['3万5', { locale: 'zh' }],
  ['3万5千公斤', { locale: 'zh' }],
  ['３５公斤', { locale: 'zh' }],
  ['两公斤半', { locale: 'zh' }],
  ['三个小时', { locale: 'zh' }],
  ['三个月', { locale: 'zh' }],
  ['幺公斤', { locale: 'zh' }],
  ['差不多5公斤', { locale: 'zh' }],
  ['三 或 四 公斤', { locale: 'zh' }],
  ['七八天', { locale: 'zh' }],
  // Currency: the pack default disambiguates ￥ from the yen
  ['100元', { locale: 'zh' }],
  ['一百元', { locale: 'zh' }],
  ['50块', { locale: 'zh' }],
  ['￥100', { locale: 'zh' }],
  // Postpositional bounds
  ['5公斤以上', { locale: 'zh' }],
  ['5公斤以下', { locale: 'zh' }],
  ['5公斤以内', { locale: 'zh' }],
  // Prepositional bounds
  ['大于5公斤', { locale: 'zh' }],
  ['小于5公斤', { locale: 'zh' }],
  ['不超过5公斤', { locale: 'zh' }],
  ['至少5公斤', { locale: 'zh' }],
  // Trailing approximation
  ['五公斤左右', { locale: 'zh' }],
  ['5公斤左右', { locale: 'zh' }],
  // Range separators
  ['三至五天', { locale: 'zh' }],
  ['三到五天', { locale: 'zh' }],
]

export const dateRows = [
  ['三天前', { locale: 'zh' }, 'compact-days-ago-pin'],
  ['前天', { locale: 'zh' }],
  ['后天', { locale: 'zh' }],
  ['大前天', { locale: 'zh' }],
  ['大后天', { locale: 'zh' }],
  ['三个小时后', { locale: 'zh' }],
  ['三天以后', { locale: 'zh' }],
  ['月底', { locale: 'zh' }],
  ['月初', { locale: 'zh' }],
  ['月中', { locale: 'zh' }],
  ['年底', { locale: 'zh' }],
  ['年初', { locale: 'zh' }],
  ['周末', { locale: 'zh' }],
  // Numeric dates written with 年/月/日 suffixes
  ['2026年3月5日', { locale: 'zh' }],
  ['3月5日', { locale: 'zh' }],
  ['二〇二六年三月五日', { locale: 'zh' }],
  // Weekdays
  ['星期三', { locale: 'zh' }],
  ['周三', { locale: 'zh' }],
  ['下周一', { locale: 'zh' }],
  ['上周五', { locale: 'zh' }],
  // Clock with 点 and day periods
  ['下午3点', { locale: 'zh' }],
  ['上午9点半', { locale: 'zh' }],
  ['3点一刻', { locale: 'zh' }],
  ['晚上8点30分', { locale: 'zh' }],
  // Date + time with no separating space
  ['明天下午3点', { locale: 'zh' }],
  ['昨天上午9点', { locale: 'zh' }],
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
