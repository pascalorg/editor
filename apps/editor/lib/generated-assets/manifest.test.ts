import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createGeneratedAssetId,
  readGeneratedAssets,
  sanitizeSegment,
  upsertGeneratedAsset,
} from './manifest'

let tempDir: string | null = null

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = null
  }
})

describe('generated asset manifest', () => {
  test('sanitizes unsafe asset id segments', () => {
    expect(sanitizeSegment('扶手 chair / v1', 'asset')).toBe('chair-v1')
    expect(createGeneratedAssetId('image to 3d', '扶手椅')).toMatch(
      /^image-to-3d-asset-[a-f0-9-]+$/,
    )
  })

  test('upserts generated assets newest first', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'pascal-generated-assets-'))
    const manifestPath = path.join(tempDir, 'generated-assets.json')
    await upsertGeneratedAsset(manifestPath, {
      id: 'a',
      category: 'equipment',
      name: 'A',
      thumbnail: '/items/a/thumbnail.png',
      source: 'mine',
      src: '/items/a/model.glb',
    })
    await upsertGeneratedAsset(manifestPath, {
      id: 'b',
      category: 'equipment',
      name: 'B',
      thumbnail: '/items/b/thumbnail.png',
      source: 'mine',
      src: '/items/b/model.glb',
    })
    const assets = await readGeneratedAssets(manifestPath)
    expect(assets.map((asset) => asset.id)).toEqual(['b', 'a'])
  })
})
