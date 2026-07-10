import { describe, expect, test } from 'bun:test'
import { cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode } from '../schema'

describe('cabinet module drag bounds', () => {
  test('uses schema dimensions instead of measured render geometry', () => {
    const module = CabinetModuleNode.parse({
      width: 0.82,
      depth: 0.64,
      carcassHeight: 0.74,
      plinthHeight: 0.11,
      countertopThickness: 0.03,
      showPlinth: true,
      withCountertop: true,
    })

    const bounds = cabinetModuleDefinition.capabilities.dragBounds?.(module, {})

    expect(bounds?.size).toEqual([0.82, 0.88, 0.64])
    expect(bounds?.center).toEqual([0, 0.44, 0])
  })
})
