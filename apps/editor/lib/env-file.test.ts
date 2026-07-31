import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { candidateEnvFiles, loadEnvFiles, parseEnvFile } from './env-file'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dt-env-'))
  dirs.push(dir)
  const path = join(dir, 'config.env')
  writeFileSync(path, contents)
  return path
}

test('parses the KEY=value subset panels produce', () => {
  expect(
    parseEnvFile(
      [
        '# a comment',
        '',
        'DIGITALTWIN_MYSQL_HOST=127.0.0.1',
        'export DIGITALTWIN_MYSQL_PORT=3306',
        'DIGITALTWIN_MYSQL_USER = spaced ',
        'DIGITALTWIN_MYSQL_DATABASE="quoted"',
        "DIGITALTWIN_ADMIN_EMAIL='single'",
      ].join('\n'),
    ),
  ).toEqual({
    DIGITALTWIN_MYSQL_HOST: '127.0.0.1',
    DIGITALTWIN_MYSQL_PORT: '3306',
    DIGITALTWIN_MYSQL_USER: 'spaced',
    DIGITALTWIN_MYSQL_DATABASE: 'quoted',
    DIGITALTWIN_ADMIN_EMAIL: 'single',
  })
})

test('keeps a password containing = # $ and quotes intact', () => {
  const parsed = parseEnvFile('DIGITALTWIN_MYSQL_PASSWORD=p@ss=w0rd$x\nOTHER=1')
  expect(parsed.DIGITALTWIN_MYSQL_PASSWORD).toBe('p@ss=w0rd$x')
  // A '#' only starts a comment at the beginning of a line, so a password
  // containing one survives.
  expect(parseEnvFile('K=a#b').K).toBe('a#b')
})

test('ignores malformed lines rather than throwing', () => {
  expect(parseEnvFile('no-equals-here\n=novalue\n1BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' })
})

test('a real environment variable always wins over the file', () => {
  const path = tempEnvFile('DIGITALTWIN_MYSQL_HOST=from-file\nDIGITALTWIN_MYSQL_PORT=3306')
  const env: NodeJS.ProcessEnv = {
    DIGITALTWIN_ENV_FILE: path,
    DIGITALTWIN_MYSQL_HOST: 'from-panel',
  }
  loadEnvFiles(env)
  expect(env.DIGITALTWIN_MYSQL_HOST).toBe('from-panel')
  expect(env.DIGITALTWIN_MYSQL_PORT).toBe('3306')
})

test('an empty panel field counts as unset and the file fills it', () => {
  const path = tempEnvFile('DIGITALTWIN_MYSQL_PASSWORD=secret')
  const env: NodeJS.ProcessEnv = { DIGITALTWIN_ENV_FILE: path, DIGITALTWIN_MYSQL_PASSWORD: '' }
  loadEnvFiles(env)
  expect(env.DIGITALTWIN_MYSQL_PASSWORD).toBe('secret')
})

test('reports which files were read without leaking values', () => {
  const path = tempEnvFile('DIGITALTWIN_MYSQL_USER=someone\nDIGITALTWIN_MYSQL_PASSWORD=hunter2')
  const loaded = loadEnvFiles({ DIGITALTWIN_ENV_FILE: path })
  expect(loaded[0]).toContain(path)
  expect(loaded.join()).toContain('(2)')
  expect(loaded.join()).not.toContain('hunter2')
})

test('a missing file is not an error', () => {
  const env: NodeJS.ProcessEnv = { DIGITALTWIN_ENV_FILE: '/nonexistent/nope.env', HOME: '/nowhere' }
  expect(() => loadEnvFiles(env)).not.toThrow()
})

test('looks in the app directory and the home directory', () => {
  const candidates = candidateEnvFiles({ HOME: '/home/someone' })
  expect(candidates).toContain('/home/someone/.digitaltwin.env')
  expect(candidates.some((p) => p.endsWith('/.env'))).toBe(true)
})
