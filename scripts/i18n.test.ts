import { expect, test } from 'bun:test'
import {
  type LocaleCatalog,
  refreshLocaleCatalog,
  type SourceCatalog,
  type TranslationProvider,
} from './i18n'

test('AI translation refreshes only missing and stale entries through a mocked provider', async () => {
  const source: SourceCatalog = {
    'viewer.current': {
      default: 'Current',
      hash: 'hash-current',
      context: ['current.tsx:1'],
    },
    'viewer.missing': {
      default: 'Hello {name}',
      hash: 'hash-missing',
      context: ['missing.tsx:2'],
    },
    'viewer.stale': {
      default: 'Changed',
      hash: 'hash-new',
      context: ['stale.tsx:3'],
    },
  }
  const catalog: LocaleCatalog = {
    locale: 'fr',
    messages: {
      'viewer.current': { message: 'Actuel', sourceHash: 'hash-current' },
      'viewer.stale': { message: 'Ancien', sourceHash: 'hash-old' },
    },
  }
  const requests: string[][] = []
  const provider: TranslationProvider = {
    async translate(request) {
      requests.push(request.items.map((item) => item.key))
      return {
        'viewer.missing': 'Bonjour {name}',
        'viewer.stale': 'Modifié',
      }
    },
  }

  const refreshed = await refreshLocaleCatalog(source, catalog, provider, {})

  expect(requests).toEqual([['viewer.missing', 'viewer.stale']])
  expect(refreshed.messages['viewer.current']).toEqual(catalog.messages['viewer.current'])
  expect(refreshed.messages['viewer.missing']).toEqual({
    message: 'Bonjour {name}',
    sourceHash: 'hash-missing',
  })
  expect(refreshed.messages['viewer.stale']).toEqual({
    message: 'Modifié',
    sourceHash: 'hash-new',
  })
})

test('AI translation rejects broken placeholders from a provider', async () => {
  const source: SourceCatalog = {
    'viewer.greeting': {
      default: 'Hello {name}',
      hash: 'hash-greeting',
      context: ['greeting.tsx:1'],
    },
  }
  const catalog: LocaleCatalog = { locale: 'fr', messages: {} }
  const provider: TranslationProvider = {
    async translate() {
      return { 'viewer.greeting': 'Bonjour' }
    },
  }

  expect(refreshLocaleCatalog(source, catalog, provider, {})).rejects.toThrow(
    'Translation provider changed placeholders in "viewer.greeting"',
  )
})
