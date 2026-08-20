#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { performance } from 'node:perf_hooks'

const ROOT = new URL('..', import.meta.url).pathname
const DIST_INDEX = join(ROOT, 'dist/index.js')
const DIST_DATE = join(ROOT, 'dist/date/index.js')
const DIST_DOM = join(ROOT, 'dist/dom/index.js')
const DEFAULT_BASELINE = join(ROOT, 'bench/baseline-node.json')
const NOW = new Date(2026, 6, 3, 14, 30, 0)

/**
 * Locale corpora stay hand-written: the point is to measure the profile
 * resolution and auto-detection paths on realistic native input, not to
 * re-measure the English grammar through a translated alias table.
 */
const LOCALE_CORPORA = {
  cjk: [
    '5公斤',
    '三十五公斤',
    '一百五十米',
    '5公斤左右',
    '3万5千公斤',
    '5キロ',
    '三十五キロ',
    '約5キロ',
  ],
  english: ['5 kg', '72 in to cm', 'between 5 and 10 kg', '5\'11"', 'two hundred grams'],
  romance: [
    'cinq kg',
    'deux virgule cinq kg',
    'quatre-vingt-dix kg',
    'environ 5 kilos',
    'entre 5 et 10 kg',
    'treinta y cinco kg',
    'mas o menos 5 kilos',
    'quinientos gramos',
    'dois virgula cinco kg',
    'mais ou menos 5 quilos',
  ],
}

const args = parseArgs(process.argv.slice(2))
let sink = 0

if (args.help) {
  printHelp()
  process.exit(0)
}

if (args.build) {
  runBuild()
}
ensureDist(args.browser)

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const reports = []

if (args.backend || !(args.backend || args.browser)) {
  reports.push(await runBackend())
}

if (args.browser) {
  reports.push(await runBrowser())
}

if (args.json) {
  console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2))
}

if (args.writeBaseline) {
  const target = args.writeBaseline === true ? DEFAULT_BASELINE : join(ROOT, args.writeBaseline)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(reports[reports.length - 1], null, 2)}\n`)
  if (!args.json) {
    console.log(`\nWrote baseline: ${relative(ROOT, target)}`)
  }
}

if (args.compare) {
  const baselinePath = args.compare === true ? DEFAULT_BASELINE : join(ROOT, args.compare)
  compareBaseline(reports[reports.length - 1], baselinePath, args.threshold)
}

function parseArgs(argv) {
  const out = {
    backend: false,
    browser: false,
    open: false,
    build: false,
    json: false,
    writeBaseline: false,
    compare: false,
    threshold: 30,
    samples: 7,
    iterations: 100_000,
    port: 0,
    timeout: 120_000,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
    } else if (arg === '--backend') {
      out.backend = true
    } else if (arg === '--browser' || arg === '--frontend') {
      out.browser = true
    } else if (arg === '--all') {
      out.backend = true
      out.browser = true
    } else if (arg === '--open') {
      out.open = true
    } else if (arg === '--build') {
      out.build = true
    } else if (arg === '--json') {
      out.json = true
    } else if (arg === '--write-baseline') {
      const next = argv[i + 1]
      if (next && next !== '--' && !next.startsWith('--')) {
        out.writeBaseline = next
        i++
      } else {
        out.writeBaseline = true
      }
    } else if (arg === '--compare') {
      const next = argv[i + 1]
      if (next && next !== '--' && !next.startsWith('--')) {
        out.compare = next
        i++
      } else {
        out.compare = true
      }
    } else if (arg === '--threshold') {
      out.threshold = Number(valueArg(argv, ++i, arg))
    } else if (arg === '--samples') {
      out.samples = Number(valueArg(argv, ++i, arg))
    } else if (arg === '--iterations') {
      out.iterations = Number(valueArg(argv, ++i, arg))
    } else if (arg === '--port') {
      out.port = Number(valueArg(argv, ++i, arg))
    } else if (arg === '--timeout') {
      out.timeout = Number(valueArg(argv, ++i, arg))
    } else if (arg === '--help' || arg === '-h') {
      out.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return out
}

function valueArg(argv, index, flag) {
  const value = argv[index]
  if (!value || value === '--' || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`)
  }
  return value
}

