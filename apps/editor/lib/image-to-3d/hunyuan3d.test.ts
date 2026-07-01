import { afterEach, describe, expect, test } from 'bun:test'
import { generateHunyuan3D, normalizeHunyuan3DResponse } from './hunyuan3d'

const originalFetch = globalThis.fetch
const originalBaseUrl = process.env.HUNYUAN3D_BASE_URL
const originalApiKey = process.env.HUNYUAN3D_API_KEY
const originalService = process.env.HUNYUAN3D_SERVICE
const originalVersion = process.env.HUNYUAN3D_VERSION
const originalGenerateType = process.env.HUNYUAN3D_GENERATE_TYPE
const originalSecretId = process.env.TENCENTCLOUD_SECRET_ID
const originalSecretKey = process.env.TENCENTCLOUD_SECRET_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env.HUNYUAN3D_BASE_URL = originalBaseUrl
  process.env.HUNYUAN3D_API_KEY = originalApiKey
  process.env.HUNYUAN3D_SERVICE = originalService
  process.env.HUNYUAN3D_VERSION = originalVersion
  process.env.HUNYUAN3D_GENERATE_TYPE = originalGenerateType
  process.env.TENCENTCLOUD_SECRET_ID = originalSecretId
  process.env.TENCENTCLOUD_SECRET_KEY = originalSecretKey
})

describe('normalizeHunyuan3DResponse', () => {
  test('reads Tencent ResultFile3Ds GLB output', () => {
    expect(
      normalizeHunyuan3DResponse({
        JobId: 'job-1',
        Status: 'DONE',
        ResultFile3Ds: [
          {
            Type: 'GLB',
            Url: 'https://example.com/model.glb',
            PreviewImageUrl: 'https://example.com/preview.png',
          },
        ],
      }),
    ).toEqual({
      modelGlbUrl: 'https://example.com/model.glb',
      thumbnailUrl: 'https://example.com/preview.png',
      metadata: {
        jobId: 'job-1',
        status: 'DONE',
        resultFile3Ds: [
          {
            Type: 'GLB',
            Url: 'https://example.com/model.glb',
            PreviewImageUrl: 'https://example.com/preview.png',
          },
        ],
      },
    })
  })

  test('falls back to first returned model URL', () => {
    expect(
      normalizeHunyuan3DResponse({
        Response: {
          Status: 'DONE',
          ResultFile3Ds: [
            {
              Type: 'OBJ',
              Url: 'https://example.com/model.obj',
            },
          ],
        },
      }).modelGlbUrl,
    ).toBe('https://example.com/model.obj')
  })

  test('reads GLB from Tencent Response wrapper', () => {
    expect(
      normalizeHunyuan3DResponse({
        Response: {
          Status: 'DONE',
          ResultFile3Ds: [
            {
              Type: 'GLB',
              Url: 'https://example.com/wrapped.glb',
            },
          ],
        },
      }).modelGlbUrl,
    ).toBe('https://example.com/wrapped.glb')
  })

  test('throws when no model URL is present', () => {
    expect(() =>
      normalizeHunyuan3DResponse({
        Status: 'DONE',
        ResultFile3Ds: [
          {
            Type: 'Image',
            PreviewImageUrl: 'https://example.com/preview.png',
          },
        ],
      }),
    ).toThrow('model URL')
  })
})

