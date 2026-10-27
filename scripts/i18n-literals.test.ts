import { expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage'
import { parsePo, stringifyPo } from 'pofile-ts'
import ts from 'typescript'
import {
  annotatedState,
  checkTranslationEntries,
  hashSource,
  type LocaleEntries,
  possibleRenames,
  pseudoLocalize,
  reviewRegressions,
  type SourceMessage,
} from './i18n'
import {
  convertSource,
  editorEntryModuleSet,
  IdRegistry,
  icuLiteral,
  namespaceFor,
} from './i18n-codemod'
import { type Candidate, checkAllowlistGrowth, checkLiterals, scanSource } from './i18n-literals'
import { untranslatedWords } from './i18n-pseudo-audit'

const allowlist = { texts: ['Pascal'], paths: {} }
const convert = (path: string, source: string) =>
  convertSource(path, source, new IdRegistry(), new Set(allowlist.texts))

const panel = `'use client'

import { useState } from 'react'

export function SharePanel({ count, name }: { count: number; name: string }) {
  const [open] = useState(false)
  return (
    <section aria-label="Share project" title={open ? 'Close' : 'Open'}>
      <h2>Share</h2>
      <p>
        Shared with {count} people
      </p>
      <span>{name}</span>
      <span>Pascal</span>
      <img alt="" className="size-4 bg-muted" src="/icons/share.svg" />
    </section>
  )
}
`

test('the codemod wraps visible copy in runtime descriptors owned by the component', () => {
  const { output, planned } = convert('apps/editor/components/share-panel.tsx', panel)

  expect(output).toContain("import { usePascalI18n } from '@pascal-app/core'")
  expect(output).toContain('const i18n = usePascalI18n()')
  expect(output).toContain(
    `aria-label={i18n._({ id: 'app.sharePanel.shareProject', message: 'Share project' })}`,
  )
  expect(output).toContain(
    `open ? i18n._({ id: 'app.sharePanel.close', message: 'Close' }) : i18n._({ id: 'app.sharePanel.open', message: 'Open' })`,
  )
  expect(output).toContain(
    `{i18n._({ id: 'app.sharePanel.sharedWithCountPeople', message: 'Shared with {count} people', values: { count } })}`,
  )
  expect(output).toContain('<span>Pascal</span>')
  expect(output).toContain('alt=""')
  expect(output).toContain('className="size-4 bg-muted"')
  expect(planned.every((item) => !item.manual)).toBe(true)

  expect(convert('apps/editor/components/share-panel.tsx', output).output).toBe(output)
  expect(scanSource('apps/editor/components/share-panel.tsx', output, allowlist)).toEqual([])
})

test('a hook already imported from a second core import is not imported again', () => {
  const source = `'use client'

import { useScene } from '@pascal-app/core'
import { formatNumber, usePascalI18n } from '@pascal-app/core'

export function Count() {
  return <p>Levels</p>
}
`
  const { output } = convert('packages/editor/src/components/count.tsx', source)
  expect(output.match(/usePascalI18n\b/g)).toHaveLength(2)
  expect(output).toContain("import { useScene } from '@pascal-app/core'")
})

test('the codemod leaves module-level copy for a person and never edits it', () => {
  const source = `const ITEMS = [{ label: 'Delete' }]

export const Menu = () => <ul>{ITEMS.map((item) => <li key={item.label}>{item.label}</li>)}</ul>
`
  const { output, planned } = convert('packages/editor/src/components/ui/menu.tsx', source)

  expect(output).toBe(source)
  expect(planned).toEqual([
    expect.objectContaining({
      message: 'Delete',
      manual: expect.stringContaining('outside a component'),
    }),
  ])
})

test('module data becomes lazy descriptors only for the requested keys or variables', () => {
  const source = `const MODES = [{ id: 'solid', name: 'Solid', icon: 'box' }]
const LABELS: Record<string, string> = { up: 'Full height' }
const ROUTES = [{ name: 'home' }]
`
  const { output } = convertSource(
    'apps/editor/components/viewer-toolbar.tsx',
    source,
    new IdRegistry(),
    new Set(),
    { keys: new Set(['name']), variables: new Set(['LABELS']) },
  )

  expect(output).toContain(
    "name: /* i18n */ { id: 'app.viewerToolbar.solid', message: 'Solid' }, icon: 'box'",
  )
  expect(output).toContain(
    "up: /* i18n */ { id: 'app.viewerToolbar.fullHeight', message: 'Full height' }",
  )
  expect(output).toContain("id: 'solid'")
  expect(output).toContain('ROUTES = [{ name: /* i18n */')
})

test('hooks are never placed in named callbacks or async functions', () => {
  const source = `'use client'
export function List({ items }: { items: string[] }) {
  return <ul>{items.map(function Row(item) { return <li key={item}>Remove item</li> })}</ul>
}
export async function Page() {
  return <p>Loading projects</p>
}
`
  const { output, planned } = convert('packages/editor/src/components/list.tsx', source)
  expect(output).toBe(source)
  expect(planned.map((item) => item.manual)).toEqual([
    expect.stringContaining('inside a callback function'),
    expect.stringContaining('inside an async function'),
  ])
})

test('package entry modules without use client are left for a person', () => {
  const [entry] = [...editorEntryModuleSet()].filter((path) => path.endsWith('.tsx'))
  if (!entry) throw new Error('the editor entry exports no .tsx module')
  const source = `export function Badge() {\n  return <span>New feature</span>\n}\n`
  expect(convert(entry, source).planned[0]?.manual).toContain('server component')
  expect(convert(entry, `'use client'\n${source}`).planned[0]?.manual).toBeUndefined()
})

test('a second --vars pass leaves existing descriptors alone', () => {
  const source = `const LABELS: Record<string, string> = { up: 'Full height' }\n`
  const targets = { variables: new Set(['LABELS']) }
  const once = convertSource(
    'apps/editor/components/t.tsx',
    source,
    new IdRegistry(),
    new Set(),
    targets,
  ).output
  const twice = convertSource(
    'apps/editor/components/t.tsx',
    once,
    new IdRegistry(),
    new Set(),
    targets,
  ).output
  expect(once).toContain("/* i18n */ { id: 'app.t.fullHeight', message: 'Full height' }")
  expect(twice).toBe(once)
})

test('ICU encoding and entity decoding render the original text', () => {
  for (const text of [
    'Use {}',
    "Don't",
    "a '{'",
    "''",
    'x}{y',
    "{'}",
    "it's {x} isn't",
    "a'#b",
    "'|'",
  ]) {
    expect((compileMessageOrThrow(icuLiteral(text)) as string[]).join('')).toBe(text)
  }
  const source = `'use client'\nexport function T() {\n  return <p>Use {'{}'} &amp; it&apos;s&nbsp;done&hellip;</p>\n}\n`
  const message = convert('packages/editor/src/components/t.tsx', source).planned[0]?.message ?? ''
  expect((compileMessageOrThrow(message) as string[]).join('')).toBe("Use {} & it's\u00a0done…")
})

test('an allowlisted text joined with static pieces stays exempt', () => {
  const scan = (body: string) =>
    scanSource(
      'packages/editor/src/components/brand.tsx',
      `export function Brand() {\n  return <p>${body}</p>\n}\n`,
      allowlist,
    )
  expect(scan("Pascal{' '}")).toEqual([])
  expect(scan('Pascal')).toEqual([])
})

test('a parenthesized named callback is not a hook owner', () => {
  const source = `'use client'
export function List({ items }: { items: string[] }) {
  return <ul>{items.map((function Row(item) { return <li key={item}>Remove item</li> }))}</ul>
}
`
  const { output, planned } = convert('packages/editor/src/components/list.tsx', source)
  expect(output).toBe(source)
  expect(planned[0]?.manual).toContain('inside a callback function')
})

test('stylesheets and scripts rendered in JSX are not copy', () => {
  const source = `const CALM_CSS = \`.pa-layer[data-calm] .pa-hlabel{transform:none}\`
export function Layer() {
  return (
    <div>
      <style>{BASE_CSS + CALM_CSS}</style>
      <script>{'window.ready = true'}</script>
      <p>Point at something</p>
    </div>
  )
}
`
  expect(
    scanSource('packages/editor/src/components/layer.tsx', source, allowlist).map(
      (found) => found.text,
    ),
  ).toEqual(['Point at something'])
})

test('a constant concatenated with a value is concatenated copy', () => {
  const source = `const LABEL = 'Save'
export function Row({ name }: { name: string }) {
  return <span>{LABEL + ' ' + name}</span>
}
`
  const [found] = scanSource('packages/editor/src/components/row.tsx', source, allowlist)
  expect(found?.text).toBe('Save {?}')
  expect(found?.manual).toContain('concatenated copy')
})

const render = (message: string, values: Record<string, string> = {}) =>
  (compileMessageOrThrow(message) as Array<string | [string]>)
    .map((token) => (typeof token === 'string' ? token : values[token[0]]))
    .join('')

test('converted messages render exactly the original text', () => {
  const messageOf = (body: string, attributes = '') =>
    convert(
      'packages/editor/src/components/t.tsx',
      `'use client'\nexport function T({ name }: { name: string }) {\n  return <p${attributes}>${body}</p>\n}\n`,
    ).planned.map((item) => item.message)
  const [braces] = messageOf("Use {'{'}{'}'}")
  expect(render(braces!)).toBe('Use {}')
  const [spaced] = messageOf('&nbsp;Copy&nbsp;')
  expect(render(spaced!)).toBe('\u00a0Copy\u00a0')
  const [quoted] = messageOf("Rename '{name}'")
  expect(render(quoted!, { name: 'Lobby' })).toBe("Rename 'Lobby'")
  const titled = messageOf('Open', ' title="Tom &amp; Jerry"').find((message) => message !== 'Open')
  expect(render(titled ?? '')).toBe('Tom & Jerry')
  const template = convert(
    'packages/editor/src/components/t.tsx',
    `'use client'\nexport function T({ name }: { name: string }) {\n  return <p title={\`Rename '\${name}'\`} />\n}\n`,
  ).planned[0]?.message
  expect(render(template!, { name: 'Lobby' })).toBe("Rename 'Lobby'")
})

test('inlined constants with line breaks are emitted as valid string literals', () => {
  const source = `'use client'
const LABEL = 'Save\\r\\nnow'
export function T({ name }: { name: string }) {
  return <p>{LABEL} for {name}</p>
}
`
  const { output } = convert('packages/editor/src/components/t.tsx', source)
  const result = ts.transpileModule(output, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
    fileName: 't.tsx',
  })
  expect(result.diagnostics ?? []).toEqual([])
  expect(output).toContain("message: 'Save\\r\\nnow for {name}'")
})