function printHelp() {
  console.log(`lingo benchmark runner

Usage:
  bun run bench
  bun run bench -- --browser --open
  bun run bench -- --write-baseline bench/baseline-node.json
  bun run bench -- --compare bench/baseline-node.json --threshold 30

Options:
  --backend              run Node/backend suites
  --browser, --frontend  serve and run browser/frontend suites
  --all                  run backend, then browser
  --open                 open the browser benchmark URL
  --build                run bun run build first
  --json                 print JSON report instead of tables
  --write-baseline PATH  write the last report to PATH
  --compare PATH         compare the last report to PATH
  --threshold N          allowed regression percent for --compare (default 30)
  --samples N            timed measurement runs per ops/s suite (default 7)
  --iterations N         base iterations per ops/s suite (default 100000)
  --port N               browser server port, 0 means random (default 0)
  --timeout MS           browser result timeout (default 120000)
`)
}

function runBuild() {
  const result = spawnSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function ensureDist(needsDom) {
  const missing = [DIST_INDEX, DIST_DATE, needsDom ? DIST_DOM : null].filter(
    (file) => file && !existsSync(file),
  )
  if (missing.length > 0) {
    throw new Error(`Missing built files. Run \`bun run build\` first.\n${missing.join('\n')}`)
  }
}

function buildBackendCorpora(kinds) {
  const units = collectUnitAliases(kinds)
  const byKind = new Map()
  for (const unit of units) {
    const list = byKind.get(unit.kind) ?? []
    list.push(unit)
    byKind.set(unit.kind, list)
  }
  const lengthUnits = byKind.get('length') ?? []
  const massUnits = byKind.get('mass') ?? []
  const temperatureUnits = byKind.get('temperature') ?? []
  const durationUnits = byKind.get('duration') ?? []
  const volumeUnits = byKind.get('volume') ?? []
  const quantitySimple = generatedQuantities(units, 900)
  const fieldSet = generatedQuantities(lengthUnits, 180)
  const mixed = unique([
    ...quantitySimple.filter((_, i) => i % 5 === 0),
    ...generatedRanges([...lengthUnits, ...massUnits, ...durationUnits, ...volumeUnits], 320),
    ...generatedConversions(byKind, 260),
    ...generatedCompounds(),
    ...generatedFuzzyAndScientific(),
  ])
  const partial = generatedPartialStates(lengthUnits)
  const dateMixed = generatedDatePhrases()
  const durationMixed = generatedDurationPhrases()
  return {
    quantitySimple,
    fieldSet,
    mixed,
    partial,
    dateMixed,
    durationMixed,
    typoFix: generatedTypos(lengthUnits, 220),
    unknownSuggestions: generatedUnknownUnits(240),
    unknownTyposOff: generatedUnknownUnits(240),
    strictConfirm: generatedStrictConfirm(lengthUnits, massUnits, temperatureUnits),
    freeText: generatedFreeText(quantitySimple, mixed, 260),
  }
}

function collectUnitAliases(kinds) {
  const refs = []
  for (const kindDef of kinds) {
    for (const unit of kindDef.units) {
      const aliases = unique(
        [
          unit.symbol,
          unit.name,
          unit.plural,
          ...(unit.aliases ?? []),
          ...(unit.caseExact ?? []),
        ].filter(Boolean),
      )
      for (const alias of aliases) {
        if (alias.length <= 32) {
          refs.push({ kind: kindDef.kind, unit: unit.id, alias })
        }
      }
    }
  }
  return refs
}

function generatedQuantities(units, limit) {
  const values = [
    '0',
    '1',
    '2',
    '2.5',
    '3',
    '4.75',
    '5',
    '7',
    '10',
    '12',
    '20',
    '72',
    '100',
    '250',
    '1,5',
    '1.25',
    '1 234',
    'one',
    'two',
    'three',
    'twenty-five',
    'a hundred',
    '1/2',
    '1½',
    '2-3/4',
  ]
  const leads = [
    '',
    '',
    '',
    'about ',
    'around ',
    'roughly ',
    'exactly ',
    'like ',
    'maybe ',
    'gimme ',
    'give me ',
  ]
  const tails = ['', '', '', ' or so', '-ish', '.']
  const out = []
  for (let i = 0; out.length < limit; i++) {
    const unit = units[i % units.length]
    const value = valueForUnit(values[i % values.length], unit, i)
    const alias = unit.alias
    const glued = canGlue(alias) && i % 4 === 0
    const lead = leads[i % leads.length]
    const tail = tails[Math.floor(i / units.length) % tails.length]
    out.push(`${lead}${value}${glued ? '' : ' '}${alias}${tail}`)
    if (i > limit * 8) {
      break
    }
  }
  return unique(out)
}

function valueForUnit(value, unit, i) {
  if (unit.kind === 'temperature') {
    return ['20', '-40', '98.6', '350', '0'][i % 5]
  }
  if (unit.kind === 'percent') {
    return ['5', '12.5', '100', '0.5'][i % 4]
  }
  return value
}

function canGlue(alias) {
  return !alias.includes(' ') && alias.length <= 4 && /^[^\d]+$/.test(alias)
}

function generatedRanges(units, limit) {
  const out = []
  const forms = [
    (a, b, u) => `${a}-${b} ${u}`,
    (a, b, u) => `${a} to ${b} ${u}`,
    (a, b, u) => `between ${a} and ${b} ${u}`,
    (a, b, u) => `under ${b} ${u}`,
    (a, b, u) => `at least ${a} ${u}`,
    (a, b, u) => `more than ${a} ${u}`,
    (a, b, u) => `${b} ± ${a / 10 || 0.5} ${u}`,
  ]
  for (let i = 0; out.length < limit; i++) {
    const unit = units[i % units.length]
    const a = (i % 9) + 1
    const b = a + ((i % 5) + 1)
    out.push(forms[i % forms.length](a, b, unit.alias))
    if (i > limit * 8) {
      break
    }
  }
  return unique(out)
}

function generatedConversions(byKind, limit) {
  const out = []
  const pairs = [
    ['length', 'ft', 'cm'],
    ['length', 'in', 'm'],
    ['length', 'km', 'mi'],
    ['mass', 'lb', 'kg'],
    ['mass', 'kg', 'g'],
    ['volume', 'cup', 'ml'],
    ['volume', 'gal', 'l'],
    ['temperature', 'F', 'C'],
    ['temperature', 'C', 'F'],
    ['speed', 'mph', 'km/h'],
    ['data', 'MB', 'kB'],
  ]
  const words = ['to', 'in', 'as', 'into', '=']
  for (let i = 0; out.length < limit; i++) {
    const [kind, fromId, toId] = pairs[i % pairs.length]
    const units = byKind.get(kind) ?? []
    const from = findAlias(units, fromId) ?? units[0]?.alias
    const to = findAlias(units, toId) ?? units[1]?.alias
    if (!(from && to)) {
      continue
    }
    out.push(`${conversionValue(kind, i)} ${from} ${words[i % words.length]} ${to}`)
    if (i > limit * 8) {
      break
    }
  }
  return unique(out)
}

function conversionValue(kind, i) {
  if (kind === 'temperature') {
    return ['32', '68', '98.6', '212'][i % 4]
  }
  return ['2', '5', '12', '72', '100', '1.5'][i % 6]
}

function findAlias(units, id) {
  return (
    units.find((unit) => unit.unit === id && unit.alias === id)?.alias ??
    units.find((unit) => unit.unit === id)?.alias
  )
}

function generatedCompounds() {
  return [
    '5\'11"',
    '5′11″',
    '5 ft 11 in',
    '5-foot-11',
    '6ft2',
    '1m80',
    '2 lb 3 oz',
    '1h30',
    '1 h 30 min',
    '20in and 10cm',
    '10cm and 20in',
    '2 m plus 10 cm',
    '2 m minus 10 cm',
    '1 day, 3 hours, 2 minutes',
    'an hour and a half',
    'two and a half hours',
    '1 1/2 in',
    '2-3/4 in',
  ]
}

function generatedFuzzyAndScientific() {
  return [
    "it's hot",
    "it's freezing",
    'pretty cold',
    'hot outside',
    'a few minutes',
    'a couple hours',
    'several days',
    '3×10^5 m',
    '3x10^5 m',
    '2.5E-4 m',
    '1e3 m',
    '1,234 kg',
    '1.234,56 m',
    '1,234.56 m',
    '1 234 567 m',
    '½ cup',
    '1½ cups',
    'twenty-five kg',
    'a hundred meters',
  ]
}

function generatedPartialStates(lengthUnits) {
  const full = generatedQuantities(lengthUnits, 180)
  const out = ['', '2', '2 ', '2 f', 'between 5 and', '5 meterz']
  for (const input of full) {
    const trimmed = input.replace(/[.!]$/, '')
    out.push(trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2))))
    const lastSpace = trimmed.lastIndexOf(' ')
    if (lastSpace > 0) {
      out.push(trimmed.slice(0, lastSpace + 2))
      out.push(trimmed)
    }
  }
  return unique(out).filter((x) => x.length > 0)
}

