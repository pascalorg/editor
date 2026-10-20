import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { groundHoleOpenNode, SCENE_LAYER, SITE_GROUND, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh, Object3D } from 'three'
import { SiteRenderer } from './renderer'

// `showGround: false` says other geometry (an authored landscape, on a level above the ground)
// supplies the ground. While a level below grade is shown, the level display hides the storeys
// above it and the landscape with them: the site's ground stands in, its hole opening over the
// basement. With a level at or above grade shown, `showGround` is the author's.

const lot = (showGround: boolean | undefined, withTerrain = false) =>
  SiteNode.parse({
    id: 'site_lot',
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    ...(showGround === undefined ? {} : { showGround }),
    ...(withTerrain
      ? {
          terrain: encodeTerrainField(
            createTerrainField({ origin: [-12, -12], cols: 25, rows: 25, spacing: 1 }),
          ),
        }
      : {}),
  })

/** A house on the lot: a ground floor, over a basement when `basement` is set (the villa's numbers). */
function setHouse(basement: boolean) {
  const polygon: Array<[number, number]> = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ]
  const levels = basement ? ['level_b', 'level_g'] : ['level_g']
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: levels }),
    ...levels.flatMap((levelId) => [
      LevelNode.parse({
        id: levelId,
        parentId: 'building_a',
        level: levelId === 'level_b' ? -1 : 0,
        baseElevation: levelId === 'level_b' ? -3.63 : 0,
        height: 3.4,
        children: [`slab_${levelId}`],
      }),
      SlabNode.parse({
        id: `slab_${levelId}`,
        parentId: levelId,
        elevation: levelId === 'level_b' ? 0.28 : 0.05,
        polygon,
      }),
    ]),
  ]
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
}

const surfaces = (root: Object3D, role: 'solid' | 'veil') => {
  const found: Mesh[] = []
  root.traverse((object) => {
    if (object.userData[SITE_GROUND] === role) found.push(object as Mesh)
  })
  return found
}
const drawn = (surface: Object3D) => surface.visible && surface.layers.isEnabled(SCENE_LAYER)

/** The level display shows the basement (the storeys above it hidden), as the editor sets it. */
const showBasement = () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' })
const showGroundFloor = () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' })

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
})
afterEach(() => {
  groundHoleOpenNode().value = 0
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
})

async function groundOf(site: SiteNode, display: () => void) {
  const renderer = await create(<SiteRenderer node={site} />)
  try {
    await act(async () => display())
    await renderer.advanceFrames(2, 0.05)
    const scene = renderer.scene.instance as Object3D
    return {
      solid: surfaces(scene, 'solid').filter(drawn).length,
      veil: surfaces(scene, 'veil').filter(drawn).length,
    }
  } finally {
    await renderer.unmount()
  }
}

test.each([false, true])(
  'showGround false, the basement shown: the site ground stands in as it does with showGround on, and not with the ground floor shown (terrain: %p)',
  async (terrain) => {
    setHouse(true)
    const standIn = await groundOf(lot(false, terrain), showBasement)
    const own = await groundOf(lot(undefined, terrain), showBasement)
    expect(standIn.solid).toBeGreaterThan(0)
    expect(standIn.solid).toBe(own.solid)
    expect(standIn.veil).toBe(own.veil)
    // The ground floor shown: no site ground, the authored one is in view.
    expect((await groundOf(lot(false, terrain), showGroundFloor)).solid).toBe(0)
  },
)

test('showGround false and no level below grade: no site ground; showGround on or absent: drawn at grade and over the basement alike', async () => {
  setHouse(false)
  expect((await groundOf(lot(false), showGroundFloor)).solid).toBe(0)
  // The display only sets belowGrade for a level below grade; a scene without one never shows it.
  expect(useViewer.getState().hasLevelBelowGrade).toBe(false)
  setHouse(true)
  for (const showGround of [undefined, true])
    for (const display of [showGroundFloor, showBasement])
      expect((await groundOf(lot(showGround), display)).solid).toBeGreaterThan(0)
})

test('the stand-in follows the level display live: it comes with the basement and goes with it', async () => {
  setHouse(true)
  const renderer = await create(<SiteRenderer node={lot(false)} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(surfaces(scene, 'solid')).toHaveLength(0)
    await act(async () => showBasement())
    await renderer.advanceFrames(2, 0.05)
    expect(surfaces(scene, 'solid').filter(drawn).length).toBeGreaterThan(0)
    await act(async () => showGroundFloor())
    await renderer.advanceFrames(2, 0.05)
    expect(surfaces(scene, 'solid')).toHaveLength(0)
  } finally {
    await renderer.unmount()
  }
})