test('app modules without use client are left for a person', () => {
  const source = `export function AppHeader() {
  return <a aria-label="Pascal home" href="/" />
}
`
  const { output, planned } = convert('apps/editor/components/app-shell.tsx', source)
  expect(output).toBe(source)
  expect(planned[0]?.manual).toContain('server component')
})

test('an expression-bodied component gains a block body for the hook', () => {
  const source = `export const Empty = () => <p>No layers yet</p>\n`
  const { output } = convert('packages/editor/src/components/ui/sidebar/empty.tsx', source)

  expect(output).toContain('const i18n = usePascalI18n()')
  expect(output).toContain(
    "return (<p>{i18n._({ id: 'editor.sidebar.empty.noLayersYet', message: 'No layers yet' })}</p>)",
  )
})

test('message IDs follow the owning package and path, disambiguating different copy', () => {
  expect(namespaceFor('packages/editor/src/components/ui/sidebar/sidebar.tsx')).toBe(
    'editor.sidebar',
  )
  expect(namespaceFor('packages/nodes/src/roof-segment/inspector/panel.tsx')).toBe(
    'node.roofSegment.inspector.panel',
  )
  const registry = new IdRegistry({ 'app.navbar.share': 'Share' })
  expect(registry.idFor('apps/editor/components/navbar.tsx', 'Share')).toBe('app.navbar.share')
  expect(registry.idFor('apps/editor/components/navbar.tsx', 'Share…')).toBe('app.navbar.share2')
})

