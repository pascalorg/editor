import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getCatalogStatus, readCatalogPreference, setCatalogPreference } from './catalog'
import { resolvePascalPaths } from './paths'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function paths() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'pascal-catalog-cli-test-'))
  directories.push(home)
  return resolvePascalPaths({ PASCAL_HOME: home })
}
const online = {
  mode: 'online',
  accountLinked: false,
  accountRequired: false,
  bundledCount: 23,
  onlineCount: 2,
  excludedCount: 1,
  message: 'Two additional free public catalog items.',
}

test('default and declined catalog status never probe or create runtime state', async () => {
  const p = await paths()
  let calls = 0
  const probe = async () => {
    calls++
    throw new Error('Unexpected probe')
  }
  expect(await getCatalogStatus(p, { probe })).toMatchObject({
    enabled: false,
    mode: 'bundled',
    accountRequired: false,
  })
  await setCatalogPreference(p, false)
  expect((await getCatalogStatus(p, { probe })).enabled).toBe(false)
  expect(calls).toBe(0)
  expect(
    await stat(p.run).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
})

test('connection preference is per home, atomic, and contains no credentials', async () => {
  const p = await paths()
  const other = await paths()
  await setCatalogPreference(p, true)
  expect(await readCatalogPreference(p)).toEqual({ schemaVersion: 1, online: true })
  expect(await readCatalogPreference(other)).toEqual({ schemaVersion: 1, online: false })
  const config = path.join(p.data, 'catalog.json')
  expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ schemaVersion: 1, online: true })
  expect((await stat(config)).mode & 0o777).toBe(0o600)
  let observed: string | undefined
  expect(
    await getCatalogStatus(p, {
      probe: async (dataDir) => {
        observed = dataDir
        return online
      },
    }),
  ).toMatchObject({ enabled: true, mode: 'online', onlineCount: 2 })
  expect(observed).toBe(p.data)
})

test('malformed preference refuses to probe and disconnect repairs it', async () => {
  const p = await paths()
  await setCatalogPreference(p, true)
  await writeFile(path.join(p.data, 'catalog.json'), '{broken')
  let calls = 0
  await expect(
    getCatalogStatus(p, {
      probe: async () => {
        calls++
        return online
      },
    }),
  ).rejects.toThrow('unreadable')
  expect(calls).toBe(0)
  await setCatalogPreference(p, false)
  expect((await getCatalogStatus(p)).mode).toBe('bundled')
})

test.each([
  null,
  { ...online, accountRequired: true },
  { ...online, onlineCount: -1 },
  { ...online, message: '\u001b[2Junsafe' },
])('invalid probe output fails closed: %j', async (reply) => {
  const p = await paths()
  await setCatalogPreference(p, true)
  expect(await getCatalogStatus(p, { probe: async () => reply })).toMatchObject({
    enabled: true,
    mode: 'unavailable',
    accountLinked: false,
  })
})

test('probe error keeps explicit enabled preference and generic fallback', async () => {
  const p = await paths()
  await setCatalogPreference(p, true)
  const result = await getCatalogStatus(p, {
    probe: async () => {
      throw new Error('secret token')
    },
  })
  expect(result).toMatchObject({ enabled: true, mode: 'unavailable' })
  expect(result.message).not.toContain('secret token')
  expect((await readCatalogPreference(p)).online).toBe(true)
})

test('disconnect wins over an in-flight CLI availability probe', async () => {
  const p = await paths()
  await setCatalogPreference(p, true)
  let finish!: (value: unknown) => void
  let started!: () => void
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve
  })
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const result = getCatalogStatus(p, {
    probe: () => {
      started()
      return pending
    },
  })
  await began
  await setCatalogPreference(p, false)
  finish(online)
  expect(await result).toMatchObject({ enabled: false, mode: 'bundled' })
})
