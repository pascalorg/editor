import { describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scriptPath = join(import.meta.dir, 'check-templates.ts')
const realTemplatesDir = join(import.meta.dir, '..', 'templates')

function runCheck(dir: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(['bun', scriptPath, dir, '--no-artifacts'], {
    cwd: join(import.meta.dir, '..'),
  })
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  }
}

describe('check-templates CLI', () => {
  test('fails on an empty template directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-check-'))
    try {
      const { exitCode, output } = runCheck(dir)
      expect(exitCode).toBe(1)
      expect(output).toContain('模板目录为空')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // quality outside the enum means the template is silently ignored by the
  // seed matcher — the check must make that loud.
  test('fails on a quality value outside good/bad', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-check-'))
    try {
      mkdirSync(join(dir, 'good'))
      cpSync(realTemplatesDir, dir, { recursive: true })
      const sample = join(dir, 'good', 'quality-typo.json')
      writeFileSync(
        sample,
        JSON.stringify({
          id: 'tpl-quality-typo',
          meta: { market: 'jp', label: 'typo', source: 'test', quality: 'excellent', badReasons: [] },
          plan: { footprint: { width: 5, depth: 5 }, rooms: [] },
        }),
      )
      const { exitCode, output } = runCheck(dir)
      expect(exitCode).toBe(1)
      expect(output).toContain('meta.quality 必须是 good 或 bad')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('fails on malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-check-'))
    try {
      cpSync(realTemplatesDir, dir, { recursive: true })
      writeFileSync(join(dir, 'good', 'broken.json'), '{"id":"broken"')
      const { exitCode, output } = runCheck(dir)
      expect(exitCode).toBe(1)
      expect(output).toContain('模板加载失败')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('passes on the real template library', () => {
    const { exitCode, output } = runCheck(realTemplatesDir)
    expect(exitCode).toBe(0)
    expect(output).toContain('体检通过')
  })
})
