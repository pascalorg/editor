import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildArticraftFloorplan } from './floorplan'
import { ArticraftAssetNode } from './schema'

const node = ArticraftAssetNode.parse({
  catalogId: 'cabinet',
  title: 'Articulated cabinet',
  source: 'articraft-10k',
  artifact: { format: 'urdf', url: 'https://assets.example/model.urdf' },
  dimensions: [2, 1, 1],
  scale: 2,
  position: [4, 0, 6],
  rotation: [0, Math.PI / 2, 0],
  joints: [
    {
      name: 'door',
      type: 'revolute',
      parent: 'body',
      child: 'door',
      axis: [0, 1, 0],
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      limits: { lower: 0, upper: 1.2 },
    },
  ],
  attribution: {
    creator: 'Articraft authors',
    license: 'CC-BY-4.0',
    sourceUrl: 'https://huggingface.co/datasets/camvsl/Articraft-10K',
  },
})

describe('Articraft floor-plan footprint', () => {
  test('projects the scaled and rotated 3D bounds into plan space', () => {
    const geometry = buildArticraftFloorplan(node, {} as GeometryContext)
    expect(geometry?.kind).toBe('group')
    const polygon = (geometry as Extract<FloorplanGeometry, { kind: 'group' }>).children[0]
    expect(polygon?.kind).toBe('polygon')
    if (polygon?.kind !== 'polygon') throw new Error('Expected polygon footprint')
    expect(polygon.points[0]?.[0]).toBeCloseTo(3)
    expect(polygon.points[0]?.[1]).toBeCloseTo(8)
    expect(polygon.points[2]?.[0]).toBeCloseTo(5)
    expect(polygon.points[2]?.[1]).toBeCloseTo(4)
  })

  test('uses the host selection palette', () => {
    const geometry = buildArticraftFloorplan(node, {
      viewState: { selected: true, palette: { selectedStroke: '#00aaff' } },
    } as GeometryContext)
    if (geometry?.kind !== 'group' || geometry.children[0]?.kind !== 'polygon') {
      throw new Error('Expected polygon footprint')
    }
    expect(geometry.children[0].stroke).toBe('#00aaff')
  })
})