function generatedDatePhrases() {
  const weekdays = ['mon', 'tues', 'wed', 'thu', 'fri', 'sat', 'sun']
  const months = ['Jan', 'February', 'Mar', 'April', 'Sept', 'November']
  const out = [
    'today',
    'tomorrow',
    'yesterday',
    'three days ago',
    'next tues',
    'in 2d',
    '3min from tmrw',
    '2026-07-03T14:30',
    'March 5th, 2026',
    'tmrw @ 9',
    'sat morning',
    'fri eod',
    'in a bit',
  ]
  for (let i = 1; i <= 30; i++) {
    out.push(`in ${i} days`)
    out.push(`${i} days ago`)
    out.push(`next ${weekdays[i % weekdays.length]}`)
  }
  for (let i = 1; i <= 24; i++) {
    out.push(`${months[i % months.length]} ${i}${ordinalSuffix(i)}, 2026`)
  }
  return unique(out)
}

function ordinalSuffix(n) {
  if (n >= 11 && n <= 13) {
    return 'th'
  }
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
}

function generatedDurationPhrases() {
  const units = ['second', 'minute', 'hour', 'day', 'week']
  const out = ['1h30', '90 min', 'an hour and a half', 'PT1H30M', '1:30']
  for (let i = 1; i <= 80; i++) {
    const unit = units[i % units.length]
    out.push(`${i} ${unit}${i === 1 ? '' : 's'}`)
    out.push(`${i} ${unit[0]}`)
  }
  out.push('two and a half hours', 'half an hour', '1 day, 3 hours', '2 weeks and 3 days')
  return unique(out)
}

