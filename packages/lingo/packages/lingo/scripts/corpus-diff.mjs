import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildContract } from '../tests/corpus/source.mjs'

const ROOT = new URL('..', import.meta.url)
const CONTRACT_URL = new URL('tests/corpus/contract-v1.json', ROOT)
const args = new Set(process.argv.slice(2))
const reportOnly = args.has('--report-only')
const write = args.has('--write')

const indexUrl = new URL('dist/index.js', ROOT)
const dateUrl = new URL('dist/date/index.js', ROOT)

if (!(existsSync(indexUrl) && existsSync(dateUrl))) {
  console.error('Corpus diff needs built dist output. Run `bun run build` first.')
  process.exit(1)
}

const [{ lingo, createLingo }, { parseDate, parseDateRange }] = await Promise.all([
  import(indexUrl.href),
  import(dateUrl.href),
])

const current = buildContract({ lingo, parseDate, parseDateRange })

if (write) {
  writeFileSync(CONTRACT_URL, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Wrote ${relative(CONTRACT_URL)}`)
}

if (!(write || existsSync(CONTRACT_URL))) {
  console.error(
    `${relative(CONTRACT_URL)} is missing. Run node scripts/corpus-diff.mjs --write after build.`,
  )
  process.exit(reportOnly ? 0 : 1)
}

if (!write) {
  const expected = JSON.parse(readFileSync(CONTRACT_URL, 'utf8'))
  const changes = diffContract(expected, current)
  const additive = changes.filter((change) => change.classification === 'ADDITIVE')
  const breaking = changes.filter((change) => change.classification === 'BREAKING')

  if (changes.length === 0) {
    console.log('Corpus contract: zero changes.')
  } else {
    console.log(`Corpus contract: ${additive.length} additive, ${breaking.length} breaking.`)
    for (const change of changes) {
      console.log(`${change.classification} ${change.path}: ${change.reason}`)
    }
  }

  if (breaking.length > 0 && !reportOnly) {
    process.exit(1)
  }
}

// ─── Locale corpus discovery ────────────────────────────────────────────────
// Auto-discover locale-*-source.mjs files and check/write their contracts.

const corpusDir = new URL('tests/corpus/', ROOT)
const localeSourceFiles = readdirSync(corpusDir)
  .filter((f) => /^locale-[a-z]+-source\.mjs$/.test(f))
  .sort()

let localePacksCache = null
async function getLocalePacks() {
  if (localePacksCache) {
    return localePacksCache
  }
  const localeDir = new URL('dist/locales/', ROOT)
  if (!existsSync(localeDir)) {
    return []
  }
  const files = readdirSync(localeDir).filter((f) => f.endsWith('.js') && f !== 'index.js')
  const packs = []
  for (const f of files) {
    const mod = await import(new URL(`dist/locales/${f}`, ROOT).href)
    const pack = mod.default ?? Object.values(mod)[0]
    if (pack?.locale) {
      packs.push(pack)
    }
  }
  localePacksCache = packs
  return packs
}

let localeBreaking = false
for (const sourceFile of localeSourceFiles) {
  const id = sourceFile.replace('locale-', '').replace('-source.mjs', '')
  const contractFile = `locale-${id}-contract-v1.json`
  const contractUrl = new URL(`tests/corpus/${contractFile}`, ROOT)
  const sourceUrl = new URL(`tests/corpus/${sourceFile}`, ROOT)

  const localeMod = await import(sourceUrl.href)
  const localePacks = await getLocalePacks()
  const localeInstance = createLingo({ locales: localePacks })
  const localeLingo = localeInstance.parse
  const localeCurrent = localeMod.buildContract({
    lingo: localeLingo,
    localePacks,
    parseDate,
    parseDateRange,
  })

  if (write) {
    writeFileSync(contractUrl, `${JSON.stringify(localeCurrent, null, 2)}\n`)
    console.log(`Wrote ${relative(contractUrl)}`)
    continue
  }

  if (!existsSync(contractUrl)) {
    console.error(
      `${relative(contractUrl)} is missing. Run node scripts/corpus-diff.mjs --write after build.`,
    )
    if (!reportOnly) {
      localeBreaking = true
    }
    continue
  }

  const localeExpected = JSON.parse(readFileSync(contractUrl, 'utf8'))
  const localeChanges = diffContract(localeExpected, localeCurrent)
  const localeAdditive = localeChanges.filter((c) => c.classification === 'ADDITIVE')
  const localeBreakingChanges = localeChanges.filter((c) => c.classification === 'BREAKING')

  if (localeChanges.length === 0) {
    console.log(`Locale corpus [${id}]: zero changes.`)
  } else {
    console.log(
      `Locale corpus [${id}]: ${localeAdditive.length} additive, ${localeBreakingChanges.length} breaking.`,
    )
    for (const change of localeChanges) {
      console.log(`  ${change.classification} ${change.path}: ${change.reason}`)
    }
  }

  if (localeBreakingChanges.length > 0 && !reportOnly) {
    localeBreaking = true
  }
}

if (localeBreaking) {
  process.exit(1)
}
if (write) {
  process.exit(0)
}

function diffContract(expectedRoot, currentRoot) {
  const changes = []
  compareMeta('version', expectedRoot.version, currentRoot.version, changes)
  compareMeta('fixedNow', expectedRoot.fixedNow, currentRoot.fixedNow, changes)
  compareGroup('breadth', expectedRoot.breadth ?? {}, currentRoot.breadth ?? {}, changes)
  compareGroup('date', expectedRoot.date ?? {}, currentRoot.date ?? {}, changes)
  compareGroup('dateRange', expectedRoot.dateRange ?? {}, currentRoot.dateRange ?? {}, changes)
  return changes
}

function compareMeta(path, expected, current, changes) {
  if (same(expected, current)) {
    return
  }
  changes.push({ classification: 'BREAKING', path, reason: 'contract metadata changed' })
}

function compareGroup(group, expectedEntries, currentEntries, changes) {
  const expectedKeys = new Set(Object.keys(expectedEntries))
  const currentKeys = new Set(Object.keys(currentEntries))

  for (const key of currentKeys) {
    if (!expectedKeys.has(key)) {
      changes.push({
        classification: 'ADDITIVE',
        path: `${group}.${key}`,
        reason: 'new corpus entry',
      })
    }
  }

  for (const key of expectedKeys) {
    const path = `${group}.${key}`
    if (!currentKeys.has(key)) {
      changes.push({ classification: 'BREAKING', path, reason: 'corpus entry disappeared' })
      continue
    }
    const expected = expectedEntries[key]
    const current = currentEntries[key]
    if (same(expected, current)) {
      continue
    }
    const classification =
      expected.type === 'fail' && current.type !== 'fail' ? 'ADDITIVE' : 'BREAKING'
    const reason =
      classification === 'ADDITIVE'
        ? 'existing input now parses'
        : 'existing interpretation changed'
    changes.push({ classification, path, reason })
  }
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function relative(url) {
  return url.pathname.replace(ROOT.pathname, '')
}
