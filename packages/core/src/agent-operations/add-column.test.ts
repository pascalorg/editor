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
