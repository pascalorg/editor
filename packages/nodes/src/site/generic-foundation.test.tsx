import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BaseNode,
  BuildingNode,
  emitter,
  isCaptureSessionOn,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  SiteNode,
  SlabNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { SITE_FOUNDATION, siteFoundation, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import type { Mesh, Object3D } from 'three'
import type { MeshLambertNodeMaterial } from 'three/webgpu'
import { sameFoundation } from './generic-foundation'
import { SiteRenderer } from './renderer'

// The generic foundation is drawn under every building's exterior walls (generic-foundation.tsx):
// two meshes, made once, shown whatever the level shown and wherever the eye is; the walkthrough
// has none.

const corners: Array<[number, number]> = [
  [0, 0],
  [8, 0],
  [8, 6],
  [0, 6],
]

const lot = () =>
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
  })

let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
}
beforeEach(() => {
  previous = { viewer: useViewer.getState(), scene: useScene.getState() }
})
afterEach(() => {
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
})
function ringOf(levelId: string) {
  return corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${levelId}_${index}`,
      parentId: levelId,
      start,
      end: corners[(index + 1) % 4],
    }),
  )
}

/** A house on the flat site, over a basement when `basement` is set (the villa's numbers). */
function setHouse(basement: boolean, extra: AnyNode[] = []) {
  const levels = basement ? ['level_b', 'level_g'] : ['level_g']
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: levels }),
    ...levels.flatMap((levelId) => {
      const walls = ringOf(levelId)
      return [
        LevelNode.parse({
          id: levelId,
          parentId: 'building_a',
          level: levelId === 'level_b' ? -1 : 0,
          baseElevation: levelId === 'level_b' ? -3.63 : 0,
          height: 3.4,
          children: [...walls.map((wall) => wall.id), `slab_${levelId}`],
        }),
        SlabNode.parse({
          id: `slab_${levelId}`,
          parentId: levelId,
          elevation: 0.05,
          thickness: 0.05,
          polygon: corners,
        }),
        ...walls,
      ]
    }),
    ...extra,
  ]
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
  })
}

const parts = (root: Object3D) => {
  const found: Mesh[] = []
  root.traverse((object) => {
    if (object.userData[SITE_FOUNDATION] === true) found.push(object as Mesh)
  })
  return found.sort((a, b) =>
    String(a.userData.genericFoundation).localeCompare(String(b.userData.genericFoundation)),
  )
}

const names = (root: Object3D) => parts(root).map((part) => part.userData.genericFoundation)

test('a house stands on a footing and a block wall, marked, found by captures and stripped from exports; over a basement only the footing; the walkthrough has none', async () => {
  setHouse(false)
  const renderer = await create(<SiteRenderer node={lot()} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const found = parts(scene)
    expect(names(scene)).toEqual(['footing', 'stem'])
    expect(found.every((part) => part.userData.pascalExport === 'strip')).toBe(true)
    // The capture finds them by their mark, through the site the renderer registered.
    expect(siteFoundation()).toEqual(found)
    await act(async () => useViewer.setState({ walkthroughMode: true }))
    expect(found.map((part) => part.visible)).toEqual([false, false])
    await act(async () => useViewer.setState({ walkthroughMode: false }))
    expect(found.map((part) => part.visible)).toEqual([true, true])
  } finally {
    await renderer.unmount()
  }
  setHouse(true)
  const over = await create(<SiteRenderer node={lot()} />)
  try {
    expect(names(over.scene.instance as Object3D)).toEqual(['footing'])
  } finally {
    await over.unmount()
  }
})

const paris = () =>
  SiteNode.parse({
    id: 'site_paris',
    dossier: {
      provider: 'pascal-map',
      asOf: '2026-10-16',
      address: { formatted: '12 Rue de Rivoli, 75004 Paris, France' },
      sections: {},
    },
  })

test('the stem is drawn in what the building is built of: block, concrete in Europe', async () => {
  const materialOf = async (extra: AnyNode[]) => {
    setHouse(false, extra)
    const renderer = await create(<SiteRenderer node={lot()} />)
    try {
      const [footing, stem] = parts(renderer.scene.instance as Object3D) as [Mesh, Mesh]
      return stem.material === footing.material ? 'concrete' : 'masonry'
    } finally {
      await renderer.unmount()
    }
  }
  expect(await materialOf([])).toBe('masonry')
  expect(await materialOf([paris()])).toBe('concrete')
})

test('switching floors and crossing the ground swap and rebuild no foundation mesh or material, and an edit that leaves the foundation as it was rebuilds none of it', async () => {
  setHouse(true)
  const renderer = await create(<SiteRenderer node={lot()} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const snapshot = () =>
      parts(scene).map((part) => {
        const material = part.material as MeshLambertNodeMaterial
        return { part, geometry: part.geometry, material, version: material.version }
      })
    const before = snapshot()
    for (const [levelId, below, under] of [
      ['level_b', true, false],
      ['level_g', false, false],
      ['level_b', true, true],
      ['level_g', false, true],
    ] as const) {
      await act(async () =>
        useViewer.setState({
          selection: { ...useViewer.getState().selection, levelId } as never,
          hideLevelsAboveSelection: below,
          belowGrade: below,
          gradeStanding: below ? 'below-grade' : 'at-grade',
          eyeUnderGround: under,
        }),
      )
      await renderer.advanceFrames(2, 0.05)
      const after = snapshot()
      expect(after).toHaveLength(before.length)
      after.forEach((entry, index) => {
        expect(entry.part).toBe(before[index]?.part)
        expect(entry.geometry).toBe(before[index]?.geometry)
        expect(entry.material).toBe(before[index]?.material)
        expect(entry.version).toBe(before[index]?.version ?? -1)
        expect(entry.part.visible).toBe(true)
      })
    }
    await act(async () => {
      const nodes = useScene.getState().nodes
      const level = nodes['level_g' as AnyNodeId]
      if (level?.type !== 'level') throw new Error('fixture')
      useScene.setState({ nodes: { ...nodes, level_g: { ...level, name: 'Ground' } } })
    })
    expect(snapshot().map((entry) => entry.geometry)).toEqual(before.map((entry) => entry.geometry))
  } finally {
    await renderer.unmount()
  }
})

test("a plugin that draws a level's foundation under the ground takes that level's members out of the geometry, and gives them back", async () => {
  setHouse(true)
  const renderer = await create(<SiteRenderer node={lot()} />)
  try {
    const scene = renderer.scene.instance as Object3D
    expect(names(scene)).toEqual(['footing'])
    // another level's foundation is not this one's: nothing leaves
    await act(async () => useViewer.setState({ pluginFoundationLevelIds: ['level_g'] }))
    expect(names(scene)).toEqual(['footing'])
    await act(async () => useViewer.setState({ pluginFoundationLevelIds: ['level_b'] }))
    expect(names(scene)).toEqual([])
    await act(async () => useViewer.setState({ pluginFoundationLevelIds: [] }))
    expect(names(scene)).toEqual(['footing'])
  } finally {
    await renderer.unmount()
  }
})

test('a plugin that steps aside from a picture has the foundation drawn for it while a capture session is on, with no scene edit', async () => {
  const Framer = BaseNode.extend({
    id: objectId('framer'),
    type: nodeType('test:picture-framer-site'),
  })
  const restoreRegistry = nodeRegistry._snapshot()
  registerNode({
    kind: 'test:picture-framer-site',
    schemaVersion: 1,
    schema: Framer,
    category: 'utility',
    defaults: () => ({}),
    capabilities: { drawsFoundation: () => !isCaptureSessionOn() },
  })
  setHouse(false)
  const nodes = useScene.getState().nodes
  const level = nodes['level_g' as AnyNodeId]
  if (level?.type !== 'level') throw new Error('fixture')
  useScene.setState({
    nodes: {
      ...nodes,
      level_g: { ...level, children: [...level.children, 'framer_g'] },
      framer_g: Framer.parse({ id: 'framer_g', parentId: 'level_g' }),
    } as Record<AnyNodeId, AnyNode>,
  })
  const session = (active: boolean) =>
    emitter.emit('camera-controls:capture-session', { owner: 'foundation-site-test', active })
  const renderer = await create(<SiteRenderer node={lot()} />)
  try {
    const scene = renderer.scene.instance as Object3D
    const names = () => parts(scene).map((part) => part.userData.genericFoundation)
    expect(names()).toEqual([])
    await act(async () => session(true))
    expect(names()).toEqual(['footing', 'stem'])
    await act(async () => session(false))
    expect(names()).toEqual([])
  } finally {
    session(false)
    await renderer.unmount()
    restoreRegistry()
  }
})

test('foundations are the same when every run is', () => {
  const run = {
    kind: 'stem' as const,
    material: 'cmu' as const,
    levelId: 'level_g',
    from: [0, 0] as [number, number],
    to: [4, 0] as [number, number],
    width: 0.2,
    bottomY: -0.3,
    topY: 0,
  }
  expect(sameFoundation([run], [{ ...run }])).toBe(true)
  expect(sameFoundation([run], [{ ...run, topY: 0.1 }])).toBe(false)
  expect(sameFoundation([run], [{ ...run, material: 'concrete' }])).toBe(false)
  expect(sameFoundation([run], [])).toBe(false)
})
