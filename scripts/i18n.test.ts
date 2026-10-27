import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import type { CatalogType } from '@lingui/conf'
import { parsePo } from 'pofile-ts'
import linguiConfig from '../lingui.config'
import {
  checkCatalogs,
  escapePoCommentValue,
  extractCatalogs,
  hashSource,
  refreshTranslations,
  type SourceMessage,
  type TranslationEntry,
  type TranslationProvider,
  validateTranslation,
} from './i18n'

test('AI review notes cannot inject physical PO lines', () => {
  const escaped = escapePoCommentValue('Check wording.\nmsgid "injected"\r\nmsgstr "value"')

  expect(escaped).toBe('Check wording.\\nmsgid "injected"\\nmsgstr "value"')
  expect(escaped).not.toContain('\n')
  expect(escaped).not.toContain('\r')
})

test('PO output is stable when an unrelated source line is added', async () => {
  const format = linguiConfig.format
  if (!format) throw new Error('Lingui PO formatter is not configured')
  const serialize = (line: number) =>
    format.serialize(
      {
        'viewer.example': {
          message: 'Example',
          translation: 'Exemple',
          origin: [['packages/editor/src/example.tsx', line]],
        },
      } satisfies CatalogType,
      {
        existing: undefined,
        filename: 'messages.po',
        locale: 'fr',
        sourceLocale: 'en',
      },
    )

  expect(await serialize(10)).toBe(await serialize(11))
})

test('catalog checking does not rewrite PO or compiled catalogs', async () => {
  const paths = [
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.po').scanSync(),
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.ts').scanSync(),
  ]
  const before = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]))

  expect(await checkCatalogs()).toEqual([])
  expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(
    paths.map((path) => before.get(path)),
  )
}, 60_000)

test('ICU plural validation follows the target locale categories', () => {
  const english = '{count, plural, one {# item} other {# items}}'

  expect(validateTranslation(english, '{count, plural, other {# 個}}', 'ja')).toEqual([])
  expect(validateTranslation(english, '{count, plural, other {# 个}}', 'zh-CN')).toEqual([])
  expect(validateTranslation(english, '{count, plural, other {# items}}', 'en')).toContain(
    'plural selector "count" is missing "one"',
  )
  expect(validateTranslation(english, english, 'en')).toEqual([])
})

test('rich-text validation preserves attributed and self-closing tags', () => {
  expect(
    validateTranslation(
      '<a href="/docs" aria-label="Documentation">Open</a> <icon name="external" />',
      '<a href="/docs" aria-label="Documentation">Ouvrir</a> <icon name="external" />',
      'fr',
    ),
  ).toEqual([])
  expect(validateTranslation('<a href="/docs">Open</a>', '<a>Ouvrir</a>', 'fr')).toContain(
    'rich-text tags differ from English',
  )
  expect(validateTranslation('Save <icon name="disk" />', 'Enregistrer', 'fr')).toContain(
    'rich-text tags differ from English',
  )
})

test('source drift fails checking, then extraction updates English and flags translations', async () => {
  const sourcePath = 'packages/editor/src/components/viewer/viewer-controls-bar.tsx'
  const catalogPaths = [
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.po').scanSync(),
    ...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.ts').scanSync(),
  ]
  const paths = [sourcePath, ...catalogPaths]
  const before = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]))
  const originalSource = before.get(sourcePath)
  if (!originalSource) throw new Error(`Missing ${sourcePath}`)

  try {
    writeFileSync(
      sourcePath,
      originalSource.replaceAll("message: 'Top view'", "message: 'Top view X'"),
    )

    const errors = await checkCatalogs()
    expect(errors.some((error) => error.includes('source drift "viewer.camera.topView"'))).toBe(
      true,
    )

    extractCatalogs()

    const english = parsePo(readFileSync('packages/editor/src/i18n/locales/en/messages.po', 'utf8'))
    expect(english.items.find((item) => item.msgid === 'viewer.camera.topView')?.msgstr[0]).toBe(
      'Top view X',
    )

    for (const locale of ['zh-CN', 'fr', 'es', 'ja']) {
      const target = parsePo(
        readFileSync(`packages/editor/src/i18n/locales/${locale}/messages.po`, 'utf8'),
      )
      const item = target.items.find((entry) => entry.msgid === 'viewer.camera.topView')
      expect(item?.msgstr[0]).not.toBe('')
      expect(item?.flags.fuzzy).toBe(true)
      expect(item?.comments).toContain('Review: required')
      expect(
        readFileSync(`packages/editor/src/i18n/locales/${locale}/messages.ts`, 'utf8'),
      ).not.toContain('\\"viewer.camera.topView\\"')
    }
  } finally {
    for (const [path, contents] of before) writeFileSync(path, contents)
  }
}, 120_000)

test('AI translation refreshes only missing and stale entries through a mocked provider', async () => {
  const sources: SourceMessage[] = [
    { id: 'viewer.current', message: 'Current', context: ['current.tsx:1'] },
    { id: 'viewer.missing', message: 'Hello {name}', context: ['missing.tsx:2'] },
    { id: 'viewer.stale', message: 'Changed', context: ['stale.tsx:3'] },
  ]
  const current: Record<string, TranslationEntry> = {
    'viewer.current': {
      translation: 'Actuel',
      sourceHash: hashSource('Current'),
      review: 'human',
      fuzzy: false,
    },
    'viewer.stale': {
      translation: 'Ancien',
      sourceHash: hashSource('Old'),
      review: 'human',
      fuzzy: false,
    },
  }
  const requests: string[][] = []
  const provider: TranslationProvider = {
    name: 'mock',
    model: 'mock-model',
    async translate(request) {
      requests.push(request.items.map((item) => item.id))
      return {
        locale: request.locale,
        entries: [
          {
            id: 'viewer.missing',
            translation: 'Bonjour {name}',
            reviewNotes: '',
          },
          { id: 'viewer.stale', translation: 'Modifié', reviewNotes: 'Check toolbar width.' },
        ],
      }
    },
  }

  const refreshed = await refreshTranslations('fr', sources, current, provider)

  expect(requests).toEqual([['viewer.missing', 'viewer.stale']])
  expect(refreshed['viewer.current']).toEqual(current['viewer.current'])
  expect(refreshed['viewer.missing']).toEqual({
    translation: 'Bonjour {name}',
    sourceHash: hashSource('Hello {name}'),
    review: 'required',
    fuzzy: true,
    reviewNotes: '',
  })
  expect(refreshed['viewer.stale']).toEqual({
    translation: 'Modifié',
    sourceHash: hashSource('Changed'),
    review: 'required',
    fuzzy: true,
    reviewNotes: 'Check toolbar width.',
  })
})

test('AI translation rejects broken placeholders from a provider', async () => {
  const sources: SourceMessage[] = [
    { id: 'viewer.greeting', message: 'Hello {name}', context: ['greeting.tsx:1'] },
  ]
  const provider: TranslationProvider = {
    name: 'mock',
    model: 'mock-model',
    async translate(request) {
      return {
        locale: request.locale,
        entries: [{ id: 'viewer.greeting', translation: 'Bonjour', reviewNotes: '' }],
      }
    },
  }

  expect(refreshTranslations('fr', sources, {}, provider)).rejects.toThrow(
    'placeholder names differ from English',
  )
})

test('translation validation applies the checked-in glossary', () => {
  expect(
    validateTranslation('Ceiling', '吊顶', 'zh-CN', {
      terms: { ceiling: { 'zh-CN': '天花板' } },
    }),
  ).toContain('expected glossary term "天花板" for "ceiling"')
})
