import { describe, expect, test } from 'bun:test'
import {
  AssemblyNode,
  ConveyorBeltNode,
  DataChartNode,
  DataTableNode,
  DataWidgetNode,
} from '@pascal-app/core'
import { getPlanDrag3DKinds, isPlanDragMovableNode } from './plan-drag'

describe('plan drag movement', () => {
  test('treats assembly roots as plan-movable generated objects', () => {
    const assembly = AssemblyNode.parse({
      id: 'assembly_generated_equipment',
      type: 'assembly',
      position: [0, 0, 0],
    })

    expect(getPlanDrag3DKinds()).toContain('assembly')
    expect(isPlanDragMovableNode(assembly)).toBe(true)
  })

  test('treats conveyor belts as selected-drag plan movable objects', () => {
    const conveyorBelt = ConveyorBeltNode.parse({
      id: 'conveyor-belt_generated',
      type: 'conveyor-belt',
      points: [
        [0, 0, 0],
        [2, 0, 0],
      ],
    })

    expect(getPlanDrag3DKinds()).toContain('conveyor-belt')
    expect(isPlanDragMovableNode(conveyorBelt)).toBe(true)
  })

  test('treats data display widgets as selected-drag plan movable objects', () => {
    const widget = DataWidgetNode.parse({
      id: 'data-widget_temperature',
      type: 'data-widget',
    })
    const chart = DataChartNode.parse({
      id: 'data-chart_trend',
      type: 'data-chart',
    })
    const table = DataTableNode.parse({
      id: 'data-table_metrics',
      type: 'data-table',
    })

    expect(getPlanDrag3DKinds()).toContain('data-widget')
    expect(getPlanDrag3DKinds()).toContain('data-chart')
    expect(getPlanDrag3DKinds()).toContain('data-table')
    expect(isPlanDragMovableNode(widget)).toBe(true)
    expect(isPlanDragMovableNode(chart)).toBe(true)
    expect(isPlanDragMovableNode(table)).toBe(true)
  })
})
