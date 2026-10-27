import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage'
import { parsePo, stringifyPo } from 'pofile-ts'
import { checkCatalogs, pseudoLocalize } from './i18n'
import { convertSource, IdRegistry, namespaceFor } from './i18n-codemod'
import { type Candidate, checkLiterals, scanSource } from './i18n-literals'

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

test('the guard fails when a file gains copy and accepts progress', () => {
  const candidate: Candidate = { kind: 'jsx-text', text: 'Hello', line: 1 }
  const scan = new Map([
    ['a.tsx', [candidate, candidate]],
    ['new.tsx', [candidate]],
  ])
  const { errors, improvable } = checkLiterals(scan, {
    version: 1,
    files: { 'a.tsx': 3, 'gone.tsx': 1 },
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('new.tsx: 1 untranslated user-visible literals (baseline 0)')
  expect(improvable).toEqual(['a.tsx: 2 < 3', 'gone.tsx: 0 < 1'])
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

test('pseudo-localization accents every letter and keeps ICU structure', () => {
  const message = 'Delete {count, plural, one {# wall} other {# walls}} from <0>{level}</0>?'
  const pseudo = pseudoLocalize(message)

  expect(pseudo).toBe(
    '[Ðéļéţé {count, plural, one {# ŵáļļ} other {# ŵáļļš}} ƒŕöɱ <0>{level}</0>? ~~~~~~]',
  )
  expect(() => compileMessageOrThrow(pseudo)).not.toThrow()
  expect(pseudoLocalize("It''s '{'literal'}'")).toBe("[Îţ''š '{'ļîţéŕáļ'}' ~~~]")
})

test('AI drafts pass ordinary checks but block the reviewed release gate', async () => {
  const paths = [
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.po').scanSync(),
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.ts').scanSync(),
  ]
  const before = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]))
  const catalog = 'packages/editor/src/i18n/locales/fr/messages.po'
  const mark = (review: string, fuzzy: boolean) => {
    const po = parsePo(before.get(catalog)!)
    const item = po.items.find((entry) => entry.msgid === 'editor.buildPanel.advanced')!
    item.comments = item.comments.map((comment) =>
      comment.startsWith('Review: ') ? `Review: ${review}` : comment,
    )
    if (fuzzy) item.flags.fuzzy = true
    writeFileSync(catalog, stringifyPo(po, { foldLength: 0 }))
    Bun.spawnSync(['bun', 'scripts/i18n.ts', 'compile'], { stdout: 'ignore', stderr: 'ignore' })
  }
  try {
    mark('required', true)
    expect(await checkCatalogs()).toEqual([])
    expect(readFileSync('packages/editor/src/i18n/locales/fr/messages.ts', 'utf8')).not.toContain(
      'Avancé',
    )
    expect(await checkCatalogs({ requireReviewed: true })).toContain(
      'fr: "editor.buildPanel.advanced" still requires human review',
    )

    mark('missing', false)
    expect(await checkCatalogs()).toContain(
      'fr: "editor.buildPanel.advanced" is unreviewed but not marked fuzzy + Review: required',
    )
  } finally {
    for (const [path, contents] of before) writeFileSync(path, contents)
  }
}, 120_000)
