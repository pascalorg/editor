#!/usr/bin/env node
// Fails when a package's `dist/` does not match its `src/`.
//
// Why this exists: `build` runs `tsc --build` while `dev` runs
// `tsgo --build --watch`, and both write the same `tsconfig.tsbuildinfo`.
// tsgo trusts that ledger without checking its own outputs exist, so a
// watch session can mark a project current while leaving `dist` on an
// older emit. Because `dist` is gitignored and every package resolves its
// `exports` to `./dist/*`, the app then bundles code that no longer
// matches any source in the repo — which reads as a logic bug and is
// debugged as one. This turns that into a build failure.

import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function isCompiledInput(path) {
  if (!/\.tsx?$/.test(path)) return false
  return !/\.(test|d)\.tsx?$/.test(path)
}

const packages = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(repoRoot, 'packages', entry.name))
  .filter((dir) => {
    try {
      return statSync(join(dir, 'dist')).isDirectory()
    } catch {
      return false
    }
  })

const problems = []

for (const pkgDir of packages) {
  const srcDir = join(pkgDir, 'src')
  const distDir = join(pkgDir, 'dist')
  const pkgName = relative(repoRoot, pkgDir)

  for (const srcPath of walk(srcDir).filter(isCompiledInput)) {
    const emitted = join(distDir, relative(srcDir, srcPath).replace(/\.tsx?$/, '.js'))
    let emittedStat
    try {
      emittedStat = statSync(emitted)
    } catch {
      problems.push(`${pkgName}: no emit for ${relative(pkgDir, srcPath)}`)
      continue
    }
    if (emittedStat.mtimeMs < statSync(srcPath).mtimeMs) {
      problems.push(`${pkgName}: ${relative(pkgDir, emitted)} is older than its source`)
    }
  }
}

if (problems.length > 0) {
  console.error(`dist/ is out of sync with src/ in ${problems.length} place(s):\n`)
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`)
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
  console.error('\nRun `bun run build --force` to re-emit, then re-run this check.')
  process.exit(1)
}

console.log(`dist/ matches src/ in ${packages.length} package(s).`)
