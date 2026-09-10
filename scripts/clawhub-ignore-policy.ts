export const clawHubRequiredIgnorePatterns = [
  '.env*',
  '.next/',
  'dist/',
  'node_modules/',
  'coverage/',
  'test-results/',
  'playwright-report/',
  'screenshots/',
  '*.lock',
  '*.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const

export const clawHubCanonicalIgnorePolicy = `${clawHubRequiredIgnorePatterns.join('\n')}\n`

export function validateClawHubIgnorePolicy(
  content: string,
  hasLegacyIgnoreFile = false,
): string[] {
  const patterns = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const patternSet = new Set(patterns)
  const failures: string[] = []

  if (content !== clawHubCanonicalIgnorePolicy) {
    failures.push('.clawhubignore must be byte-identical to the canonical ignore policy')
  }

  for (const pattern of clawHubRequiredIgnorePatterns) {
    if (!patternSet.has(pattern)) failures.push(`.clawhubignore is missing ${pattern}`)
  }

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      failures.push(`.clawhubignore must not contain re-inclusion rule ${pattern}`)
    }
  }

  if (hasLegacyIgnoreFile) {
    failures.push('.clawdhubignore must not coexist with the canonical ignore policy')
  }

  return failures
}
