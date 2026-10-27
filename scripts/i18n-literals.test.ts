import { expect, test } from 'bun:test'
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage'
import {
  annotatedState,
  checkTranslationEntries,
  hashSource,
  type LocaleEntries,
  pseudoLocalize,
  reviewRegressions,
  type SourceMessage,
} from './i18n'
import { convertSource, IdRegistry, namespaceFor } from './i18n-codemod'
import { type Candidate, checkLiterals, scanSource } from './i18n-literals'
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
    version: 2,
    files: { 'a.tsx': ['Share', 'Share', 'Copy'], 'gone.tsx': ['Old'] },
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('new.tsx: untranslated user-visible literals not in the baseline')
  expect(improvable).toEqual(['a.tsx: 1 fewer', 'gone.tsx: 1 fewer'])
})

test('swapping baselined copy for new copy fails even when the count is unchanged', () => {
  const { errors } = checkLiterals(new Map([['a.tsx', [candidate('Delete everything now')]]]), {
    version: 2,
    files: { 'a.tsx': ['Share'] },
  })
  expect(errors[0]).toContain('"Delete everything now"')
})

test('the baseline may only shrink relative to the base branch', () => {
  const { errors } = checkLiterals(
    new Map([['a.tsx', [candidate('Share'), candidate('Copy')]]]),
    { version: 2, files: { 'a.tsx': ['Copy', 'Share'] } },
    { version: 2, files: { 'a.tsx': ['Share'] } },
  )
  expect(errors).toEqual([
    'a.tsx: i18n/literal-baseline.json adds "Copy" relative to the base branch; the baseline may only shrink',
  ])
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
