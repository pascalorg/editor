import { describe, expect, test } from 'bun:test'
import { normalizeFalImageTo3DResponse, normalizeFalSam3DResponse } from './fal'

describe('normalizeFalImageTo3DResponse', () => {
  test('reads Tripo model_mesh and rendered_image outputs', () => {
    expect(
      normalizeFalImageTo3DResponse({
        task_id: 'task-1',
        model_mesh: {
          url: 'https://example.com/model.glb',
          file_size: 1234,
          content_type: 'application/octet-stream',
        },
        rendered_image: { url: 'https://example.com/render.webp' },
      }),
    ).toEqual({
      modelGlbUrl: 'https://example.com/model.glb',
      thumbnailUrl: 'https://example.com/render.webp',
      metadata: {
        taskId: 'task-1',
        modelFileSize: 1234,
      },
    })
  })

  test('prefers a GLB file from Tripo outputs', () => {
    expect(
      normalizeFalImageTo3DResponse({
        data: {
          pbr_model: { url: 'https://example.com/model.fbx' },
          model_mesh: { url: 'https://example.com/model.glb' },
        },
      }).modelGlbUrl,
    ).toBe('https://example.com/model.glb')
  })

  test('keeps compatibility with legacy fal model_glb responses', () => {
    expect(
      normalizeFalSam3DResponse({ model_glb: 'https://example.com/model.glb' }).modelGlbUrl,
    ).toBe('https://example.com/model.glb')
  })

  test('throws when no model URL is present', () => {
    expect(() => normalizeFalImageTo3DResponse({ metadata: [] })).toThrow('GLB model URL')
  })
})
