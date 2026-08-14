import { describe, expect, test } from 'bun:test'
import { DownspoutNode } from '@pascal-app/core'
import { downspoutParametrics } from './parametrics'

describe('downspout length mode', () => {
  test('switches an automatic downspout to manual when its length is edited', () => {
    const node = DownspoutNode.parse({ length: 6, lengthMode: 'to-ground' })
    expect(downspoutParametrics.derive?.({ ...node, length: 4 }, { length: 4 }, node)).toEqual({
      lengthMode: 'manual',
    })
  })
})
