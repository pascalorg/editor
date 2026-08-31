import { describe, expect, test } from 'bun:test'
import { collectRegistrySelectionIdsInBounds } from './use-floorplan-hit-testing'

const identityMatrix = {
  inverse() {
    return this
  },
}

function pointFactory() {
  return {
    x: 0,
    y: 0,
    matrixTransform() {
      return pointFactoryWithPosition(this.x, this.y)
    },
  }
}

function pointFactoryWithPosition(x: number, y: number) {
  return {
    x,
    y,
    matrixTransform() {
      return pointFactoryWithPosition(x, y)
    },
  }
}

function geometry(x: number, y: number, width: number, height: number) {
  return {
    getBBox: () => ({ x, y, width, height }),
    getScreenCTM: () => identityMatrix,
  } as unknown as SVGGraphicsElement
}

function entry(nodeId: string, children: SVGGraphicsElement[]) {
  return {
    dataset: { nodeId },
    querySelectorAll: () => children,
  } as unknown as SVGGElement
}

function scene(entries: SVGGElement[]) {
  return {
    getScreenCTM: () => identityMatrix,
    ownerSVGElement: {
      createSVGPoint: pointFactory,
    },
    querySelectorAll: () => entries,
  } as unknown as SVGGElement
}

describe('collectRegistrySelectionIdsInBounds', () => {
  test('selects rendered registry geometry and preserves candidate order', () => {
    const renderedScene = scene([
      entry('wall_1', [geometry(0, 0, 4, 0.2)]),
      entry('door_1', [geometry(1, 1, 0.9, 0.9)]),
      entry('outside_1', [geometry(20, 20, 1, 1)]),
    ])

    expect(
      collectRegistrySelectionIdsInBounds(renderedScene, { minX: -1, minY: -1, maxX: 5, maxY: 5 }, [
        'door_1',
        'outside_1',
        'wall_1',
      ]),
    ).toEqual(['door_1', 'wall_1'])
  })

  test('ignores rendered entries outside the selectable registry candidates', () => {
    const renderedScene = scene([entry('zone_1', [geometry(0, 0, 2, 2)])])

    expect(
      collectRegistrySelectionIdsInBounds(
        renderedScene,
        { minX: -1, minY: -1, maxX: 3, maxY: 3 },
        [],
      ),
    ).toEqual([])
  })
})
