import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeDefinition, ParametricDescriptor } from '@pascal-app/core'
import {
  collectXRSettingRows,
  createXRSettingPatch,
  readXRSettingValue,
  type XRSettingsContext,
} from './settings'

function context(
  node: AnyNode,
  parametrics: ParametricDescriptor<AnyNode>,
  source: 'node' | 'tool' = 'node',
): XRSettingsContext {
  return {
    definition: { parametrics } as AnyNodeDefinition,
    key: `${source}:test`,
    node,
    source,
    title: 'Test',
    ...(source === 'tool' ? { tool: node.type } : {}),
  }
}

describe('XR settings descriptors', () => {
  test('flattens visible fields, vector axes, and node actions into one pageable list', () => {
    const node = {
      id: 'test_1',
      type: 'test',
      position: [1, 2, 3],
      visible: true,
    } as unknown as AnyNode
    const parametrics = {
      actions: [{ label: 'Reset', onClick: () => undefined }],
      groups: [
        {
          fields: [
            { key: 'position', kind: 'vec3', label: 'Position' },
            { key: 'visible', kind: 'boolean', label: 'Visible' },
            { key: 'hidden', kind: 'number', visibleIf: () => false },
          ],
          label: 'Transform',
        },
      ],
    } as unknown as ParametricDescriptor<AnyNode>

    const rows = collectXRSettingRows(context(node, parametrics))
    expect(rows.map((row) => row.label)).toEqual([
      'Position X',
      'Position Y',
      'Position Z',
      'Visible',
      'Reset',
    ])
  })

  test('creates vector patches without mutating the source node', () => {
    const node = { id: 'test_1', type: 'test', position: [1, 2, 3] } as unknown as AnyNode
    const parametrics = {
      groups: [{ fields: [{ key: 'position', kind: 'vec3' }], label: 'Transform' }],
    } as unknown as ParametricDescriptor<AnyNode>
    const settings = context(node, parametrics)
    const row = collectXRSettingRows(settings)[1]
    if (row?.kind !== 'field') throw new Error('Expected field row')

    expect(readXRSettingValue(settings, row)).toBe(2)
    expect(createXRSettingPatch(settings, row, 9)).toEqual({ position: [1, 9, 3] })
    expect((node as unknown as { position: number[] }).position).toEqual([1, 2, 3])
  })

  test('runs the shared derive rule for placement defaults', () => {
    const node = { id: 'test_1', type: 'test', width: 2, area: 4 } as unknown as AnyNode
    const parametrics = {
      derive: (next: AnyNode) => ({
        area: Number((next as unknown as { width: number }).width) ** 2,
      }),
      groups: [{ fields: [{ key: 'width', kind: 'number' }], label: 'Size' }],
    } as unknown as ParametricDescriptor<AnyNode>
    const settings = context(node, parametrics, 'tool')
    const row = collectXRSettingRows(settings)[0]
    if (row?.kind !== 'field') throw new Error('Expected field row')

    expect(createXRSettingPatch(settings, row, 3)).toEqual({ area: 9, width: 3 })
  })

  test('includes registry tool chips for spatial placement controls', () => {
    const node = { id: 'test_1', type: 'test' } as unknown as AnyNode
    const chip = {
      cycle: () => undefined,
      labels: { cabinet: 'Type: Cabinet', island: 'Type: Island' },
      subscribe: () => () => undefined,
      value: () => 'cabinet',
    }
    const settings = {
      ...context(node, { groups: [] }, 'tool'),
      definition: {
        parametrics: { groups: [] },
        toolHints: [{ chip, key: 'I', label: 'Placement type' }],
      } as unknown as AnyNodeDefinition,
    }

    expect(collectXRSettingRows(settings)).toEqual([
      expect.objectContaining({ kind: 'tool-chip', label: 'Placement type' }),
    ])
  })
})
