import { describe, expect, test } from 'bun:test'
import { ColumnNode, LeanToExtensionNode } from '@pascal-app/core'
import { columnParametrics } from './parametrics'

describe('column deletion', () => {
  test('records a deleted managed lean-to pillar on its canopy', () => {
    const canopy = LeanToExtensionNode.parse({ id: 'leanto_delete_managed_post' })
    const pillar = ColumnNode.parse({
      id: 'column_delete_managed_post',
      parentId: canopy.id,
      metadata: {
        managedByLeanTo: canopy.id,
        leanToRole: 'post',
        leanToPostIndex: 1,
        leanToPostSide: 'high',
      },
    })

    const updates = columnParametrics.onDelete?.(pillar, {
      [canopy.id]: canopy,
      [pillar.id]: pillar,
    })

    expect(updates).toEqual([
      {
        id: canopy.id,
        data: { omittedPostSlots: [{ side: 'high', index: 1, layoutCount: 3 }] },
      },
    ])
  })
})
