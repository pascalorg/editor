import { describe, expect, test } from 'bun:test'
import { parseFactoryReleaseCandidateArgs } from './factory-release-candidate'

describe('factory release candidate script', () => {
  test('parses fast release candidate defaults', () => {
    expect(parseFactoryReleaseCandidateArgs([])).toMatchObject({
      withVisualSmoke: false,
      baseUrl: 'http://localhost:3002',
    })
  })

  test('parses visual smoke and artifact options', () => {
    expect(
      parseFactoryReleaseCandidateArgs([
        '--with-visual-smoke',
        '--base-url',
        'http://localhost:3999',
        '--out-dir',
        'apps/editor/qa-artifacts/rc/latest',
      ]),
    ).toEqual({
      withVisualSmoke: true,
      baseUrl: 'http://localhost:3999',
      outputDir: 'apps/editor/qa-artifacts/rc/latest',
    })
  })
})
