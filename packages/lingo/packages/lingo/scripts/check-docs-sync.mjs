import { existsSync, readFileSync } from 'node:fs'
import { allKinds } from '../dist/index.js'
import { ISSUE_CODES } from '../dist/schema/index.js'

const ROOT = new URL('../../..', import.meta.url)
const files = [
  new URL('packages/lingo/llms.txt', ROOT),
  new URL('apps/site/public/llms-small.txt', ROOT),
]
const pkg = JSON.parse(readFileSync(new URL('packages/lingo/package.json', ROOT), 'utf8'))
const expectedKinds = allKinds.map((kind) => kind.kind).join(' ')
const expectedCodes = Array.isArray(ISSUE_CODES) ? ISSUE_CODES : Object.keys(ISSUE_CODES)
// Locale packs are advertised as one braced group, not one line per language.
const expectedEntries = Object.keys(pkg.exports)
  .filter((entry) => entry !== './package.json' && !entry.startsWith('./locales/'))
  .map((entry) => (entry === '.' ? '@pascal-app/lingo' : `@pascal-app/lingo${entry.slice(1)}`))
let failed = false

for (const file of files) {
  if (!existsSync(file)) {
    fail(`missing ${relative(file)}`)
    continue
  }
  const text = readFileSync(file, 'utf8')

  const actualKinds = text.match(/^Kinds: ([^.]+)\./m)?.[1]
  if (actualKinds !== expectedKinds) {
    fail(
      `${relative(file)} Kinds line is ${JSON.stringify(actualKinds)}, expected ${JSON.stringify(expectedKinds)}`,
    )
  }

  // Every published entry point must be reachable from the agent docs, or an
  // agent reading only llms.txt never learns the entry exists.
  const missingEntries = expectedEntries.filter((entry) => !text.includes(entry))
  if (missingEntries.length > 0) {
    fail(`${relative(file)} never mentions published entries: ${missingEntries.join(', ')}`)
  }
  if (!text.includes('@pascal-app/lingo/locales/')) {
    fail(`${relative(file)} never mentions the locale pack entries`)
  }

  const missingCodes = expectedCodes.filter((code) => !text.includes(code))
  if (missingCodes.length > 0) {
    fail(`${relative(file)} omits issue codes: ${missingCodes.join(', ')}`)
  }
}

// `bun run site:sync` copies llms.txt verbatim, so any drift means the served
// copy is stale — the exact failure mode a presence check above cannot see.
if (files.every((file) => existsSync(file))) {
  const [source, served] = files.map((file) => readFileSync(file, 'utf8'))
  if (source !== served) {
    fail(
      `${relative(files[1])} is out of date with ${relative(files[0])} — run \`bun run site:sync\``,
    )
  }
}

if (failed) {
  process.exit(1)
}

console.log(
  `Docs sync gate ok: llms.txt files match allKinds (${allKinds.length}), ${expectedEntries.length} entry points, and ${expectedCodes.length} issue codes.`,
)

function fail(message) {
  console.error(`Docs sync check failed: ${message}`)
  failed = true
}

function relative(url) {
  return url.pathname.replace(ROOT.pathname, '')
}