function generatedTypos(units, limit) {
  const out = []
  for (let i = 0; out.length < limit; i++) {
    const unit = units[i % units.length]
    const alias = unit.alias.replace(/[^a-z]/gi, '')
    if (alias.length < 3) {
      continue
    }
    out.push(`${(i % 20) + 1} ${misspell(alias)}`)
    if (i > limit * 8) {
      break
    }
  }
  return unique(out)
}

function misspell(word) {
  if (word.length <= 3) {
    return `${word}z`
  }
  const i = Math.floor(word.length / 2)
  return `${word.slice(0, i)}${word.slice(i + 1)}`
}

function generatedUnknownUnits(limit) {
  const roots = [
    'blork',
    'qqqqq',
    'madeupunit',
    'widgetweight',
    'shippingstone',
    'boxlength',
    'frob',
    'snarf',
    'parcelunit',
    'notakilo',
    'fakegram',
    'mysterymass',
  ]
  const out = []
  for (let i = 0; out.length < limit; i++) {
    out.push(`${(i % 100) + 1} ${roots[i % roots.length]}${i % 3 === 0 ? 's' : ''}`)
  }
  return unique(out)
}

function generatedStrictConfirm(lengthUnits, massUnits, temperatureUnits) {
  return unique([
    '1,234 kg',
    '5 meterz',
    '72',
    '12 K',
    ...generatedTypos(lengthUnits, 80),
    ...generatedRanges(massUnits, 80),
    ...generatedQuantities(temperatureUnits, 60),
  ])
}

function generatedFreeText(quantitySimple, mixed, limit) {
  const prefixes = ['Need', 'Order', 'Install', 'Bring', 'Quote', 'Set', 'Check', 'Pack']
  const joins = ['then', 'plus', 'and', 'before Friday with', 'for job notes:']
  const out = ['Need 2 ft, 5 kg, and 72 in to cm before Friday.']
  for (let i = 0; out.length < limit; i++) {
    const a = quantitySimple[i % quantitySimple.length].replace(/[.!]$/, '')
    const b = quantitySimple[(i * 7 + 3) % quantitySimple.length].replace(/[.!]$/, '')
    const c = mixed[(i * 11 + 5) % mixed.length].replace(/[.!]$/, '')
    out.push(`${prefixes[i % prefixes.length]} ${a}, ${joins[i % joins.length]} ${b}; ${c}.`)
  }
  return unique(out)
}

function unique(values) {
  return [...new Set(values)]
}

