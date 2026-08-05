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
 * Files the console cannot use, by destination path.
 *
 * Two groups, for two different reasons.
 *
 * The shell (`layout.tsx`, `page.tsx`) exists upstream but the editor's copies
 * are deliberately different, because the editor owns the shell and bridges
 * identity into its own session type.
 *
 * The scenes and guides tabs are integration-only. Their backing endpoints
 * cannot exist upstream: `/api/guides` imports the editor's own
 * `@/lib/guides-content` and `@/lib/scene-api-security`, and `/api/admin/scenes`
 * reads a `scenes` table that no migration in this set creates — the console's
 * schema only carries `sites.scene_id`. `ROUTES` already declines to push those
 * endpoints (create-new is `false` there), so syncing the tabs would give the
 * standalone console two rail entries whose fetches 404, and `console-tabs.ts`
 * is what registers them.
 *
 * `tab-content.tsx` joins them because it imports both tabs and switches on
 * their names: holding the tabs back while pushing their only caller is what
 * turns a missing feature into a repository that does not compile.
 *
 * `api/health/route.ts` is the same shape one layer down — the editor's copy
 * reaches for `@/lib/auth/db` and `@/lib/scene-store-server`, neither of which
 * exists upstream.
 *
 * The cost of holding `console-tabs.ts` back is that changes to the SHARED
 * tabs' metadata no longer reach upstream either. That is the price of a file
 * that must legitimately differ between the two deployments; splitting the list
 * into a base the console owns and an extension the editor adds would remove
 * the conflict properly, and is the real fix when someone has the appetite.
 *
 * Every entry here was found by running `tsc --noEmit` in a checkout of
 * ovurrsl/panel with the sync applied. The test suite passed with all of them
 * still missing, so the type checker is the only thing that catches this class
 * of breakage — keep using it when this list changes.
 */
const EDITOR_OWNED = new Set([
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/api/health/route.ts',
  'src/lib/console-tabs.ts',
  'src/components/console/tab-content.tsx',
  'src/components/console/scenes-tab.tsx',
  'src/components/console/guides-tab.tsx',
])

const SYNCABLE = /\.(ts|tsx|css|sql)$/

/**
 * Tests do not cross. The two repositories run different runners — this one is
 * on `bun:test`, the console is on vitest — so a test file pushed upstream is
 * one vitest cannot execute and `tsc` cannot resolve (`Cannot find module
 * 'bun:test'`). The console's own suite lives in `tests/`, outside every
 * mapping in this file, so nothing here can reach it either way.
 */
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/

function files(root) {
  if (!existsSync(root)) return []
  if (statSync(root).isFile()) return [root]
  const out = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (SYNCABLE.test(entry) && !TEST_FILE.test(entry)) out.push(path)
  }
  return out
}

/** Undo the import rewrite the vendoring applied. Nothing else is touched. */
function toUpstream(source) {
  return source.replace(/@panel\//g, '@/')
}

/**
 * Reapply it.
 *
 * The forward rewrite is LOSSY: `@panel/x` and a literal `@/x` both leave as
 * `@/x`, so this direction cannot tell them apart and turns every `@/` into
 * `@panel/`. That is correct for a console file, where `@/` can only mean the
 * console's own `src`, and it constrains the vendored copy: a synced file under
 * `apps/editor/panel/` must never contain a bare `@/`, in an import OR in
 * prose. One did — a comment naming `@/lib/escape-layers` — and it would have
 * ping-ponged forever, each direction "fixing" what the other just wrote.
 *
 * That mistake has a signature worth knowing: `--check` says in sync one way
 * and names a file the other way. If you see it, the file has a bare `@/`.
 */
function toVendored(source) {
  return source.replace(/@\//g, '@panel/')
}

/**
 * The pairs to walk, for one direction.
 *
 * Pull inverts the same tables rather than declaring its own, so the two
 * directions cannot drift apart — a mapping added for one is a mapping the
 * other gets for free.
 *
 * Inverting is not a swap, because the console's tree nests where the editor's
 * does not: `src/app/api` and `src/app/globals.css` both live INSIDE `src/app`.
 * Walking `src/app` naively would drag the console's endpoints into
 * `app/(panel)/api/` and its stylesheet into `app/(panel)/globals.css`, both
 * wrong and both silent. Longest source path first, and the first pair to claim
 * a file keeps it.
 *
 * `create` is dropped on pull, i.e. every pair creates. Its `false` on `ROUTES`
 * protects the CONSOLE from receiving editor-only routes; the mirror risk —
 * the editor receiving a console route it does not have — is not a risk but
 * the entire point, since a new console endpoint is exactly what the editor
 * needs to pick up.
 */
function pairsFor(pull) {
  const declared = [...LIBRARY, ...ROUTES]
  if (!pull) return declared.map(([from, to, create]) => ({ from, to, create }))
  return declared
    .map(([from, to]) => ({ from: to, to: from, create: true }))
    .sort((a, b) => b.from.length - a.from.length)
}

function plan(panelRoot, pull) {
  const actions = []
  const claimed = new Set()
  const sourceRoot = pull ? panelRoot : EDITOR
  const destRoot = pull ? EDITOR : panelRoot

  for (const { from, to, create } of pairsFor(pull)) {
    const source = join(sourceRoot, from)
    const isFile = existsSync(source) && statSync(source).isFile()
    for (const file of files(source)) {
      const rel = isFile ? '' : relative(source, file)
      const origin = isFile ? from : join(from, rel)
      // A file the console owns can be reached by two pairs; the longer one
      // already took it.
      if (claimed.has(origin)) continue
      claimed.add(origin)
      const target = isFile ? to : join(to, rel)
      // `EDITOR_OWNED` holds console-side paths, so it is the origin on pull
      // and the target on push. Either way it means the same thing: the
      // editor's copy is the authority and must not be written over.
      if (EDITOR_OWNED.has(pull ? origin : target)) continue
      const absolute = join(destRoot, target)
      if (!create && !existsSync(absolute)) continue
      const body = readFileSync(file, 'utf8')
      const next = pull ? toVendored(body) : toUpstream(body)
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
const pull = args.includes('--pull')

if (!panelRoot || panelRoot.startsWith('--')) {
  console.error('usage: node scripts/sync-panel.mjs --panel <path> [--pull] [--check]')
  process.exit(2)
}
if (!existsSync(join(panelRoot, 'src/lib'))) {
  console.error(`${panelRoot} does not look like a checkout of ovurrsl/panel (no src/lib).`)
  process.exit(2)
}

const actions = plan(panelRoot, pull)

if (actions.length === 0) {
  console.log(pull ? 'the vendored copy is current — nothing to pull' : 'panel is in sync — nothing to push')
  process.exit(0)
}

for (const action of actions) {
  console.log(`${action.kind === 'new' ? 'new    ' : 'changed'}  ${action.target}`)
}
console.log(`\n${actions.length} file(s)`)

if (checkOnly) {
  console.error(
    pull
      ? '\nthe console has moved ahead of the vendored copy; run the sync'
      : '\nthe console copy has moved ahead of its repository; run the sync',
  )
  process.exit(1)
}

for (const action of actions) {
  mkdirSync(dirname(action.absolute), { recursive: true })
  writeFileSync(action.absolute, action.next)
}
console.log('written')
