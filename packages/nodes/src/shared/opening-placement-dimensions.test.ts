import { describe, expect, test } from 'bun:test'
import { DoorNode, type FloorplanGeometry, type GeometryContext, WallNode } from '@pascal-app/core'
import { buildOpeningPlacementDimensions } from './opening-placement-dimensions'

function dimensionTexts(geometry: FloorplanGeometry[]): string[] {
  return geometry.flatMap((entry) => (entry.kind === 'dimension' ? [entry.text] : []))
}

function context(unit: 'metric' | 'imperial'): {
  door: DoorNode
  ctx: GeometryContext
} {
  const door = DoorNode.parse({
    id: 'door_entry',
    parentId: 'wall_main',
    position: [1.8288, 1.05, 0],
    width: 0.6096,
  })
  const wall = WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    children: [door.id],
    start: [0, 0],
    end: [3.6576, 0],
    thickness: 0.2,
  })

  return {
    door,
    ctx: {
      resolve: (id) => (id === door.id ? door : undefined),
      children: [door],
      siblings: [],
      parent: wall,
      viewState: {
        selected: true,
        unit,
        highlighted: false,
        hovered: false,
        moving: true,
        palette: {
          selectedStroke: '#f97316',
          hoveredStroke: '#fb923c',
          wallHoverStroke: '#fb923c',
          handleFill: '#ffffff',
          handleStroke: '#f97316',
        },
      },
    },
  }
}

describe('buildOpeningPlacementDimensions', () => {
  test('formats temporary placement clearances using the live metric preference', () => {
    const { door, ctx } = context('metric')

    expect(dimensionTexts(buildOpeningPlacementDimensions(door, ctx))).toEqual(['1.52m', '1.52m'])
  })

  test('formats temporary placement clearances using the live imperial preference', () => {
    const { door, ctx } = context('imperial')

    expect(dimensionTexts(buildOpeningPlacementDimensions(door, ctx))).toEqual([`5'-0"`, `5'-0"`])
  })
})
