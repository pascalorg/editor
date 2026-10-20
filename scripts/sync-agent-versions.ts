import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Agent integrations quote published npm versions. The package.json files are the
// source of truth; this rewrites every quote so a release cannot leave one behind.
export const cliPinFiles = [
  '.cursor-plugin/mcp.json',
  'skills/.cursor-plugin/mcp.json',
  'skills/README.md',
  'skills/pascal-3d/references/setup.md',
  'skills/furniture-fit/references/setup.md',
] as const

export const mcpPackageName = '@pascal-app/mcp'

const cliPin = /@pascal-app\/cli@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g

/**
 * The version integrations should quote for a package, or undefined while the tree is on a
 * prerelease. Prereleases publish on npm's `beta` tag, so integrations keep the last stable one.
 */
export function stablePackageVersion(root: string, pkg: string): string | undefined {
  const { version } = JSON.parse(
    readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'),
  ) as { version: string }
  return version.includes('-') ? undefined : version
}

function syncServerJson(source: string, version: string): string {
  const manifest = JSON.parse(source)
  manifest.version = version
  for (const entry of manifest.packages ?? []) {
    if (entry.identifier === mcpPackageName) entry.version = version
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** Returns each managed file whose content differs from what the package versions require. */
export function agentVersionDrift(root: string): Map<string, string> {
  const cliVersion = stablePackageVersion(root, 'cli')
  const mcpVersion = stablePackageVersion(root, 'mcp')
  const expected = new Map<string, string>()
  if (cliVersion) {
    for (const path of cliPinFiles) {
      expected.set(
        path,
        readFileSync(join(root, path), 'utf8').replace(cliPin, `@pascal-app/cli@${cliVersion}`),
      )
    }
  }
  if (mcpVersion) {
    expected.set(
      'server.json',
      syncServerJson(readFileSync(join(root, 'server.json'), 'utf8'), mcpVersion),
    )
  }
  for (const [path, content] of expected) {
    if (readFileSync(join(root, path), 'utf8') === content) expected.delete(path)
  }
  return expected
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const drift = agentVersionDrift(root)
  if (process.argv.includes('--check')) {
    if (drift.size > 0) {
      console.error(
        `Agent integration versions are out of sync with packages/*/package.json:\n${[...drift.keys()].map((path) => `  ${path}`).join('\n')}\nRun: bun scripts/sync-agent-versions.ts`,
      )
      process.exit(1)
    }
  } else {
    for (const [path, content] of drift) {
      writeFileSync(join(root, path), content)
      console.log(`Updated ${path}`)
    }
  }
}
