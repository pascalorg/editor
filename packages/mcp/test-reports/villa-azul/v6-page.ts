/**
 * Villa Azul — Phase 9 Verifier V6: Next.js page render checks.
 * Usage:
 *   bun run packages/mcp/test-reports/villa-azul/v6-page.ts
 * Assumes editor is running at http://localhost:3002.
 */

const BASE = 'http://localhost:3002'
const SCENE_ID = 'a6e7919eacbe'
const REPORT_PATH = 'packages/mcp/test-reports/villa-azul/v6-page.md'

type FetchResult = {
  url: string
  status: number
  bytes: number
  elapsedMs: number
  text: string
}

async function fetchPage(path: string): Promise<FetchResult> {
  const url = `${BASE}${path}`
  const start = performance.now()
  const res = await fetch(url)
  const text = await res.text()
  const elapsedMs = performance.now() - start
  return {
    url,
    status: res.status,
    bytes: new TextEncoder().encode(text).length,
    elapsedMs,
    text,
  }
}

function contains(text: string, needle: string): boolean {
  return text.includes(needle)
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

type Check = { label: string; pass: boolean; detail: string }
const checks: Check[] = []

const ERROR_STRINGS = ['Application error', 'Hydration', 'Failed to']

// === 1. /scene/a6e7919eacbe ===
console.log(`---- V6 page verifier ----`)
const scene = await fetchPage(`/scene/${SCENE_ID}`)
console.log(
  `01 /scene/${SCENE_ID}  status=${scene.status} bytes=${scene.bytes} time=${scene.elapsedMs.toFixed(1)}ms`,
)

checks.push({
  label: 'scene: 200 status',
  pass: scene.status === 200,
  detail: `got ${scene.status}`,
})
checks.push({
  label: 'scene: HTML >= 10 KB',
  pass: scene.bytes >= 10_000,
  detail: `${scene.bytes} bytes`,
})
checks.push({
  label: "scene: contains 'SceneLoader'",
  pass: contains(scene.text, 'SceneLoader'),
  detail: '',
})
checks.push({
  label: `scene: contains sceneId '${SCENE_ID}'`,
  pass: contains(scene.text, SCENE_ID),
  detail: '',
})
checks.push({
  label: "scene: contains 'Villa Azul'",
  pass: contains(scene.text, 'Villa Azul'),
  detail: '',
})
const hasEditorChunk =
  contains(scene.text, '@pascal-app/editor') ||
  contains(scene.text, '/packages/editor/') ||
  contains(scene.text, 'packages_editor')
const hasViewerChunk =
  contains(scene.text, '@pascal-app/viewer') ||
  contains(scene.text, '/packages/viewer/') ||
  contains(scene.text, 'packages_viewer')
checks.push({
  label: 'scene: references editor or viewer chunks',
  pass: hasEditorChunk || hasViewerChunk,
  detail: `editor=${hasEditorChunk} viewer=${hasViewerChunk}`,
})
const errorsFound = ERROR_STRINGS.filter((s) => contains(scene.text, s))
checks.push({
  label: 'scene: no obvious error strings',
  pass: errorsFound.length === 0,
  detail: errorsFound.length ? `found ${errorsFound.join(', ')}` : 'clean',
})

// === 2. /scene/nope ===
const nope = await fetchPage(`/scene/nope`)
console.log(
  `02 /scene/nope        status=${nope.status} bytes=${nope.bytes} time=${nope.elapsedMs.toFixed(1)}ms`,
)

const isNotFoundResponse = nope.status === 404 || contains(nope.text, 'Scene not found')
checks.push({
  label: 'nope: 404 or Scene-not-found page',
  pass: isNotFoundResponse,
  detail: `status=${nope.status} hasFallback=${contains(nope.text, 'Scene not found')}`,
})
// If status 200, it should be a fallback page that has no SceneLoader initialized
// If status 404, content should also NOT contain SceneLoader
const nopeHasSceneLoader = contains(nope.text, 'SceneLoader')
checks.push({
  label: 'nope: does NOT initialize SceneLoader',
  pass: !nopeHasSceneLoader,
  detail: nopeHasSceneLoader ? 'found SceneLoader' : 'not found',
})
checks.push({
  label: 'nope: does NOT contain Villa Azul',
  pass: !contains(nope.text, 'Villa Azul'),
  detail: '',
})

// === 3. /scenes ===
const scenes = await fetchPage(`/scenes`)
console.log(
  `03 /scenes            status=${scenes.status} bytes=${scenes.bytes} time=${scenes.elapsedMs.toFixed(1)}ms`,
)

checks.push({
  label: 'scenes: 200 status',
  pass: scenes.status === 200,
  detail: `got ${scenes.status}`,
})
checks.push({
  label: `scenes: contains link /scene/${SCENE_ID}`,
  pass: contains(scenes.text, `/scene/${SCENE_ID}`),
  detail: '',
})
checks.push({
  label: "scenes: contains 'Villa Azul'",
  pass: contains(scenes.text, 'Villa Azul'),
  detail: '',
})

// === 4. /scenes link count ===
const linkRe = /<a\s[^>]*href="\/scene\/[^"]+"/g
const linkCount = countMatches(scenes.text, linkRe)
console.log(`04 /scene/... links on /scenes = ${linkCount}`)
checks.push({
  label: 'scenes: >=1 <a href="/scene/..."> link',
  pass: linkCount >= 1,
  detail: `count=${linkCount}`,
})

