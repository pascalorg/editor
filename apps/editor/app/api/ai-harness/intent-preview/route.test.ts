import { describe, expect, test } from 'bun:test'
import { parseIntentPreviewRequestBody } from './route'

describe('POST /api/ai-harness/intent-preview request parsing', () => {
  test('normalizes prompt, mode, purpose, image, and semantic selection', () => {
    const parsed = parseIntentPreviewRequestBody({
      prompt: ' 生成一个炼油厂 ',
      mode: 'factory',
      conversationPurpose: 'factory',
      image: { dataUrl: 'data:image/png;base64,abc' },
      selection: {
        nodeIds: ['node_1', 2, 'node_2'],
        assemblyId: 'assembly_1',
        semanticRole: 'inner-wall',
      },
    })

    expect(parsed).toEqual({
      prompt: '生成一个炼油厂',
      imageAttached: true,
      generationMode: 'factory',
      conversationPurpose: 'factory',
      selection: {
        nodeIds: ['node_1', 'node_2'],
        nodeType: undefined,
        assemblyId: 'assembly_1',
        semanticRole: 'inner-wall',
        sourcePartKind: undefined,
      },
    })
  })

  test('rejects empty requests without prompt or image', () => {
    expect(parseIntentPreviewRequestBody({ prompt: ' ' })).toBeNull()
  })
})