const candidate = (text: string): Candidate => ({ kind: 'jsx-text', text, line: 1 })

test('the guard fails on copy the baseline does not list and reports progress', () => {
  const scan = new Map([
    ['a.tsx', [candidate('Share'), candidate('Share')]],
    ['new.tsx', [candidate('Hello')]],
  ])
  const { errors, improvable } = checkLiterals(scan, {
    version: 3,
    files: { 'a.tsx': ['Share', 'Share', 'Copy'], 'gone.tsx': ['Old'] },
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('new.tsx: untranslated user-visible literals not in the baseline')
  expect(improvable).toEqual(['a.tsx: 1 fewer', 'gone.tsx: 1 fewer'])
})

test('swapping baselined copy for new copy fails even when the count is unchanged', () => {
  const { errors } = checkLiterals(new Map([['a.tsx', [candidate('Delete everything now')]]]), {
    version: 3,
    files: { 'a.tsx': ['Share'] },
  })
  expect(errors[0]).toContain('"Delete everything now"')
})

test('the baseline may only shrink relative to the base branch', () => {
  const { errors } = checkLiterals(
    new Map([['a.tsx', [candidate('Share'), candidate('Copy')]]]),
    { version: 3, files: { 'a.tsx': ['Copy', 'Share'] } },
    { version: 3, files: { 'a.tsx': ['Share'] } },
  )
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('"Copy" (a.tsx)')
})

test('copy that moves with a git mv, a split or an extraction does not grow the baseline', () => {
  const scan = new Map([
    ['new.tsx', [candidate('Share'), candidate('Copy')]],
    ['extracted.tsx', [candidate('Delete')]],
  ])
  const baseline = {
    version: 3 as const,
    files: { 'new.tsx': ['Copy', 'Share'], 'extracted.tsx': ['Delete'] },
  }
  const base = { version: 3 as const, files: { 'old.tsx': ['Copy', 'Delete', 'Share'] } }
  expect(checkLiterals(scan, baseline, base).errors).toEqual([])

  const duplicated = { version: 3 as const, files: { ...baseline.files, 'copy.tsx': ['Share'] } }
  expect(checkLiterals(scan, duplicated, base).errors[0]).toContain('"Share" (new.tsx, copy.tsx)')
})

test('the allowlist may not gain exemptions relative to the base', () => {
  expect(
    checkAllowlistGrowth(
      {
        texts: ['Pascal', 'Delete'],
        paths: { 'apps/editor/app/dev/': 'dev', 'packages/x/': 'why' },
      },
      { texts: ['Pascal'], paths: { 'apps/editor/app/dev/': 'dev' } },
    ),
  ).toEqual([
    'i18n/literal-allowlist.json adds the text "Delete"; exempt one use with i18n-ignore: <reason> instead',
    'i18n/literal-allowlist.json adds the path "packages/x/"; exempting a path needs a reviewed exception',
  ])
  expect(checkAllowlistGrowth({ texts: ['Pascal'], paths: {} }, undefined)).toEqual([])
})

test('equivalent JSX spellings scan to the same rendered text', () => {
  const texts = (body: string) =>
    scanSource(
      'packages/editor/src/components/share.tsx',
      `export function Share() {\n  return <p>${body}</p>\n}\n`,
      allowlist,
    ).map((found) => found.text)
  expect(texts("Share{' '}project")).toEqual(['Share project'])
  expect(texts('Share project')).toEqual(['Share project'])
  expect(texts('Tom&nbsp;&amp;&hellip;')).toEqual(['Tom\u00a0&…'])
})

test('constants rendered inside a sentence and concatenated copy are scanned', () => {
  const scan = (label: string) =>
    scanSource(
      'packages/editor/src/components/when.tsx',
      `const LABEL = '${label}'\nexport function When({ name }: { name: string }) {\n  return (\n    <div>\n      <p>{LABEL} now</p>\n      <span>{'Delete ' + name}</span>\n    </div>\n  )\n}\n`,
      allowlist,
    )
  expect(scan('Save').map((found) => found.text)).toEqual(['Save now', 'Delete {?}'])
  expect(scan('Publish')[0]?.text).toBe('Publish now')
  expect(scan('Save')[1]?.manual).toContain('concatenated copy')
})

test('an i18n-ignore comment exempts data that only looks like copy', () => {
  const source = `export function Credits() {
  return (
    <p>
      {/* i18n-ignore: product name */}
      Made with Three.js
    </p>
  )
}
`
  expect(scanSource('packages/editor/src/components/credits.tsx', source, allowlist)).toEqual([])
})

test('a trailing i18n-ignore exempts only its own line', () => {
  const source = `export function Credits() {
  return (
    <p>
      <span title="Three.js" /> {/* i18n-ignore: library name */}
      <span title="Delete everything" />
    </p>
  )
}
`
  expect(
    scanSource('packages/editor/src/components/credits.tsx', source, allowlist).map(
      (found) => found.text,
    ),
  ).toEqual(['Delete everything'])
})

test('an i18n-ignore without a reason does not exempt anything', () => {
  const source = `export function Credits() {
  // i18n-ignore
  return <p title="Made with Three.js" />
}
`
  expect(scanSource('packages/editor/src/components/credits.tsx', source, allowlist)).toHaveLength(
    1,
  )
})

test('hyphenated labels and string constants rendered in JSX are copy', () => {
  const source = `const DELETE_LABEL = 'Delete everything'
const ICON = 'lucide:trash'

export function Toolbar() {
  return (
    <div>
      <button aria-label="zoom-in" title={ICON} />
      <span>Read-only</span>
      <span>{DELETE_LABEL}</span>
    </div>
  )
}
`
  expect(
    scanSource('packages/editor/src/components/toolbar.tsx', source, allowlist).map(
      (found) => found.text,
    ),
  ).toEqual(['zoom-in', 'Read-only', 'Delete everything'])
})

test('a rendered constant resolves through scope, not just its name', () => {
  const source = `const LABEL = 'Shown label'

function Other() {
  const LABEL = 'Never rendered'
  return LABEL.length
}

export function Panel({ title }: { title: string }) {
  const LABEL = title
  return (
    <div>
      <span>{LABEL}</span>
      <Inner />
    </div>
  )
}

function Inner() {
  return <span>{LABEL}</span>
}
`
  expect(
    scanSource('packages/editor/src/components/panel.tsx', source, allowlist).map(
      (found) => found.text,
    ),
  ).toEqual(['Shown label'])
})

test('a notification description is one candidate and one edit', () => {
  const source = `export function Save() {
  return <button onClick={() => toast.error('Failed', { description: 'Try again' })} />
}
`
  const path = 'packages/editor/src/components/save.tsx'
  expect(scanSource(path, source, allowlist).map((found) => found.text)).toEqual([
    'Failed',
    'Try again',
  ])
  const { output } = convert(path, source)
  expect(output.match(/message: 'Try again'/g)).toHaveLength(1)
})

test('a one-line block body keeps its statement after the inserted hook', () => {
  const source = `export function Empty() { return <p>No layers yet</p> }\n`
  const { output } = convert('packages/editor/src/components/ui/sidebar/empty.tsx', source)
  expect(output).toContain('const i18n = usePascalI18n()\n return <p>')
  expect(() =>
    scanSource('packages/editor/src/components/ui/sidebar/empty.tsx', output, allowlist),
  ).not.toThrow()
  expect(convert('packages/editor/src/components/ui/sidebar/empty.tsx', output).output).toBe(output)
})

test('the audit allowlist removes whole words only', () => {
  expect(untranslatedWords('Find · 2 in', ['in'])).toEqual(['Find'])
  expect(untranslatedWords('Pin', ['in'])).toEqual(['Pin'])
  expect(untranslatedWords('[Ƒîñð] 2 in', ['in'])).toEqual([])
})

test('pseudo-localization accents every letter and keeps ICU structure', () => {
  const message = 'Delete {count, plural, one {# wall} other {# walls}} from <0>{level}</0>?'
  const pseudo = pseudoLocalize(message)

  expect(pseudo).toBe(
    '[Ðéļéţé {count, plural, one {# ŵáļļ} other {# ŵáļļš}} ƒŕöɱ <0>{level}</0>? ~~~~~~]',
  )
  expect(() => compileMessageOrThrow(pseudo)).not.toThrow()
  expect(pseudoLocalize("It''s '{'literal'}'")).toBe("[Îţ''š '{'ļîţéŕáļ'}' ~~~]")
})

const advanced: SourceMessage = {
  id: 'editor.buildPanel.advanced',
  message: 'Advanced',
  context: [],
}
const entry = (overrides: Partial<LocaleEntries[string][string]>) => ({
  translation: 'Avancé',
  sourceHash: hashSource('Advanced'),
  review: 'human' as const,
  fuzzy: false,
  ...overrides,
})
const everyLocale = (value: ReturnType<typeof entry>): LocaleEntries =>
  Object.fromEntries(
    ['zh-CN', 'fr', 'es', 'ja'].map((locale) => [locale, { [advanced.id]: value }]),
  )

test('AI drafts pass ordinary checks but block the reviewed release gate', () => {
  const drafts = everyLocale(entry({ review: 'required', fuzzy: true }))
  expect(checkTranslationEntries([advanced], drafts, {}, {})).toEqual([])
  expect(checkTranslationEntries([advanced], drafts, {}, { requireReviewed: true })).toContain(
    'fr: "editor.buildPanel.advanced" still requires human review',
  )
  expect(
    checkTranslationEntries([advanced], everyLocale(entry({ review: 'missing' })), {}, {}),
  ).toContain(
    'fr: "editor.buildPanel.advanced" is unreviewed but not marked fuzzy + Review: required',
  )
})

test('after a wording change, extract leaves a passing draft and a reviewed stale entry fails', () => {
  const reworded = { ...advanced, message: 'Advanced tools' }
  const staleDraft = everyLocale(entry({ review: 'required', fuzzy: true }))
  expect(checkTranslationEntries([reworded], staleDraft, {}, {})).toEqual([])
  expect(checkTranslationEntries([reworded], staleDraft, {}, { requireReviewed: true })).toContain(
    'fr: stale "editor.buildPanel.advanced"',
  )
  expect(checkTranslationEntries([reworded], everyLocale(entry({})), {}, {})).toContain(
    'fr: stale "editor.buildPanel.advanced"',
  )
})

test('a reviewed translation cannot fall back to draft while its English is unchanged', () => {
  const base = everyLocale(entry({}))
  expect(
    reviewRegressions([advanced], everyLocale(entry({ review: 'required', fuzzy: true })), base),
  ).toContain(
    'fr: "editor.buildPanel.advanced" is reviewed on the base branch with the same English and must stay reviewed',
  )
  expect(
    reviewRegressions([advanced], everyLocale(entry({ translation: 'Avancés' })), base),
  ).toEqual([])
  const reworded = { ...advanced, message: 'Advanced tools' }
  expect(
    reviewRegressions([reworded], everyLocale(entry({ review: 'required', fuzzy: true })), base),
  ).toEqual([])
})

test('an unrelated addition sharing English with a removed reviewed ID only warns', () => {
  const off = { id: 'viewer.common.off', message: 'Off', context: [] }
  const added = { id: 'viewer.audio.off', message: 'Off', context: [] }
  const reviewed = (translation: string) => ({
    translation,
    sourceHash: hashSource('Off'),
    review: 'human' as const,
    fuzzy: false,
  })
  const base: LocaleEntries = Object.fromEntries(
    ['zh-CN', 'fr', 'es', 'ja'].map((locale) => [locale, { [off.id]: reviewed('Désactivé') }]),
  )
  const current: LocaleEntries = Object.fromEntries(
    ['zh-CN', 'fr', 'es', 'ja'].map((locale) => [
      locale,
      { [added.id]: { ...reviewed('Désactivé'), review: 'required' as const, fuzzy: true } },
    ]),
  )
  expect(reviewRegressions([added], current, base)).toEqual([])
  expect(possibleRenames([added], current, base)).toEqual([
    `possible rename "viewer.common.off" → "viewer.audio.off" (same English): carry over the translation if intended with comment: 'renamed-from: <old id>' and bun run i18n:extract`,
  ])
})

test('a declared rename must carry the reviewed translation over', () => {
  const renamed = { ...advanced, id: 'editor.buildPanel.advancedTools' }
  const base = everyLocale(entry({}))
  const declared = (overrides: Partial<LocaleEntries[string][string]>): LocaleEntries =>
    Object.fromEntries(
      ['zh-CN', 'fr', 'es', 'ja'].map((locale) => [
        locale,
        { [renamed.id]: entry({ renamedFrom: advanced.id, ...overrides }) },
      ]),
    )
  expect(
    reviewRegressions([renamed], declared({ review: 'required', fuzzy: true }), base),
  ).toContain(
    'fr: "editor.buildPanel.advancedTools" is declared renamed-from "editor.buildPanel.advanced", whose reviewed translation was not carried over; run bun run i18n:extract',
  )
  expect(reviewRegressions([renamed], declared({}), base)).toEqual([])
  expect(possibleRenames([renamed], declared({ review: 'required', fuzzy: true }), base)).toEqual(
    [],
  )
})

test('an explicit base that cannot be resolved fails the release job', () => {
  const result = Bun.spawnSync(
    ['bun', 'scripts/i18n.ts', 'release-check', '--base', 'nonexistent-ref'],
    { env: { ...process.env, GITHUB_STEP_SUMMARY: '' }, stdout: 'pipe', stderr: 'pipe' },
  )
  expect(result.exitCode).toBe(1)
  expect(`${result.stdout}${result.stderr}`).toContain('--base nonexistent-ref is not a commit')
})

test('extraction never approves a newly filled translation by itself', () => {
  const hash = hashSource('Advanced')
  const pasted = { translation: 'Avancé', review: 'missing' as const, fuzzy: false }
  expect(annotatedState(pasted, 'Avancé', hash)).toEqual({
    sourceHash: hash,
    review: 'required',
    fuzzy: true,
  })
  expect(annotatedState({ ...pasted, review: 'human' }, 'Avancé', hash)).toEqual({
    sourceHash: hash,
    review: 'human',
    fuzzy: false,
  })
  expect(annotatedState({ ...pasted, review: 'human', sourceHash: hash }, 'Avancé', hash)).toBe(
    undefined,
  )
})

const LOCALES_DIR = 'packages/editor/src/i18n/locales'

/** A copy of the real catalogs to run the release job against, edited per case. */
function catalogFixture(edit: (root: string) => void): { current: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'pascal-i18n-'))
  const base = join(root, 'base')
  const current = join(root, 'current')
  cpSync(LOCALES_DIR, base, { recursive: true })
  cpSync(LOCALES_DIR, current, { recursive: true })
  edit(current)
  return { current, base }
}

