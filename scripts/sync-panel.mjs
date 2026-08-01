#!/usr/bin/env node
/**
 * Pushes the vendored console back to its own repository.
 *
 * The console lives here as a copy (`apps/editor/panel/`, imported as
 * `@panel/*`), so fixes made while integrating it — MariaDB portability, the
 * stricter null handling this repo's TypeScript demands, the mail templates —
 * would otherwise be stranded. This walks the copy, undoes the two
 * integration-time transformations (import prefix, directory layout) and writes
 * the result into a checkout of ovurrsl/panel.
 *
 * Two sync rules, deliberately different:
 *
 *   library  — `panel/{lib,components,migrations}` and the three scripts are
 *              the console itself. New files here are created upstream.
 *   routes   — `app/(panel)` and `app/api` hold console routes mixed with the
 *              editor's own. A file is updated only if the same path already
 *              exists upstream; anything else is an editor route and is left
 *              alone. That rule needs no list to maintain.
 *
 * Usage:
 *   node scripts/sync-panel.mjs --panel <path-to-panel-checkout> [--check]
 *
 * `--check` writes nothing and exits 1 when the two sides differ, which is what
 * CI runs to notice that a sync is owed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const EDITOR = join(REPO, 'apps/editor')

/** [source under apps/editor, destination in the panel repo, create-new?] */
const LIBRARY = [
  ['panel/lib', 'src/lib', true],
  ['panel/components', 'src/components', true],
  ['panel/migrations', 'db/migrations', true],
  ['panel/globals.css', 'src/app/globals.css', true],
  ['panel/env.ts', 'scripts/env.ts', true],
  ['panel/migrate.ts', 'scripts/migrate.ts', true],
  ['panel/seed.ts', 'scripts/seed.ts', true],
]

const ROUTES = [
  ['app/(panel)', 'src/app', false],
  ['app/api', 'src/app/api', false],
]

/**
 * Route files the console cannot use: they exist upstream but the editor's
 * copies are deliberately different, because the editor owns the shell and
 * bridges identity into its own session type.
 */
const EDITOR_OWNED = new Set(['src/app/layout.tsx', 'src/app/page.tsx'])

const SYNCABLE = /\.(ts|tsx|css|sql)$/

function files(root) {
  if (!existsSync(root)) return []
  if (statSync(root).isFile()) return [root]
  const out = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (SYNCABLE.test(entry)) out.push(path)
  }
  return out
}

/** Undo the import rewrite the vendoring applied. Nothing else is touched. */
function toUpstream(source) {
  return source.replace(/@panel\//g, '@/')
}

function plan(panelRoot) {
  const actions = []
  for (const [from, to, create] of [...LIBRARY, ...ROUTES]) {
    const source = join(EDITOR, from)
    const isFile = existsSync(source) && statSync(source).isFile()
    for (const file of files(source)) {
      const rel = isFile ? '' : relative(source, file)
      const target = isFile ? to : join(to, rel)
      if (EDITOR_OWNED.has(target)) continue
      const absolute = join(panelRoot, target)
      if (!create && !existsSync(absolute)) continue
      const next = toUpstream(readFileSync(file, 'utf8'))
      const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
      if (current === next) continue
      actions.push({ target, absolute, next, kind: current === null ? 'new' : 'changed' })
    }
  }
  return actions.sort((a, b) => a.target.localeCompare(b.target))
}

const args = process.argv.slice(2)
const panelRoot = args[args.indexOf('--panel') + 1]
const checkOnly = args.includes('--check')

if (!panelRoot || panelRoot.startsWith('--')) {
  console.error('usage: node scripts/sync-panel.mjs --panel <path> [--check]')
  process.exit(2)
}
if (!existsSync(join(panelRoot, 'src/lib'))) {
  console.error(`${panelRoot} does not look like a checkout of ovurrsl/panel (no src/lib).`)
  process.exit(2)
}

const actions = plan(panelRoot)

if (actions.length === 0) {
  console.log('panel is in sync — nothing to push')
  process.exit(0)
}

for (const action of actions) {
  console.log(`${action.kind === 'new' ? 'new    ' : 'changed'}  ${action.target}`)
}
console.log(`\n${actions.length} file(s)`)

if (checkOnly) {
  console.error('\nthe console copy has moved ahead of its repository; run the sync')
  process.exit(1)
}

for (const action of actions) {
  mkdirSync(dirname(action.absolute), { recursive: true })
  writeFileSync(action.absolute, action.next)
}
console.log('written')