// === Report ===
const pass = checks.filter((c) => c.pass).length
const fail = checks.filter((c) => !c.pass).length
console.log(`\n=== V6 SUMMARY ===`)
console.log(`pass=${pass} fail=${fail}`)
for (const c of checks) {
  console.log(`  ${c.pass ? 'OK' : 'FAIL'}  ${c.label}  ${c.detail}`)
}

// === Build markdown report ===
const lines: string[] = []
lines.push('# V6 — Next.js Page Render Verification')
lines.push('')
lines.push(`- Scene ID: \`${SCENE_ID}\``)
lines.push(`- Base URL: \`${BASE}\``)
lines.push(`- Generated: ${new Date().toISOString()}`)
lines.push(`- Overall: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass}/${checks.length})`)
lines.push('')
lines.push('## Request summary')
lines.push('')
lines.push('| Path | Status | Bytes | Time (ms) |')
lines.push('|---|---|---|---|')
for (const r of [scene, nope, scenes]) {
  const path = r.url.replace(BASE, '')
  lines.push(`| \`${path}\` | ${r.status} | ${r.bytes} | ${r.elapsedMs.toFixed(1)} |`)
}
lines.push('')
lines.push('## Checks')
lines.push('')
lines.push('| Result | Check | Detail |')
lines.push('|---|---|---|')
for (const c of checks) {
  lines.push(`| ${c.pass ? 'PASS' : 'FAIL'} | ${c.label} | ${c.detail} |`)
}
lines.push('')
lines.push('## Strings-found snapshot')
lines.push('')
lines.push(`### \`/scene/${SCENE_ID}\``)
lines.push('')
lines.push(`- SceneLoader present: ${contains(scene.text, 'SceneLoader')}`)
lines.push(`- sceneId '${SCENE_ID}' present: ${contains(scene.text, SCENE_ID)}`)
lines.push(`- 'Villa Azul' present: ${contains(scene.text, 'Villa Azul')}`)
lines.push(`- editor chunk reference: ${hasEditorChunk}`)
lines.push(`- viewer chunk reference: ${hasViewerChunk}`)
lines.push(`- error strings found: ${errorsFound.length ? errorsFound.join(', ') : 'none'}`)
lines.push('')
lines.push('### `/scene/nope`')
lines.push('')
lines.push(`- status: ${nope.status}`)
lines.push(`- 'Scene not found' fallback: ${contains(nope.text, 'Scene not found')}`)
lines.push(`- SceneLoader NOT present: ${!nopeHasSceneLoader}`)
lines.push(`- 'Villa Azul' NOT present: ${!contains(nope.text, 'Villa Azul')}`)
lines.push('')
lines.push('### `/scenes`')
lines.push('')
lines.push(`- '/scene/${SCENE_ID}' link present: ${contains(scenes.text, `/scene/${SCENE_ID}`)}`)
lines.push(`- 'Villa Azul' present: ${contains(scenes.text, 'Villa Azul')}`)
lines.push(`- <a href="/scene/..."> link count: ${linkCount}`)
lines.push('')
lines.push('## Response times')
lines.push('')
lines.push(`- /scene/${SCENE_ID}: ${scene.elapsedMs.toFixed(1)} ms`)
lines.push(`- /scene/nope: ${nope.elapsedMs.toFixed(1)} ms`)
lines.push(`- /scenes: ${scenes.elapsedMs.toFixed(1)} ms`)
lines.push('')

await Bun.write(REPORT_PATH, lines.join('\n'))
console.log(`\nwrote ${REPORT_PATH}`)

if (fail > 0) process.exit(1)