describe('generateHunyuan3D Tencent request config', () => {
  function mockTencentFetch() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      calls.push({ url: String(url), headers })
      if (headers['X-TC-Action'] === 'SubmitHunyuanTo3DProJob') {
        return Response.json({ Response: { JobId: 'job-1', RequestId: 'request-1' } })
      }
      return Response.json({
        Response: {
          JobId: 'job-1',
          Status: 'DONE',
          ResultFile3Ds: [{ Type: 'GLB', Url: 'https://example.com/model.glb' }],
        },
      })
    }) as typeof fetch
    return calls
  }

  test('uses China ai3d defaults for the China Tencent endpoint', async () => {
    delete process.env.HUNYUAN3D_API_KEY
    delete process.env.HUNYUAN3D_SERVICE
    delete process.env.HUNYUAN3D_VERSION
    process.env.HUNYUAN3D_BASE_URL = 'https://ai3d.tencentcloudapi.com'
    process.env.TENCENTCLOUD_SECRET_ID = 'secret-id'
    process.env.TENCENTCLOUD_SECRET_KEY = 'secret-key'
    const calls = mockTencentFetch()

    await generateHunyuan3D({
      imageDataUri: 'data:image/png;base64,abc',
      timeoutMs: 1000,
      pollIntervalMs: 0,
    })

    expect(calls[0]?.headers['X-TC-Version']).toBe('2025-05-13')
    expect(calls[0]?.headers.Authorization).toContain('/ai3d/tc3_request')
  })

  test('keeps global Hunyuan defaults for the international Tencent endpoint', async () => {
    delete process.env.HUNYUAN3D_API_KEY
    delete process.env.HUNYUAN3D_SERVICE
    delete process.env.HUNYUAN3D_VERSION
    process.env.HUNYUAN3D_BASE_URL = 'https://hunyuan.intl.tencentcloudapi.com'
    process.env.TENCENTCLOUD_SECRET_ID = 'secret-id'
    process.env.TENCENTCLOUD_SECRET_KEY = 'secret-key'
    const calls = mockTencentFetch()

    await generateHunyuan3D({
      imageDataUri: 'data:image/png;base64,abc',
      timeoutMs: 1000,
      pollIntervalMs: 0,
    })

    expect(calls[0]?.headers['X-TC-Version']).toBe('2023-09-01')
    expect(calls[0]?.headers.Authorization).toContain('/hunyuan/tc3_request')
  })
})

describe('generateHunyuan3D AI3D cloud request config', () => {
  test('uses OpenAI-compatible submit and query endpoints when HUNYUAN3D_API_KEY is configured', async () => {
    process.env.HUNYUAN3D_API_KEY = 'sk-test'
    process.env.HUNYUAN3D_BASE_URL = 'https://api.ai3d.cloud.tencent.com'
    const calls: Array<{
      url: string
      headers: Record<string, string>
      body: Record<string, unknown>
    }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? '{}')),
      })
      if (String(url).endsWith('/v1/ai3d/submit')) {
        return Response.json({ JobId: 'job-cloud-1' })
      }
      return Response.json({
        JobId: 'job-cloud-1',
        Status: 'DONE',
        ResultFile3Ds: [{ Type: 'GLB', Url: 'https://example.com/cloud.glb' }],
      })
    }) as typeof fetch

    const result = await generateHunyuan3D({
      imageDataUri: 'data:image/png;base64,abc',
      prompt: 'pump',
      timeoutMs: 1000,
      pollIntervalMs: 0,
    })

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.ai3d.cloud.tencent.com/v1/ai3d/submit',
      'https://api.ai3d.cloud.tencent.com/v1/ai3d/query',
    ])
    expect(calls[0]?.headers.Authorization).toBe('sk-test')
    expect(calls[0]?.body).toMatchObject({
      Model: '3.1',
      ImageBase64: 'abc',
    })
    expect(calls[0]?.body.Prompt).toBeUndefined()
    expect(calls[1]?.body).toEqual({ JobId: 'job-cloud-1' })
    expect(result.modelGlbUrl).toBe('https://example.com/cloud.glb')
  })

  test('sends prompt with image only for Sketch mode', async () => {
    process.env.HUNYUAN3D_API_KEY = 'sk-test'
    process.env.HUNYUAN3D_BASE_URL = 'https://api.ai3d.cloud.tencent.com'
    process.env.HUNYUAN3D_GENERATE_TYPE = 'Sketch'
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      if (String(url).endsWith('/v1/ai3d/submit')) {
        return Response.json({ JobId: 'job-cloud-1' })
      }
      return Response.json({
        JobId: 'job-cloud-1',
        Status: 'DONE',
        ResultFile3Ds: [{ Type: 'GLB', Url: 'https://example.com/cloud.glb' }],
      })
    }) as typeof fetch

    await generateHunyuan3D({
      imageDataUri: 'data:image/png;base64,abc',
      prompt: 'line sketch pump',
      timeoutMs: 1000,
      pollIntervalMs: 0,
    })

    expect(bodies[0]).toMatchObject({
      GenerateType: 'Sketch',
      Prompt: 'line sketch pump',
      ImageBase64: 'abc',
    })
  })
})