async function runBackend() {
  const main = await import(`../dist/index.js?bench=${Date.now()}`)
  const date = await import(`../dist/date/index.js?bench=${Date.now()}`)
  const complete = await import(`../dist/complete/index.js?bench=${Date.now()}`)
  const localePacks = await loadLocalePacks()
  const corpora = buildBackendCorpora(main.allKinds)
  const lengthMeters = { kind: 'length', unit: 'm' }
  const massKind = { kind: 'mass' }
  const massStrictNoTypos = {
    kind: 'mass',
    strictness: 'strict',
    tolerance: { typos: 'off' },
  }
  const lengthConfirm = { kind: 'length', unit: 'cm', strictness: 'confirm' }

  const suites = [
    {
      name: 'parseQuantity simple',
      group: 'backend/core',
      samples: corpora.quantitySimple,
      fn: (input) => main.parseQuantity(input),
    },
    {
      name: 'lingo mixed grammar',
      group: 'backend/core',
      samples: corpora.mixed,
      fn: (input) => main.lingo(input),
    },
    {
      name: 'partialState typing',
      group: 'backend/frontend-shared',
      samples: corpora.partial,
      fn: (input) => main.partialState(input, lengthMeters),
    },
    {
      name: 'completions prefix',
      group: 'backend/frontend-shared',
      samples: corpora.partial,
      fn: (input) => complete.completions(input, { kind: 'length', limit: 8 }),
    },
    {
      name: 'parseDate mixed',
      group: 'backend/date',
      samples: corpora.dateMixed,
      fn: (input) => date.parseDate(input, { now: NOW }),
    },
    {
      name: 'parseDuration mixed',
      group: 'backend/date',
      samples: corpora.durationMixed,
      fn: (input) => date.parseDuration(input),
    },
    {
      name: 'format quantity',
      group: 'backend/format',
      samples: ['x'],
      fn: () => main.quantity(1.8034, 'm').format({ compound: ['ft', 'in'] }),
    },
    {
      name: 'humanizeDate',
      group: 'backend/date',
      samples: ['x'],
      fn: () => date.humanizeDate(new Date(2026, 6, 1, 14, 30), { now: NOW }),
    },
    {
      name: 'humanizeDuration',
      group: 'backend/date',
      samples: ['x'],
      fn: () => date.humanizeDuration(5400, { style: 'natural' }),
    },
    {
      name: 'typo fix with kind',
      group: 'backend/slow-path',
      iterations: Math.max(10_000, Math.floor(args.iterations / 5)),
      samples: corpora.typoFix,
      fn: (input) => main.lingo(input, { kind: 'length' }),
    },
    {
      name: 'unknown unit suggestions',
      group: 'backend/slow-path',
      iterations: Math.max(10_000, Math.floor(args.iterations / 5)),
      samples: corpora.unknownSuggestions,
      fn: (input) => main.lingo(input, massKind),
    },
    {
      name: 'unknown unit typos off',
      group: 'backend/bulk',
      samples: corpora.unknownTyposOff,
      fn: (input) => main.lingo(input, massStrictNoTypos),
    },
    {
      name: 'strict confirm candidate',
      group: 'backend/strictness',
      samples: corpora.strictConfirm,
      fn: (input) => main.lingo(input, lengthConfirm),
    },
    {
      name: 'free text scan',
      group: 'backend/extraction',
      iterations: Math.max(10_000, Math.floor(args.iterations / 5)),
      samples: corpora.freeText,
      fn: (input) => main.findQuantities(input),
    },
    ...localeSuites(main, localePacks),
  ]

  const probes = [
    {
      name: '50k no match',
      group: 'backend/latency',
      input: 'a'.repeat(50_000),
      fn: (input) => main.lingo(input),
    },
    {
      name: '20k unknown tail',
      group: 'backend/latency',
      input: `5 ${'x'.repeat(20_000)}`,
      fn: (input) => main.lingo(input),
    },
    {
      name: '500-digit number',
      group: 'backend/latency',
      input: `${'9'.repeat(500)} kg`,
      fn: (input) => main.lingo(input),
    },
  ]

  const report = {
    version: 1,
    package: { name: packageJson.name, version: packageJson.version },
    target: 'backend',
    createdAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      v8: process.versions.v8,
    },
    corpus: {
      version: 2,
      kind: 'generated-english',
      description:
        'Deterministic English-like cases generated from built-in unit aliases, number forms, qualifiers, ranges, conversions, typos, dates, durations, and sentence templates.',
    },
    results: runSuites(suites),
    probes: runProbes(probes),
  }

  if (!args.json) {
    printReport(report)
  }
  return report
}

async function loadLocalePacks() {
  const ids = ['es', 'fr', 'pt', 'zh', 'ja']
  const stamp = Date.now()
  const packs = {}
  for (const id of ids) {
    packs[id] = (await import(`../dist/locales/${id}.js?bench=${stamp}`)).default
  }
  return packs
}

/**
 * Locale suites exist to keep the multi-language paths honest: a resolved
 * profile is ~40 merged tables, and auto-detection scores every loaded pack, so
 * both are cached. These suites fail loudly (as a throughput drop) if a change
 * reintroduces per-parse profile merging or per-pack re-tokenization.
 */
