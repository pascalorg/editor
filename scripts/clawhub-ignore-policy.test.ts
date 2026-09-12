import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { clawHubRequiredIgnorePatterns, validateClawHubIgnorePolicy } from './clawhub-ignore-policy'

const repositoryRoot = resolve(import.meta.dir, '..')
const canonicalPolicy = `${clawHubRequiredIgnorePatterns.join('\n')}\n`

describe('ClawHub ignore policy', () => {
  test.each(['pascal-3d', 'furniture-fit'])('%s uses the protected policy', (skillName) => {
    const content = readFileSync(
      join(repositoryRoot, 'skills', skillName, '.clawhubignore'),
      'utf8',
    )
    expect(validateClawHubIgnorePolicy(content)).toEqual([])
  })

  test.each([
    ['a broad re-inclusion', '!*'],
    ['a protected directory re-inclusion', '!dist/'],
    ['a nested protected file re-inclusion', '!screenshots/public.png'],
    ['a whitespace-prefixed re-inclusion', '  !.env.example'],
  ])('rejects %s rule appended after the exclusions', (_label, reinclude) => {
    expect(validateClawHubIgnorePolicy(`${canonicalPolicy}${reinclude}\n`)).toContain(
      `.clawhubignore must not contain re-inclusion rule ${reinclude.trim()}`,
    )
  })

  test('rejects a later legacy ignore file that could override the canonical policy', () => {
    expect(validateClawHubIgnorePolicy(canonicalPolicy, true)).toContain(
      '.clawdhubignore must not coexist with the canonical ignore policy',
    )
  })

  test('reports a missing protected pattern', () => {
    const incompletePolicy = canonicalPolicy.replace('screenshots/\n', '')
    expect(validateClawHubIgnorePolicy(incompletePolicy)).toContain(
      '.clawhubignore is missing screenshots/',
    )
  })

  test('rejects an empty canonical policy even when a legacy file exists', () => {
    const failures = validateClawHubIgnorePolicy('', true)
    expect(failures).toContain('.clawhubignore is missing .env*')
    expect(failures).toContain('.clawdhubignore must not coexist with the canonical ignore policy')
  })
})
