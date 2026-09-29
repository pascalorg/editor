import { describe, expect, test } from 'bun:test'
import { RoofNode } from '../schema/nodes/roof'
import { withoutSourceIdentity } from './subtree'

const layered = RoofNode.parse({
  id: 'roof_layered',
  provenance: { refs: [{ ns: 'al', id: 'roof-native-105880-42' }] },
  assembly: {
    layers: [
      { id: 'covering', role: 'covering', thickness: 0.009, src: 'al:roof-105880/covering' },
      { id: 'underlay', role: 'underlay', thickness: 0.001, src: 'al:roof-105880/underlay' },
      { id: 'sheathing', role: 'sheathing', thickness: 0.015875 },
    ],
    backing: [{ id: 'fill', role: 'fill', thickness: 0.1, src: 'al:roof-105880/fill' }],
    presetId: 'asphalt-shingle',
  },
})

describe('preset capture strips layer provenance (R3, D5)', () => {
  test('saving a layered roof as a preset keeps the stack and drops every src', () => {
    const stored = withoutSourceIdentity(layered)
    expect(JSON.stringify(stored)).not.toContain('"src"')
    expect(stored.provenance).toBeUndefined()
    expect(stored.assembly).toEqual({
      layers: [
        { id: 'covering', role: 'covering', thickness: 0.009 },
        { id: 'underlay', role: 'underlay', thickness: 0.001 },
        { id: 'sheathing', role: 'sheathing', thickness: 0.015875 },
      ],
      backing: [{ id: 'fill', role: 'fill', thickness: 0.1 }],
      presetId: 'asphalt-shingle',
    })
    expect(RoofNode.safeParse(stored).success).toBe(true)
    expect(layered.assembly?.layers[0]?.src).toBe('al:roof-105880/covering')
  })
})
