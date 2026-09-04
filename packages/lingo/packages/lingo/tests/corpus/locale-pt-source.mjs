export const FIXED_NOW = [2026, 6, 3, 14, 30, 0]

export const breadthRows = [
  // Pre-existing pack behavior
  ['dois kg', { locale: 'pt' }, 'basic-word-pin'],
  ['entre 5 e 10 kg', { locale: 'pt' }, 'range-pin'],
  ['pelo menos 2 kg', { locale: 'pt' }, 'bound-pin'],
  ['aproximadamente 5 kg', { locale: 'pt' }, 'approx-word-pin'],
  // Composed: compound hundreds (200-900)
  ['duzentos kg', { locale: 'pt' }],
  ['duzentas kg', { locale: 'pt' }],
  ['trezentos kg', { locale: 'pt' }],
  ['quatrocentos kg', { locale: 'pt' }],
  ['quatrocentas kg', { locale: 'pt' }],
  ['quinhentos kg', { locale: 'pt' }],
  ['quinhentas kg', { locale: 'pt' }],
  ['seiscentos kg', { locale: 'pt' }],
  ['seiscentas kg', { locale: 'pt' }],
  ['setecentos kg', { locale: 'pt' }],
  ['setecentas kg', { locale: 'pt' }],
  ['oitocentos kg', { locale: 'pt' }],
  ['oitocentas kg', { locale: 'pt' }],
  ['novecentos kg', { locale: 'pt' }],
  ['novecentas kg', { locale: 'pt' }],
  // bareScales
  ['cem kg', { locale: 'pt' }],
  ['mil kg', { locale: 'pt' }],
  // tens + e + ones composition
  ['vinte e cinco kg', { locale: 'pt' }],
  ['trinta e sete kg', { locale: 'pt' }],
  ['noventa e nove kg', { locale: 'pt' }],
  // decimalWords
  ['dois virgula cinco kg', { locale: 'pt' }],
  ['dois virgula cinco seis kg', { locale: 'pt' }],
  // approximatePhrases
  ['mais ou menos 5 kg', { locale: 'pt' }],
  ['por volta de 5 kg', { locale: 'pt' }],
  ['cerca de 5 kg', { locale: 'pt' }],
  ['la pelas 5 kg', { locale: 'pt' }],
  // approximateWords additions
  ['uns 5 kg', { locale: 'pt' }],
  ['umas 3 kg', { locale: 'pt' }],
  // trailingApproxPhrases
  ['5 kg e pouco', { locale: 'pt' }],
  ['5 kg e poucos', { locale: 'pt' }],
  ['5 kg e tanto', { locale: 'pt' }],
  // rangeAlternativeWords
  ['5 ou 6 kg', { locale: 'pt' }],
  // rangeFromWords 'de'
  ['de 5 a 10 kg', { locale: 'pt' }],
  // fuzzyAmounts
  ['um par de kg', { locale: 'pt' }],
  // Regional teen variants (PT-PT / BR)
  ['dezessete kg', { locale: 'pt' }],
  ['dezassete kg', { locale: 'pt' }],
  ['dezanove kg', { locale: 'pt' }],
  ['dezesseis kg', { locale: 'pt' }],
  ['dezasseis kg', { locale: 'pt' }],
  // "cento" is a bare scale; the and-word links it to the remainder
  ['cento e vinte kg', { locale: 'pt' }],
  ['mil e quinhentos kg', { locale: 'pt' }],
  ['dois mil e quinhentos kg', { locale: 'pt' }],
  // Brazilian short scale
  ['um milhao de kg', { locale: 'pt' }],
  ['um bilhao de kg', { locale: 'pt' }],
  ['mil milhoes de kg', { locale: 'pt' }],
  // Currency
  ['20 reais', { locale: 'pt' }],
  // The range and-word wins over number composition on both sides
  ['entre mil e dois mil kg', { locale: 'pt' }],
]

export const dateRows = [
  // Pre-existing date behavior
  ['ha tres dias', { locale: 'pt' }, 'relative-past-pin'],
  ['amanha', { locale: 'pt' }, 'tomorrow-pin'],
  ['ontem', { locale: 'pt' }, 'yesterday-pin'],
  ['de madrugada', { locale: 'pt' }],
  // dayOffsets: +2, -2
  ['anteontem', { locale: 'pt' }],
  ['depois de amanha', { locale: 'pt' }],
  // localized spoken clock
  ['duas e meia', { locale: 'pt' }],
  ['tres e quinze', { locale: 'pt' }],
  ['quinze para as tres', { locale: 'pt' }],
  ['dez para as oito', { locale: 'pt' }],
  // localized period edges
  ['inicio de julho', { locale: 'pt' }],
  ['comeco de julho', { locale: 'pt' }],
  ['no comeco do mes', { locale: 'pt' }],
  ['meio de julho', { locale: 'pt' }],
  ['fim de julho', { locale: 'pt' }],
  ['final de julho', { locale: 'pt' }],
  // -feira weekdays, bare and with a locative contraction
  ['segunda-feira', { locale: 'pt' }],
  ['terca-feira', { locale: 'pt' }],
  ['sexta-feira', { locale: 'pt' }],
  ['proxima segunda-feira', { locale: 'pt' }],
  ['na proxima segunda-feira', { locale: 'pt' }],
  ['segunda-feira que vem', { locale: 'pt' }],
  ['3 de marco', { locale: 'pt' }],
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
