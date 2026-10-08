import { expect, test } from 'bun:test'
import { z } from 'zod'
import { addColumnTool } from '../agent-tools/columns'
import { type ColumnNode, LevelNode } from '../schema'
import { addColumn } from './add-column'

const level = LevelNode.parse({ id: 'level_columns' })
const nodes = { [level.id]: level }
const context = { activeLevelId: level.id }
const input = z.object(addColumnTool.input)

function created(outcome: ReturnType<typeof addColumn>) {
  return outcome.changes?.create?.[0]?.node as ColumnNode
}

test('add_column creates an i-beam column', () => {
  const column = created(
    addColumn(
      nodes,
      input.parse({ x: 1, z: 2, crossSection: 'i-beam', width: 0.3, depth: 0.4 }),
      context,
    ),
  )
  expect(column.crossSection).toBe('i-beam')
  expect(column.width).toBe(0.3)
  expect(column.depth).toBe(0.4)
  expect(column.position).toEqual([1, 0, 2])
})

test('add_column takes tilt in degrees and stores radians', () => {
  const column = created(
    addColumn(nodes, input.parse({ x: 0, z: 0, tiltX: 10, tiltZ: '-5°' }), context),
  )
  expect(column.tiltX).toBeCloseTo((10 * Math.PI) / 180, 12)
  expect(column.tiltZ).toBeCloseTo((-5 * Math.PI) / 180, 12)
  expect(() => input.parse({ x: 0, z: 0, tiltX: 50 })).toThrow()

  const upright = created(addColumn(nodes, input.parse({ x: 0, z: 0 }), context))
  expect('tiltX' in upright || 'tiltZ' in upright).toBe(false)
})
