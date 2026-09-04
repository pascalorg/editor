import { readFileSync } from 'node:fs'
import { assertLlmsIndexLinks, buildLlmsIndex } from '../../../apps/site/src/lib/llms-index.ts'

assertLlmsIndexLinks()

// The served index advertises the entry points an agent is allowed to import.
// Adding an export without listing it here makes the entry invisible to every
// agent that reads /llms.txt and nothing else.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const index = buildLlmsIndex()
const missing = Object.keys(pkg.exports)
  .filter((entry) => entry !== './package.json' && !entry.startsWith('./locales/'))
  .map((entry) => (entry === '.' ? '@pascal-app/lingo' : `@pascal-app/lingo${entry.slice(1)}`))
  .filter((entry) => !index.includes(`\`${entry}\``))
if (!index.includes('@pascal-app/lingo/locales/')) {
  missing.push('@pascal-app/lingo/locales/*')
}
if (missing.length > 0) {
  throw new Error(`llms.txt index omits published entry points: ${missing.join(', ')}`)
}

console.log('llms.txt index link integrity ok; every published entry point is advertised')
