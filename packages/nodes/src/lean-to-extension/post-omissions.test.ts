import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ColumnNode,
  LeanToExtensionNode,
  type LeanToExtensionNode as LeanToNode,
} from '@pascal-app/core'
import { isLeanToPostOmitted, leanToPostOmissionPatchesOnDelete } from './post-omissions'

describe('isLeanToPostOmitted', () => {
  test('treats a legacy node without omission data as having no omitted posts', () => {
    const parsed = LeanToExtensionNode.parse({
      postLayoutMode: 'count',
      postCount: 3,
    })
    const { omittedPostSlots: _, ...legacy } = parsed

    expect(isLeanToPostOmitted(legacy as LeanToNode, 'low', 1)).toBe(false)
  })

  test('records the first omission on a legacy node without omission data', () => {
    const parsed = LeanToExtensionNode.parse({
      postLayoutMode: 'count',
      postCount: 3,
    })
    const { omittedPostSlots: _, ...legacy } = parsed
    const post = ColumnNode.parse({
      parentId: parsed.id,
      metadata: {
        leanToRole: 'post',
        managedByLeanTo: parsed.id,
        leanToPostIndex: 1,
        leanToPostSide: 'low',
      },
    })
    const nodes = {
      [parsed.id]: legacy,
      [post.id]: post,
    } as unknown as Record<AnyNodeId, AnyNode>

    expect(leanToPostOmissionPatchesOnDelete(post, nodes)).toEqual([
      {
        id: parsed.id,
        data: {
          omittedPostSlots: [{ side: 'low', index: 1, layoutCount: 3 }],
        },
      },
    ])
  })
})