function releaseCheckJob(fixture: { current: string; base: string }) {
  const result = Bun.spawnSync(
    ['bun', 'scripts/i18n.ts', 'release-check', '--base-dir', fixture.base],
    {
      env: { ...process.env, I18N_CATALOG_ROOT: fixture.current, GITHUB_STEP_SUMMARY: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

function markDraft(root: string, id: string): void {
  const path = join(root, 'fr/messages.po')
  const po = parsePo(readFileSync(path, 'utf8'))
  const item = po.items.find((entry) => entry.msgid === id)
  if (!item) throw new Error(`fixture entry ${id} moved`)
  item.comments = item.comments.map((comment) =>
    comment.startsWith('Review: ') ? 'Review: required' : comment,
  )
  item.flags.fuzzy = true
  writeFileSync(path, stringifyPo(po, { foldLength: 0 }))
}

test('the release job passes on unchanged catalogs', () => {
  expect(releaseCheckJob(catalogFixture(() => {})).exitCode).toBe(0)
})

test('the release job fails when a reviewed entry becomes a draft with the same English', () => {
  const { exitCode, output } = releaseCheckJob(
    catalogFixture((root) => markDraft(root, 'editor.buildPanel.advanced')),
  )
  expect(exitCode).toBe(1)
  expect(output).toContain(
    'fr: "editor.buildPanel.advanced" is reviewed on the base branch with the same English and must stay reviewed',
  )
})

test('the release job fails when a compiled pack ships a draft', () => {
  const { exitCode, output } = releaseCheckJob(
    catalogFixture((root) => {
      const path = join(root, 'fr/messages.ts')
      const pack = readFileSync(path, 'utf8')
      const draftId = parsePo(readFileSync(join(root, 'fr/messages.po'), 'utf8')).items.find(
        (item) => item.flags.fuzzy,
      )?.msgid
      if (!draftId) throw new Error('fixture has no draft')
      writeFileSync(
        path,
        pack.replace('JSON.parse("{', `JSON.parse("{\\"${draftId}\\":[\\"Brouillon\\"],`),
      )
    }),
  )
  expect(exitCode).toBe(1)
  expect(output).toMatch(/fr: compiled pack ships unreviewed "[^"]+"/)
})

/** A throwaway repository with the real catalogs, for the default base lookup. */
function releaseRepo(steps: (git: (...args: string[]) => void, root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'pascal-release-'))
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(
      ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
      { cwd: root, stdout: 'ignore', stderr: 'pipe' },
    )
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  }
  git('init', '-q', '-b', 'main')
  steps(git, root)
  return root
}

const addCatalogs = (root: string) =>
  cpSync(LOCALES_DIR, join(root, LOCALES_DIR), { recursive: true })

function defaultReleaseCheck(root: string) {
  const result = Bun.spawnSync(['bun', 'scripts/i18n.ts', 'release-check'], {
    env: { ...process.env, I18N_ROOT: root, GITHUB_STEP_SUMMARY: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

test('the release job compares with the latest editor release tag and fails on a reviewed-to-draft change', () => {
  const root = releaseRepo((git, root) => {
    addCatalogs(root)
    git('add', '.')
    git('commit', '-q', '-m', 'release')
    git('tag', '@pascal-app/editor@9.9.9')
    git('tag', 'v0.0.1')
    markDraft(join(root, LOCALES_DIR), 'editor.buildPanel.advanced')
  })
  const { exitCode, output } = defaultReleaseCheck(root)
  expect(output).toContain('Comparing with @pascal-app/editor@9.9.9')
  expect(exitCode).toBe(1)
  expect(output).toContain(
    'fr: "editor.buildPanel.advanced" is reviewed on the base branch with the same English and must stay reviewed',
  )
})

test('a release tag without catalogs falls back to the commit that introduced them', () => {
  const root = releaseRepo((git, root) => {
    writeFileSync(join(root, 'README.md'), 'before i18n\n')
    git('add', '.')
    git('commit', '-q', '-m', 'old release')
    git('tag', '@pascal-app/editor@1.0.0')
    addCatalogs(root)
    git('add', '.')
    git('commit', '-q', '-m', 'catalogs')
    writeFileSync(join(root, 'README.md'), 'after i18n\n')
    git('add', '.')
    git('commit', '-q', '-m', 'later work')
    markDraft(join(root, LOCALES_DIR), 'editor.buildPanel.advanced')
  })
  const { exitCode, output } = defaultReleaseCheck(root)
  expect(output).toContain(
    'the commit that introduced the catalogs (@pascal-app/editor@1.0.0 has no catalogs)',
  )
  expect(exitCode).toBe(1)
  expect(output).toContain('fr: "editor.buildPanel.advanced" is reviewed on the base branch')
})

test('with no base that has catalogs the release job fails loudly', () => {
  const root = releaseRepo((git, root) => {
    addCatalogs(root)
    git('add', '.')
    git('commit', '-q', '-m', 'catalogs at HEAD only')
  })
  const { exitCode, output } = defaultReleaseCheck(root)
  expect(exitCode).toBe(1)
  expect(output).toContain('release-check: no base with bundled PO catalogs')
})