function localeSuites(main, packs) {
  const all = [packs.es, packs.fr, packs.pt, packs.zh, packs.ja]
  const single = main.createLingo({ locales: [packs.fr] })
  const loaded = main.createLingo({ locales: all })
  return [
    {
      name: 'locale explicit (1 pack)',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.romance.slice(0, 4),
      fn: (input) => single.parse(input, { locale: 'fr' }),
    },
    {
      name: 'locale explicit (5 packs)',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.romance,
      fn: (input) => loaded.parse(input, { locale: localeFor(input) }),
    },
    {
      name: 'locale english w/ packs loaded',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.english,
      fn: (input) => loaded.parse(input, { locale: 'en' }),
    },
    {
      name: 'locale auto-detect romance',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.romance,
      fn: (input) => loaded.parse(input),
    },
    {
      name: 'locale auto-detect cjk',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.cjk,
      fn: (input) => loaded.parse(input),
    },
    {
      name: 'locale auto-detect english',
      group: 'backend/locale',
      samples: LOCALE_CORPORA.english,
      fn: (input) => loaded.parse(input),
    },
  ]
}

function localeFor(input) {
  if (LOCALE_CORPORA.romance.indexOf(input) < 5) {
    return 'fr'
  }
  return LOCALE_CORPORA.romance.indexOf(input) < 8 ? 'es' : 'pt'
}

function runSuites(suites) {
  return suites.map((suite) => {
    const iterations = suite.iterations ?? args.iterations
    for (let i = 0; i < Math.min(10_000, iterations); i++) {
      consume(suite.fn(suite.samples[i % suite.samples.length]))
    }
    const samplesMs = []
    for (let s = 0; s < args.samples; s++) {
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        consume(suite.fn(suite.samples[i % suite.samples.length]))
      }
      samplesMs.push(performance.now() - start)
    }
    const medianMs = median(samplesMs)
    const opsPerSec = iterations / (medianMs / 1000)
    return {
      type: 'throughput',
      group: suite.group,
      name: suite.name,
      iterations,
      samples: args.samples,
      caseCount: suite.samples.length,
      medianMs,
      opsPerSec,
      usPerOp: (medianMs / iterations) * 1000,
    }
  })
}

function runProbes(probes) {
  return probes.map((probe) => {
    for (let i = 0; i < 3; i++) {
      consume(probe.fn(probe.input))
    }
    const samplesMs = []
    for (let i = 0; i < args.samples; i++) {
      const start = performance.now()
      consume(probe.fn(probe.input))
      samplesMs.push(performance.now() - start)
    }
    return {
      type: 'latency',
      group: probe.group,
      name: probe.name,
      samples: args.samples,
      medianMs: median(samplesMs),
    }
  })
}

function consume(value) {
  if (value == null) {
    sink += 1
  } else if (typeof value === 'number') {
    sink += value
  } else if (typeof value === 'string') {
    sink += value.length
  } else if (typeof value === 'object') {
    if ('ok' in value) {
      sink += value.ok ? 3 : 7
    } else if (Array.isArray(value)) {
      sink += value.length
    } else {
      sink += Object.keys(value).length
    }
  }
  if (sink > 1_000_000_000) {
    sink = sink % 9973
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function printReport(report) {
  console.log(`\n${report.package.name}@${report.package.version} ${report.target} benchmark`)
  console.log(runtimeLabel(report.runtime))
  console.table(
    report.results.map((r) => ({
      group: r.group,
      suite: r.name,
      'ops/s': Math.round(r.opsPerSec).toLocaleString('en-US'),
      'µs/op': r.usPerOp.toFixed(2),
      cases: r.caseCount?.toLocaleString('en-US') ?? '—',
      iterations: r.iterations.toLocaleString('en-US'),
    })),
  )
  console.table(
    report.probes.map((r) => ({
      group: r.group,
      probe: r.name,
      'median ms': r.medianMs.toFixed(3),
    })),
  )
}

function runtimeLabel(runtime) {
  if (runtime.userAgent) {
    return runtime.userAgent
  }
  return `${runtime.node} ${runtime.platform}/${runtime.arch} v8 ${runtime.v8}`
}

async function runBrowser() {
  const main = await import(`../dist/index.js?bench-browser=${Date.now()}`)
  const corpora = buildBackendCorpora(main.allKinds)
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (req.method === 'POST' && req.url === '/__bench_results') {
          const chunks = []
          req.on('data', (chunk) => chunks.push(chunk))
          req.on('end', () => {
            const report = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            res.writeHead(204)
            res.end()
            if (!args.json) {
              printReport(report)
            }
            server.close(() => resolve(report))
          })
          return
        }
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(
            browserHtml({
              packageJson,
              iterations: args.iterations,
              samples: args.samples,
              corpora,
            }),
          )
          return
        }
        if (req.url?.startsWith('/dist/')) {
          const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
          const file = normalize(join(ROOT, pathname))
          if (!file.startsWith(join(ROOT, 'dist'))) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
          const body = await readFile(file)
          res.writeHead(200, { 'content-type': contentType(file) })
          res.end(body)
          return
        }
        res.writeHead(404)
        res.end('Not found')
      } catch (error) {
        res.writeHead(500)
        res.end(String(error?.stack ?? error))
      }
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error(`Timed out waiting for browser benchmark after ${args.timeout} ms`))
    }, args.timeout)

    server.on('close', () => clearTimeout(timer))
    server.on('error', reject)
    server.listen(args.port, '127.0.0.1', () => {
      const address = server.address()
      const url = `http://127.0.0.1:${address.port}/`
      if (!args.json) {
        console.log(`\nBrowser benchmark URL: ${url}`)
      }
      if (args.open) {
        openUrl(url)
      }
    })
  })
}

