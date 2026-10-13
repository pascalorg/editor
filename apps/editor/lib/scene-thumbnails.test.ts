import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteSceneThumbnail,
  readSceneThumbnail,
  sceneThumbnailUrl,
  thumbnailFile,
  writeSceneThumbnail,
} from './scene-thumbnails'

test('persists thumbnails beside the database and derives their URLs until deleted', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'scene-thumbnails-'))
  const savedEnv = {
    PASCAL_DATA_DIR: process.env.PASCAL_DATA_DIR,
    PASCAL_DB_PATH: process.env.PASCAL_DB_PATH,
  }
  try {
    process.env.PASCAL_DATA_DIR = tempDir
    delete process.env.PASCAL_DB_PATH
    expect(thumbnailFile('scene_1')).toBe(join(tempDir, 'thumbnails', 'scene_1.webp'))
    process.env.PASCAL_DB_PATH = join(tempDir, 'custom', 'scene.db')
    expect(thumbnailFile('scene_1')).toBe(join(tempDir, 'custom', 'thumbnails', 'scene_1.webp'))
    expect(() => thumbnailFile('../escape')).toThrow()
    expect(await sceneThumbnailUrl('scene_1')).toBeNull()
    expect(await readSceneThumbnail('scene_1')).toBeNull()

    const bytes = new Uint8Array([1, 2, 3, 4])
    await writeSceneThumbnail('scene_1', bytes)
    expect(await sceneThumbnailUrl('scene_1')).toMatch(/^\/api\/scenes\/scene_1\/thumbnail\?t=\d/)
    expect(await readSceneThumbnail('scene_1')).toEqual(bytes)
    await deleteSceneThumbnail('scene_1')
    expect(await sceneThumbnailUrl('scene_1')).toBeNull()
    expect(await readSceneThumbnail('scene_1')).toBeNull()
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})
