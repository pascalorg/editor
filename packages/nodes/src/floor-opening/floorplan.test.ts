import { expect, test } from 'bun:test'
import { FloorOpeningNode, type FloorplanGeometry, type GeometryContext } from '@pascal-app/core'
import { buildFloorOpeningFloorplan } from './floorplan'

const opening = FloorOpeningNode.parse({
  polygon: [
    [0, 0],
    [2, 0],
    [2, 1],
    [0, 1],
  ],
})
const context = (selected: boolean) =>
  ({
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: { selected },
  }) as unknown as GeometryContext

const kinds = (geometry: FloorplanGeometry | null): string[] =>
  geometry?.kind === 'group' ? geometry.children.flatMap(kinds) : geometry ? [geometry.kind] : []

test('an opening draws as a dashed outline, with corner handles only while selected', () => {
  expect(kinds(buildFloorOpeningFloorplan(opening, context(false)))).toEqual(['path'])
  const selected = kinds(buildFloorOpeningFloorplan(opening, context(true)))
  expect(selected.filter((kind) => kind === 'endpoint-handle')).toHaveLength(4)
  expect(selected.filter((kind) => kind === 'edge-handle')).toHaveLength(4)
})
