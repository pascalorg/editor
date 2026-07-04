import { describe, expect, test } from 'bun:test'
import { parseAiHarnessRunRequestBody, parseRunIntentRouteEvidence } from './route'

describe('POST /api/ai-harness/runs body parsing', () => {
  test('decodes Windows cmd GB18030 JSON bodies before prompt routing', async () => {
    const gb18030Body = new Uint8Array([
      123, 34, 109, 111, 100, 101, 34, 58, 34, 112, 114, 105, 109, 105, 116, 105, 118, 101, 34, 44,
      34, 112, 114, 111, 109, 112, 116, 34, 58, 34, 201, 250, 179, 201, 210, 187, 184, 246, 189,
      193, 176, 232, 198, 247, 163, 172, 210, 187, 184, 246, 184, 203, 215, 211, 163, 172, 207, 194,
      195, 230, 202, 199, 200, 253, 198, 172, 189, 176, 210, 182, 34, 125,
    ])
    const body = await parseAiHarnessRunRequestBody(
      new Request('http://localhost/api/ai-harness/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: gb18030Body,
      }),
    )

    expect(body).toEqual({
      mode: 'primitive',
      prompt: '生成一个搅拌器，一个杆子，下面是三片桨叶',
    })
  })
})

describe('POST /api/ai-harness/runs intent route evidence parsing', () => {
  test('normalizes route evidence for run persistence', () => {
    expect(
      parseRunIntentRouteEvidence({
        kind: 'create-factory',
        confidence: 0.9,
        reason: 'Prompt matches refinery.',
        previewId: 'preview_1',
        requiredPack: {
          id: 'industry.refinery.basic',
          version: '0.1.0',
          installed: true,
          reason: 'installed',
        },
      }),
    ).toEqual({
      kind: 'create-factory',
      confidence: 0.9,
      reason: 'Prompt matches refinery.',
      previewId: 'preview_1',
      requiredPack: {
        id: 'industry.refinery.basic',
        version: '0.1.0',
        installed: true,
        reason: 'installed',
      },
    })
  })

  test('rejects incomplete route evidence', () => {
    expect(parseRunIntentRouteEvidence({ kind: 'create-factory' })).toBeUndefined()
  })
})
