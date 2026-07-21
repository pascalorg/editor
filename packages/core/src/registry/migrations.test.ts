import { describe, expect, test } from 'bun:test'
import { applyNodeMigrations } from './migrations'

describe('applyNodeMigrations', () => {
  test('applies registered migrations in schema-version order', () => {
    expect(
      applyNodeMigrations(
        { values: [] },
        {
          7: (old) => ({ values: [...(old as { values: number[] }).values, 7] }),
          5: (old) => ({ values: [...(old as { values: number[] }).values, 5] }),
          6: (old) => ({ values: [...(old as { values: number[] }).values, 6] }),
        },
      ),
    ).toEqual({ values: [5, 6, 7] })
  })

  test('leaves nodes without registered migrations unchanged', () => {
    const node = { type: 'unknown' }
    expect(applyNodeMigrations(node, undefined)).toBe(node)
  })
})
