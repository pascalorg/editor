import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FRAMING =
  'Canonicalization-rate demo on a recorded corpus, not an end-to-end LLM benchmark.'
export const FIXED_NOW_PARTS = [2026, 6, 3, 14, 30, 0]
export const CATEGORY_ORDER = [
  'unit-omission',
  'unit-in-number-field',
  'locale-decimal-comma',
  'thousands-separator',
  'date-drift-nl-in-date-field',
  'scientific-notation',
  'range-in-scalar',
  'qualifier-leakage',
  'typod-slang-units',
  'compound-mixed-unit',
]

const ROOT_URL = new URL('..', import.meta.url)
const ROOT = fileURLToPath(ROOT_URL)
const CORPUS_URL = new URL('tests/fixtures/ai-eval-corpus.json', ROOT_URL)
const DIST_AI_URL = new URL('dist/ai/index.js', ROOT_URL)
const BENCH_URL = new URL('bench/ai-eval.json', ROOT_URL)

export function fixedNow() {
  return new Date(...FIXED_NOW_PARTS)
}

export function loadCorpus(url = CORPUS_URL) {
  return JSON.parse(readFileSync(url, 'utf8'))
}

export function validateCorpus(corpus) {
  const errors = []
  if (!Array.isArray(corpus)) {
    return ['Corpus must be an array.']
  }
  if (corpus.length < 150) {
    errors.push(`Corpus has ${corpus.length} entries; expected at least 150.`)
  }

  const ids = new Set()
  const categories = new Set()
  const provenance = new Set()
  for (const [index, entry] of corpus.entries()) {
    const prefix = `entry ${index}`
    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix}: must be an object.`)
      continue
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      errors.push(`${prefix}: id is required.`)
    } else if (ids.has(entry.id)) {
      errors.push(`${entry.id}: duplicate id.`)
    } else {
      ids.add(entry.id)
    }
    if (CATEGORY_ORDER.includes(entry.category)) {
      categories.add(entry.category)
    } else {
      errors.push(`${entry.id}: unknown category ${entry.category}.`)
    }
    if (entry.provenance !== 'documented' && entry.provenance !== 'synthesized') {
      errors.push(`${entry.id}: provenance must be documented or synthesized.`)
    } else {
      provenance.add(entry.provenance)
    }
    if (!validField(entry.field)) {
      errors.push(`${entry.id}: invalid field spec.`)
    }
    if (!('raw' in entry)) {
      errors.push(`${entry.id}: raw is required.`)
    }
    if (!('expected' in entry)) {
      errors.push(`${entry.id}: expected is required.`)
    }
  }

  for (const category of CATEGORY_ORDER) {
    if (!categories.has(category)) {
      errors.push(`Missing category ${category}.`)
    }
  }
  for (const tag of ['documented', 'synthesized']) {
    if (!provenance.has(tag)) {
      errors.push(`Missing provenance tag ${tag}.`)
    }
  }
  return errors
}

export function evaluateCorpus(corpus, ai, options = {}) {
  const errors = validateCorpus(corpus)
  if (errors.length > 0) {
    throw new Error(`Invalid AI eval corpus:\n${errors.join('\n')}`)
  }

  const now = options.now ?? fixedNow()
  const results = corpus.map((fixture) => evaluateFixture(fixture, ai, now))
  const categories = CATEGORY_ORDER.map((category) =>
    summarizeGroup(
      category,
      results.filter((result) => result.category === category),
    ),
  )
  const overall = summarizeGroup('overall', results)
  return {
    framing: FRAMING,
    environment: environment(corpus.length, now),
    overall,
    categories,
    results,
  }
}

export function consoleRows(report) {
  return [...report.categories, report.overall].map((row) => ({
    category: row.category,
    fixtures: row.count,
    documented: row.provenance.documented,
    synthesized: row.provenance.synthesized,
    'naive accept': formatRate(row.naive.acceptanceRate),
    'lingo accept': formatRate(row.lingo.acceptanceRate),
    'naive wrong': formatRate(row.naive.silentWrongRate),
    'lingo wrong': formatRate(row.lingo.silentWrongRate),
  }))
}

export async function loadDistAi() {
  if (!existsSync(DIST_AI_URL)) {
    buildDist()
  }
  return import(DIST_AI_URL.href)
}

export async function runCli() {
  const ai = await loadDistAi()
  const corpus = loadCorpus()
  const report = evaluateCorpus(corpus, ai)
  const output = {
    framing: report.framing,
    environment: report.environment,
    overall: stripResults(report.overall),
    categories: report.categories.map(stripResults),
  }

  mkdirSync(dirname(fileURLToPath(BENCH_URL)), { recursive: true })
  writeFileSync(BENCH_URL, `${JSON.stringify(output, null, 2)}\n`)

  console.log(FRAMING)
  console.table(consoleRows(report))
  console.log(`Wrote ${relative(BENCH_URL)}`)
}

function evaluateFixture(fixture, ai, now) {
  const naive = receiveNaive(fixture)
  const lingo = receiveLingo(fixture, ai, now)
  return {
    id: fixture.id,
    category: fixture.category,
    provenance: fixture.provenance,
    expected: fixture.expected,
    naive,
    lingo,
  }
}

function receiveNaive(fixture) {
  const value = fixture.field.date === true ? naiveDate(fixture.raw) : naiveNumber(fixture.raw)
  return receiverResult(value, fixture.expected, fixture.expectWrongIfNaive)
}

function receiveLingo(fixture, ai, now) {
  const field = fieldForFixture(fixture, ai, now)
  const parsed = field.safeParse(fixture.raw)
  const value = 'value' in parsed ? parsed.value : undefined
  return receiverResult(value, fixture.expected)
}

function fieldForFixture(fixture, ai, now) {
  if (fixture.field.date === true) {
    const { date, ...opts } = fixture.field
    return ai.dateField({ now, ...opts })
  }
  if (isRangeExpected(fixture.expected)) {
    return ai.rangeField(fixture.field)
  }
  return ai.quantityField(fixture.field)
}

function receiverResult(value, expected, expectedWrong) {
  if (value === undefined) {
    return { accepted: false, wrong: false }
  }
  const wrong = !sameValue(value, expected)
  const result = { accepted: true, wrong, value }
  if (expectedWrong !== undefined && !sameValue(value, expectedWrong)) {
    result.expectWrongMismatch = { expectedWrong, actual: value }
  }
  return result
}

function summarizeGroup(category, rows) {
  const count = rows.length
  const provenance = { documented: 0, synthesized: 0 }
  for (const row of rows) {
    provenance[row.provenance] += 1
  }
  return {
    category,
    count,
    provenance,
    naive: receiverStats(rows, 'naive'),
    lingo: receiverStats(rows, 'lingo'),
  }
}

function receiverStats(rows, key) {
  const accepted = rows.filter((row) => row[key].accepted).length
  const silentWrong = rows.filter((row) => row[key].wrong).length
  const count = rows.length
  return {
    accepted,
    rejected: count - accepted,
    silentWrong,
    acceptanceRate: count === 0 ? 0 : accepted / count,
    silentWrongRate: count === 0 ? 0 : silentWrong / count,
  }
}

function stripResults(row) {
  return {
    category: row.category,
    count: row.count,
    provenance: row.provenance,
    naive: row.naive,
    lingo: row.lingo,
  }
}

function naiveNumber(raw) {
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function naiveDate(raw) {
  const date = new Date(raw)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  if (isRangeExpected(a) && isRangeExpected(b)) {
    return sameValue(a.min, b.min) && sameValue(a.max, b.max)
  }
  return a === b
}

function isRangeExpected(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.min === 'number' &&
    typeof value.max === 'number'
  )
}

function validField(field) {
  if (!field || typeof field !== 'object') {
    return false
  }
  if (field.date === true) {
    return true
  }
  return typeof field.kind === 'string' && typeof field.unit === 'string'
}

function buildDist() {
  const tsup = fileURLToPath(new URL('node_modules/.bin/tsup', ROOT_URL))
  const result = spawnSync(tsup, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error('Failed to build dist with ./node_modules/.bin/tsup.')
  }
}

function environment(corpusSize, now) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    fixedNowParts: FIXED_NOW_PARTS,
    fixedNowIso: now.toISOString(),
    corpusSize,
  }
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`
}

function relative(url) {
  return fileURLToPath(url).replace(ROOT, '').replace(/^\//, '')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