function contentType(file) {
  if (extname(file) === '.js') {
    return 'text/javascript; charset=utf-8'
  }
  if (extname(file) === '.map') {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}

function openUrl(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
  child.unref()
}

function browserHtml({ packageJson: pkg, iterations, samples, corpora }) {
  const serializedCorpora = JSON.stringify({
    quantitySimple: corpora.quantitySimple,
    mixed: corpora.mixed,
    partial: corpora.partial,
    fieldSet: corpora.fieldSet,
    dateMixed: corpora.dateMixed,
    durationMixed: corpora.durationMixed,
    freeText: corpora.freeText,
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>lingo browser benchmark</title>
  <style>
    body { font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    table { border-collapse: collapse; margin-top: 16px; min-width: 720px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    th { color: #4b5563; font-weight: 600; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>lingo browser benchmark</h1>
  <p>Running <code>${pkg.name}@${pkg.version}</code>. Results post back to the terminal.</p>
  <div id="status">Running…</div>
  <div id="out"></div>
  <script type="module">
    import { lingo, parseQuantity, partialState, quantity, findQuantities } from '/dist/index.js'
    import { parseDate, parseDuration, humanizeDate, humanizeDuration } from '/dist/date/index.js'
    import { lingoInput } from '/dist/dom/index.js'

    const NOW = new Date(2026, 6, 3, 14, 30, 0)
    const ITERATIONS = ${Number(iterations)}
    const SAMPLES = ${Number(samples)}
    const CORPORA = ${serializedCorpora}
    let sink = 0

    function consume(value) {
      if (value == null) sink += 1
      else if (typeof value === 'number') sink += value
      else if (typeof value === 'string') sink += value.length
      else if (typeof value === 'object') {
        if ('ok' in value) sink += value.ok ? 3 : 7
        else if (Array.isArray(value)) sink += value.length
        else sink += Object.keys(value).length
      }
      if (sink > 1000000000) sink = sink % 9973
    }

    function median(values) {
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }

    function bench(suite) {
      const iterations = suite.iterations ?? ITERATIONS
      for (let i = 0; i < Math.min(10000, iterations); i++) {
        consume(suite.fn(suite.samples[i % suite.samples.length]))
      }
      const samplesMs = []
      for (let s = 0; s < SAMPLES; s++) {
        const start = performance.now()
        for (let i = 0; i < iterations; i++) {
          consume(suite.fn(suite.samples[i % suite.samples.length]))
        }
        samplesMs.push(performance.now() - start)
      }
      const medianMs = median(samplesMs)
      return {
        type: 'throughput',
        group: suite.group,
        name: suite.name,
        iterations,
        samples: SAMPLES,
        caseCount: suite.samples.length,
        medianMs,
        opsPerSec: iterations / (medianMs / 1000),
        usPerOp: (medianMs / iterations) * 1000,
      }
    }

    function probe(item) {
      for (let i = 0; i < 3; i++) consume(item.fn(item.input))
      const samplesMs = []
      for (let i = 0; i < SAMPLES; i++) {
        const start = performance.now()
        consume(item.fn(item.input))
        samplesMs.push(performance.now() - start)
      }
      return {
        type: 'latency',
        group: item.group,
        name: item.name,
        samples: SAMPLES,
        medianMs: median(samplesMs),
      }
    }

    const fieldInput = document.createElement('input')
    fieldInput.id = 'bench-field'
    document.body.append(fieldInput)
    const field = lingoInput(fieldInput, { kind: 'length', unit: 'm', name: 'height_m', debounce: 0 })

    const suites = [
      {
        name: 'browser parseQuantity simple',
        group: 'browser/core',
        samples: CORPORA.quantitySimple,
        fn: (input) => parseQuantity(input),
      },
      {
        name: 'browser lingo mixed',
        group: 'browser/core',
        samples: CORPORA.mixed,
        fn: (input) => lingo(input),
      },
      {
        name: 'browser partialState typing',
        group: 'browser/frontend',
        samples: CORPORA.partial,
        fn: (input) => partialState(input, { kind: 'length', unit: 'm' }),
      },
      {
        name: 'browser lingoInput field.set',
        group: 'browser/dom',
        iterations: Math.max(10000, Math.floor(ITERATIONS / 5)),
        samples: CORPORA.fieldSet,
        fn: (input) => {
          field.set(input)
          return field.value
        },
      },
      {
        name: 'browser parseDate mixed',
        group: 'browser/date',
        samples: CORPORA.dateMixed,
        fn: (input) => parseDate(input, { now: NOW }),
      },
      {
        name: 'browser parseDuration mixed',
        group: 'browser/date',
        samples: CORPORA.durationMixed,
        fn: (input) => parseDuration(input),
      },
      {
        name: 'browser format quantity',
        group: 'browser/format',
        samples: ['x'],
        fn: () => quantity(1.8034, 'm').format({ compound: ['ft', 'in'] }),
      },
      {
        name: 'browser humanizeDate',
        group: 'browser/date',
        samples: ['x'],
        fn: () => humanizeDate(new Date(2026, 6, 1, 14, 30), { now: NOW }),
      },
      {
        name: 'browser free text scan',
        group: 'browser/extraction',
        iterations: Math.max(10000, Math.floor(ITERATIONS / 5)),
        samples: CORPORA.freeText,
        fn: (input) => findQuantities(input),
      },
    ]

    const probes = [
      {
        name: 'browser 50k no match',
        group: 'browser/latency',
        input: 'a'.repeat(50000),
        fn: (input) => lingo(input),
      },
      {
        name: 'browser 20k unknown tail',
        group: 'browser/latency',
        input: '5 ' + 'x'.repeat(20000),
        fn: (input) => lingo(input),
      },
    ]

    const report = {
      version: 1,
      package: { name: '${pkg.name}', version: '${pkg.version}' },
      target: 'browser',
      createdAt: new Date().toISOString(),
      runtime: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      },
      corpus: {
        version: 2,
        kind: 'generated-english',
        description: 'Deterministic English-like cases generated from built-in unit aliases, number forms, qualifiers, ranges, conversions, typos, dates, durations, and sentence templates.',
      },
      results: suites.map(bench),
      probes: probes.map(probe),
    }
    field.destroy()

    document.querySelector('#status').textContent = 'Complete. Results posted to terminal.'
    document.querySelector('#out').innerHTML =
      '<table><thead><tr><th>Group</th><th>Suite</th><th>ops/s</th><th>µs/op</th></tr></thead><tbody>' +
      report.results.map((r) => '<tr><td>' + r.group + '</td><td>' + r.name + '</td><td>' + Math.round(r.opsPerSec).toLocaleString() + '</td><td>' + r.usPerOp.toFixed(2) + '</td></tr>').join('') +
      '</tbody></table>'

    await fetch('/__bench_results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    })
  </script>
</body>
</html>`
}

function compareBaseline(report, baselinePath, threshold) {
  if (!existsSync(baselinePath)) {
    throw new Error(`Baseline not found: ${baselinePath}`)
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const byName = new Map([
    ...baseline.results.map((r) => [r.name, r]),
    ...baseline.probes.map((r) => [r.name, r]),
  ])
  const regressions = []
  for (const current of [...report.results, ...report.probes]) {
    const previous = byName.get(current.name)
    if (!previous) {
      continue
    }
    const previousCost = previous.usPerOp ?? previous.medianMs
    const currentCost = current.usPerOp ?? current.medianMs
    const delta = ((currentCost - previousCost) / previousCost) * 100
    if (delta > threshold) {
      regressions.push({
        suite: current.name,
        previous: previousCost,
        current: currentCost,
        delta,
      })
    }
  }
  if (regressions.length === 0) {
    if (!args.json) {
      console.log(`\nNo benchmark regressions over ${threshold}%.`)
    }
    return
  }
  console.table(
    regressions.map((r) => ({
      suite: r.suite,
      previous: r.previous.toFixed(3),
      current: r.current.toFixed(3),
      'delta %': r.delta.toFixed(1),
    })),
  )
  process.exitCode = 1
}
