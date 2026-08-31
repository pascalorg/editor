import { describe, expect, mock, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import { replacePreviewOverrideIds } from './preview-overrides'

const FIRST_ID = 'cabinet_first' as AnyNodeId
const SECOND_ID = 'cabinet_second' as AnyNodeId
const THIRD_ID = 'cabinet_third' as AnyNodeId

describe('replacePreviewOverrideIds', () => {
  test('clears companion overrides that leave the active preview', () => {
    const clear = mock(() => {})

    const nextIds = replacePreviewOverrideIds(
      new Set([FIRST_ID, SECOND_ID]),
      [
        [SECOND_ID, { width: 0.7 }],
        [THIRD_ID, { width: 0.5 }],
      ],
      clear,
    )

    expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith(FIRST_ID)
    expect(nextIds).toEqual(new Set([SECOND_ID, THIRD_ID]))
  })
})
