import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '../src/cli'

let tempRoot: string | undefined
const originalCwd = process.cwd()
const originalArticraftRepoRoot = process.env.ARTICRAFT_REPO_ROOT

function makeArticraftCheckout(repoRoot: string) {
  const bridgeDir = path.join(repoRoot, 'articraft', 'python')
  mkdirSync(bridgeDir, { recursive: true })
  writeFileSync(path.join(bridgeDir, 'bridge.py'), '', 'utf8')
}

afterEach(() => {
  process.chdir(originalCwd)
  if (originalArticraftRepoRoot === undefined) {
    delete process.env.ARTICRAFT_REPO_ROOT
  } else {
    process.env.ARTICRAFT_REPO_ROOT = originalArticraftRepoRoot
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('resolveRepoRoot', () => {
  test('finds an Articraft checkout above a bundled app working directory', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-root-'))
    makeArticraftCheckout(tempRoot)
    const bundledCwd = path.join(tempRoot, 'apps', 'editor', '.next', 'dev', 'server', 'chunks')
    mkdirSync(bundledCwd, { recursive: true })

    delete process.env.ARTICRAFT_REPO_ROOT
    process.chdir(bundledCwd)

    expect(resolveRepoRoot()).toBe(path.join(tempRoot, 'articraft'))
  })

  test('rejects an explicit root without the bridge script', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-invalid-'))

    expect(() => resolveRepoRoot(tempRoot)).toThrow('Expected python')
  })
})
