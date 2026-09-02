import { describe, expect, test } from 'bun:test'
import { levelSlabContextSignatures } from './system'

describe('levelSlabContextSignatures', () => {
  test('ignores an incomplete building transform instead of crashing', () => {
    const nodes = {
      building: {
        id: 'building',
        type: 'building',
        children: ['level'],
      },
      level: {
        id: 'level',
        type: 'level',
        parentId: 'building',
        children: [],
      },
    } as never

    expect(() => levelSlabContextSignatures(nodes)).not.toThrow()
  })
})
