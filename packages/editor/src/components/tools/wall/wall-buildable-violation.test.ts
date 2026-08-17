import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, SiteNode as SiteSchema, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import { snapWallDraftPointDetailed } from './wall-drafting'

// `updateNodes` batches its dirty-marking through requestAnimationFrame, which
// bun's test runtime doesn't provide.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame
}

const LEVEL_ID = 'level_test' as AnyNodeId
const SITE_ID = 'site_test' as AnyNodeId

/** A 20 m square parcel with a uniform 3 m setback: buildable is 14 m square. */
function seedSite({ level = 0, defaultSetback = 3 }: { level?: number; defaultSetback?: number }) {
  const site = {
    ...SiteSchema.parse({
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
      defaultSetback,
    }),
    id: SITE_ID,
    parentId: null,
    children: [LEVEL_ID],
  } as unknown as AnyNode

  useScene.setState({
    nodes: {
      [SITE_ID]: site,
      [LEVEL_ID]: {
        id: LEVEL_ID,
        type: 'level',
        object: 'node',
        parentId: SITE_ID,
        visible: true,
        metadata: {},
        children: [],
        level,
        baseElevation: level * 2.5,
        height: 2.5,
      } as AnyNode,
    },
    rootNodeIds: [SITE_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

function snapAt(point: [number, number]) {
  return snapWallDraftPointDetailed({ point, walls: [], magnetic: false })
}

/**
 * #59's constraint. The setback maths has its own tests in `core`; what is
 * untested is whether the wall tool actually consults it — the answer the
 * drafting preview colours red and the click handler refuses.
 */
describe('wall draft against the buildable boundary', () => {
  beforeEach(() => {
    useViewer.setState({
      selection: {
        buildingId: 'building_test',
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    useEditor.getState().setSnappingMode('wall', 'lines')
    seedSite({})
  })

  test('a point inside the buildable ring is not a violation', () => {
    expect(snapAt([0, 0]).violation).toBeFalsy()
    // Just inside the 14 m square's edge.
    expect(snapAt([6.9, 6.9]).violation).toBeFalsy()
  })

  test('a point in the setback strip is a violation, though still on the parcel', () => {
    // Between the buildable edge (7 m) and the property line (10 m).
    expect(snapAt([8.5, 0]).violation).toBe(true)
    expect(snapAt([0, -9]).violation).toBe(true)
  })

  test('a point off the parcel entirely is a violation', () => {
    expect(snapAt([25, 25]).violation).toBe(true)
  })

  test('a deeper setback shrinks what counts as buildable', () => {
    // 8 m all round leaves a 4 m square, so the point that was fine at 3 m is not.
    seedSite({ defaultSetback: 8 })
    expect(snapAt([6.9, 6.9]).violation).toBe(true)
    expect(snapAt([1, 1]).violation).toBeFalsy()
  })

  test('with no setback there is no buildable ring to violate', () => {
    seedSite({ defaultSetback: 0 })
    expect(snapAt([9.5, 9.5]).violation).toBeFalsy()
  })

  // The constraint is deliberately scoped to the levels that sit on the ground.
  // A roof terrace on level 5 is not bound by a ground setback.
  test('levels above the third are not constrained', () => {
    seedSite({ level: 5 })
    expect(snapAt([25, 25]).violation).toBeFalsy()
  })
})
