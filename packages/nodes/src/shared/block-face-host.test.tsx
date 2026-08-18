import { describe, expect, test } from 'bun:test'
import { BlockNode, getBlockFaceFrame } from '@pascal-app/core'
import { applyBlockCommand } from '../block/commands'
import { resolveBlockFaceHostTransform } from './block-face-host'

const BLOCK_ID = 'block_face-host'

describe('BlockFaceHostFrame', () => {
  test('follows a face while its topology is being edited through a live override', () => {
    const host = BlockNode.parse({ id: BLOCK_ID })
    const result = applyBlockCommand(host.topology, {
      type: 'translate-components',
      selection: { mode: 'face', ids: ['f-front'] },
      delta: [0, 0, -0.5],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expected = getBlockFaceFrame(result.topology, 'f-front')
    expect(expected).not.toBeNull()

    const transform = resolveBlockFaceHostTransform(host, result.topology, 'f-front')

    expect(transform?.position).toEqual(expected!.origin)
  })
})
