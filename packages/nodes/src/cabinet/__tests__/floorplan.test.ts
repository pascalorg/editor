import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { cabinetDefinition } from '../definition'
import { buildCabinetFloorplan } from '../floorplan'
import { CabinetNode } from '../schema'

describe('buildCabinetFloorplan', () => {
  test('empty cabinet runs emit no fallback footprint', () => {
    const run = CabinetNode.parse({
      ...cabinetDefinition.defaults(),
      id: 'cabinet_empty-floorplan-run',
      children: [],
    })
    const ctx: GeometryContext = {
      children: [],
      parent: null,
      resolve: () => null as never,
      siblings: [],
    }

    expect(buildCabinetFloorplan(run, ctx)).toBeNull()
  })
})
