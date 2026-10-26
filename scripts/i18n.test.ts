import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CatalogType } from '@lingui/conf'
import linguiConfig from '../lingui.config'
import {
  checkCatalogs,
  escapePoCommentValue,
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
}, 15_000)

test('ICU plural validation follows the target locale categories', () => {
  const english = '{count, plural, one {# item} other {# items}}'

  expect(validateTranslation(english, '{count, plural, other {# 個}}', 'ja')).toEqual([])
  expect(validateTranslation(english, '{count, plural, other {# 个}}', 'zh-CN')).toEqual([])
  expect(validateTranslation(english, '{count, plural, other {# items}}', 'en')).toContain(
    'plural selector "count" is missing "one"',
  )
  expect(validateTranslation(english, english, 'en')).toEqual([])
})

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
