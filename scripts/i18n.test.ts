import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogType } from '@lingui/conf'
import { parsePo, stringifyPo } from 'pofile-ts'
import linguiConfig from '../lingui.config'
import {
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

const TARGETS = ['zh-CN', 'fr', 'es', 'ja'] as const
const SAMPLE = `export const messages = [
  /* i18n */ { id: 'viewer.camera.topView', message: 'Top view' },
  /* i18n */ { id: 'editor.buildPanel.advanced', message: 'Advanced' },
]
`

/**
 * A two-message project with the repository's Lingui config and glossary and
 * fully reviewed catalogs, so the real commands run in seconds.
 */
function catalogProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'pascal-catalogs-'))
  symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'))
  writeFileSync(
    join(root, 'lingui.config.ts'),
    readFileSync('lingui.config.ts', 'utf8').replace(
      /include: \[[^\]]*\]/,
      "include: ['packages/editor/src']",
    ),
  )
  mkdirSync(join(root, 'i18n'))
  cpSync('i18n/glossary.json', join(root, 'i18n/glossary.json'))
  mkdirSync(join(root, 'packages/editor/src'), { recursive: true })
  writeFileSync(join(root, 'packages/editor/src/sample.tsx'), SAMPLE)
  for (const locale of ['en', ...TARGETS]) {
    mkdirSync(join(root, `packages/editor/src/i18n/locales/${locale}`), { recursive: true })
    writeFileSync(
      join(root, `packages/editor/src/i18n/locales/${locale}/messages.po`),
      'msgid ""\nmsgstr ""\n',
    )
  }
  run(root, 'extract')
  const reviewed: Record<string, string> = {
    'viewer.camera.topView': 'Vue de dessus',
    'editor.buildPanel.advanced': 'Avancé',
  }
  for (const locale of TARGETS) {
    const path = join(root, `packages/editor/src/i18n/locales/${locale}/messages.po`)
    const po = parsePo(readFileSync(path, 'utf8'))
    for (const item of po.items) {
      const english = item.msgid === 'viewer.camera.topView' ? 'Top view' : 'Advanced'
      item.msgstr = [reviewed[item.msgid]!]
      item.comments = [
        `Source-Hash: ${hashSource(english)}`,
        'Review: human',
        `English: ${JSON.stringify(english)}`,
      ]
      delete item.flags.fuzzy
    }
    writeFileSync(path, stringifyPo(po, { foldLength: 0 }))
  }
  run(root, 'compile')
  return root
}

function run(root: string, command: 'check' | 'compile' | 'extract') {
  const result = Bun.spawnSync(['bun', join(process.cwd(), 'scripts/i18n.ts'), command], {
    // Lingui resolves the config's paths against the working directory.
    cwd: root,
    env: {
      ...process.env,
      I18N_ROOT: root,
      I18N_BASE_REF: '',
      GITHUB_EVENT_NAME: '',
      GITHUB_STEP_SUMMARY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

const catalogFiles = (root: string) =>
  [...new Bun.Glob('packages/editor/src/i18n/locales/*/messages.{po,ts}').scanSync({ cwd: root })]
    .sort()
    .map((path) => [path, readFileSync(join(root, path), 'utf8')])

test('catalog checking does not rewrite PO or compiled catalogs', () => {
  const root = catalogProject()
  const before = catalogFiles(root)
  const { exitCode, output } = run(root, 'check')
  expect(output).not.toContain('[i18n] ')
  expect(exitCode).toBe(0)
  expect(catalogFiles(root)).toEqual(before)
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

test('source drift fails checking, then extraction updates English and flags translations', () => {
  const root = catalogProject()
  const sample = join(root, 'packages/editor/src/sample.tsx')
  writeFileSync(sample, SAMPLE.replace("message: 'Top view'", "message: 'Top view X'"))

  const check = run(root, 'check')
  expect(check.exitCode).toBe(1)
  expect(check.output).toContain('source drift "viewer.camera.topView"')

  expect(run(root, 'extract').exitCode).toBe(0)
  const catalog = (locale: string) =>
    parsePo(
      readFileSync(join(root, `packages/editor/src/i18n/locales/${locale}/messages.po`), 'utf8'),
    )
  expect(
    catalog('en').items.find((item) => item.msgid === 'viewer.camera.topView')?.msgstr[0],
  ).toBe('Top view X')
  for (const locale of TARGETS) {
    const item = catalog(locale).items.find((entry) => entry.msgid === 'viewer.camera.topView')
    expect(item?.msgstr[0]).toBe('Vue de dessus')
    expect(item?.flags.fuzzy).toBe(true)
    expect(item?.comments).toContain('Review: required')
    expect(
      readFileSync(join(root, `packages/editor/src/i18n/locales/${locale}/messages.ts`), 'utf8'),
    ).not.toContain('\\"viewer.camera.topView\\"')
  }
}, 60_000)

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
