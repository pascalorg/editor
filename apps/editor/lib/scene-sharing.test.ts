import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteSceneShare,
  isSceneShared,
  setSceneShared,
  sharedSceneIds,
  shareFile,
} from './scene-sharing'

test('scenes are private until shared and persist share flags beside the database', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'scene-sharing-'))
  const savedEnv = {
    PASCAL_DATA_DIR: process.env.PASCAL_DATA_DIR,
    PASCAL_DB_PATH: process.env.PASCAL_DB_PATH,
  }
  try {
    process.env.PASCAL_DATA_DIR = tempDir
    delete process.env.PASCAL_DB_PATH
    expect(shareFile('scene_1')).toBe(join(tempDir, 'shares', 'scene_1'))
    process.env.PASCAL_DB_PATH = join(tempDir, 'custom', 'scene.db')
    expect(shareFile('scene_1')).toBe(join(tempDir, 'custom', 'shares', 'scene_1'))
    expect(await isSceneShared('scene_1')).toBe(false)
    expect(await sharedSceneIds()).toEqual([])

    await setSceneShared('scene_1', true)
    expect(await readFile(shareFile('scene_1'), 'utf8')).toBe('')
    expect(await isSceneShared('scene_1')).toBe(true)
    expect(await sharedSceneIds()).toEqual(['scene_1'])
    await setSceneShared('scene_1', false)
    expect(await isSceneShared('scene_1')).toBe(false)
    expect(await sharedSceneIds()).toEqual([])

    await setSceneShared('scene_1', true)
    await deleteSceneShare('scene_1')
    await deleteSceneShare('scene_1')
    expect(await isSceneShared('scene_1')).toBe(false)
    expect(await sharedSceneIds()).toEqual([])
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('share files reject invalid scene ids; a lookup just says not shared', async () => {
  for (const id of ['', '../escape', 'a/b', 'a.b', 'a'.repeat(65)]) {
    expect(() => shareFile(id)).toThrow('Invalid scene id')
    expect(await isSceneShared(id)).toBe(false)
    await expect(setSceneShared(id, true)).rejects.toThrow('Invalid scene id')
    await expect(deleteSceneShare(id)).rejects.toThrow('Invalid scene id')
  }
})
