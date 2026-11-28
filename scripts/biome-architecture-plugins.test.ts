import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The review-architecture plugins in biome.jsonc exempt legacy files with `!` entries. Each entry
// must still violate its rule, so the list only shrinks as legacy code is migrated.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = [
  './scripts/biome/kind-switch.grit',
  './scripts/biome/move-handler-scene-write.grit',
  './scripts/biome/shift-snap-bypass.grit',
]

type Override = { includes?: string[]; plugins?: string[] }
const config = Bun.JSONC.parse(await Bun.file(join(root, 'biome.jsonc')).text()) as {
  overrides: Override[]
}
const scratch = mkdtempSync(join(tmpdir(), 'biome-architecture-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** Plugin diagnostics for `file` with only `plugin` enabled and no exemptions. */
function pluginErrors(plugin: string, file: string): number {
  const dir = mkdtempSync(join(scratch, 'config-'))
  writeFileSync(
    join(dir, 'biome.json'),
    JSON.stringify({ linter: { rules: { preset: 'none' } }, plugins: [join(root, plugin)] }),
  )
  const run = Bun.spawnSync(
    [
      join(root, 'node_modules/.bin/biome'),
      'lint',
      `--config-path=${dir}`,
      '--reporter=json',
      file,
    ],
    { cwd: root, stderr: 'ignore' },
  )
  const report = JSON.parse(run.stdout.toString()) as { diagnostics: { category: string }[] }
  return report.diagnostics.filter((diagnostic) => diagnostic.category === 'plugin').length
}

describe('review-architecture Biome plugins', () => {
  for (const plugin of PLUGINS) {
    const override = config.overrides.find((entry) => entry.plugins?.includes(plugin))
    const legacy = (override?.includes ?? [])
      .filter((entry) => entry.startsWith('!') && !entry.includes('*'))
      .map((entry) => entry.slice(1))

    test(`${plugin} is enabled`, () => {
      expect(override).toBeDefined()
    })

    for (const file of legacy)
      test(`${plugin}: legacy ${file} still violates`, () => {
        const errors = pluginErrors(plugin, file)
        if (errors === 0)
          throw new Error(
            `${file} no longer violates ${plugin}. Delete its "!${file}" entry from biome.jsonc so the rule covers it.`,
          )
      })
  }
})
