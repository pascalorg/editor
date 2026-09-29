import { expect, test } from 'bun:test'
import type { AnyNodeDefinition } from '@pascal-app/core'
import { builtinPlugin } from '../../index'
import {
  columnBatchable,
  doorBatchable,
  itemBatchable,
  perNodeGeometryBatchable,
  surfaceBatchable,
  windowBatchable,
} from './batchable'

test('built-in kinds declare the batch behaviour that replaced BATCH_KINDS', () => {
  const batchable = Object.fromEntries(
    (builtinPlugin.nodes as AnyNodeDefinition[]).flatMap((definition) =>
      definition.capabilities?.batchable
        ? [[definition.kind, definition.capabilities.batchable]]
        : [],
    ),
  )
  expect(Object.keys(batchable).sort()).toEqual([
    'block',
    'ceiling',
    'column',
    'door',
    'imported-mesh',
    'item',
    'procedural-item',
    'slab',
    'window',
  ])
  expect(batchable.item).toBe(itemBatchable)
  expect(batchable.column).toBe(columnBatchable)
  expect(batchable.ceiling).toBe(surfaceBatchable)
  expect(batchable.slab).toBe(surfaceBatchable)
  expect(batchable.door).toBe(doorBatchable)
  expect(batchable.window).toBe(windowBatchable)
  expect(batchable.block).toBe(perNodeGeometryBatchable)
  expect(batchable['imported-mesh']).toBe(perNodeGeometryBatchable)
  expect(batchable['procedural-item']?.scope).toBe('level')
})
