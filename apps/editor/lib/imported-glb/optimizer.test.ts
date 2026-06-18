import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { optimizeImportedGlb } from './optimizer'

describe('optimizeImportedGlb', () => {
  test('returns a valid smaller GLB for an existing catalog fixture', async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      '..',
      '..',
      'public',
      'items',
      'ac-block',
      'model.glb',
    )
    const input = Buffer.from(await fs.readFile(fixturePath))
    const result = await optimizeImportedGlb(input, {
      triangles: 1_000,
      targetTriangles: 500,
    })

    expect(result.status).toBe('optimized')
    expect(result.finalBytes).toBeLessThan(result.originalBytes)
    expect(result.buffer.readUInt32LE(0)).toBe(0x4654_6c67)
  })
})
