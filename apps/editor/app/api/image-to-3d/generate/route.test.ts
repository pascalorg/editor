import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { POST, replaceAssetDir } from './route'

const originalFalKey = process.env.FAL_KEY
const originalMaxImageMb = process.env.IMAGE_TO_3D_MAX_IMAGE_MB
const originalProvider = process.env.IMAGE_TO_3D_PROVIDER
const originalTencentSecretId = process.env.TENCENTCLOUD_SECRET_ID
const originalTencentSecretKey = process.env.TENCENTCLOUD_SECRET_KEY

afterEach(() => {
  process.env.FAL_KEY = originalFalKey
  process.env.IMAGE_TO_3D_MAX_IMAGE_MB = originalMaxImageMb
  process.env.IMAGE_TO_3D_PROVIDER = originalProvider
  process.env.TENCENTCLOUD_SECRET_ID = originalTencentSecretId
  process.env.TENCENTCLOUD_SECRET_KEY = originalTencentSecretKey
})

function requestWithForm(form: FormData) {
  return new Request('http://localhost/api/image-to-3d/generate', {
    method: 'POST',
    body: form,
  }) as Parameters<typeof POST>[0]
}

describe('POST /api/image-to-3d/generate', () => {
  test('rejects missing server FAL_KEY before generation', async () => {
    delete process.env.FAL_KEY
    const res = await POST(requestWithForm(new FormData()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'image file is required' })
  })

  test('rejects missing FAL_KEY only for fal requests after upload validation', async () => {
    delete process.env.FAL_KEY
    const form = new FormData()
    form.set('provider', 'fal')
    form.set('image', new File(['png'], 'item.png', { type: 'image/png' }))
    const res = await POST(requestWithForm(form))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'FAL_KEY is not configured on the server' })
  })

  test('rejects missing Tencent credentials for Hunyuan3D requests', async () => {
    delete process.env.TENCENTCLOUD_SECRET_ID
    delete process.env.TENCENTCLOUD_SECRET_KEY
    const form = new FormData()
    form.set('provider', 'hunyuan3d')
    form.set('image', new File(['png'], 'item.png', { type: 'image/png' }))
    const res = await POST(requestWithForm(form))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are not configured on the server',
    })
  })

  test('rejects non-image uploads', async () => {
    process.env.FAL_KEY = 'test'
    const form = new FormData()
    form.set('image', new File(['hello'], 'hello.txt', { type: 'text/plain' }))
    const res = await POST(requestWithForm(form))
    expect(res.status).toBe(400)
  })

  test('rejects oversized images', async () => {
    process.env.FAL_KEY = 'test'
    process.env.IMAGE_TO_3D_MAX_IMAGE_MB = '1'
    const form = new FormData()
    form.set('image', new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    const res = await POST(requestWithForm(form))
    expect(res.status).toBe(413)
  })

  test('rejects Hunyuan3D images over provider limit', async () => {
    process.env.FAL_KEY = 'test'
    process.env.TENCENTCLOUD_SECRET_ID = 'test'
    process.env.TENCENTCLOUD_SECRET_KEY = 'test'
    process.env.IMAGE_TO_3D_MAX_IMAGE_MB = '10'
    const form = new FormData()
    form.set('provider', 'hunyuan3d')
    form.set(
      'image',
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
    )
    const res = await POST(requestWithForm(form))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Hunyuan3D images must be 8MB or smaller' })
  })
})

describe('replaceAssetDir', () => {
  test('replaces a generated asset directory atomically when possible', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-image-to-3d-'))
    const tmpDir = path.join(root, 'asset.tmp')
    const assetDir = path.join(root, 'asset')
    try {
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.mkdir(assetDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'model.glb'), 'new')
      await fs.writeFile(path.join(assetDir, 'model.glb'), 'old')

      await replaceAssetDir(tmpDir, assetDir)

      await expect(fs.readFile(path.join(assetDir, 'model.glb'), 'utf8')).resolves.toBe('new')
      await expect(fs.stat(tmpDir)).rejects.toThrow()
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })
})
