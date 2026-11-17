import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import {
  groundHoleOpenNode,
  SCENE_LAYER,
  SectionGroup,
  SITE_GROUND,
  siteGround,
  siteSurfaces,
  temporarilyVeilGround,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { type Mesh, type Object3D, Vector3 } from 'three'
import type { ClippingGroup } from 'three/webgpu'
import { LiveFamilyVisibility } from '../../../viewer/dist/components/viewer/family-visibility'
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

test.each([false, true])(
  'walls X-ray retains the live horizon and veil, hides the lot, and restores defaults (terrain: %p)',
  async (terrain) => {
    const restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._register({
      kind: 'site',
      schemaVersion: 1,
      extensions: { 'pascal:viewer': { family: 'site' } },
    } as never)
    setHouse(false)
    showGroundFloor()
    const site = lot(true, terrain)
    useScene.setState({ nodes: { ...useScene.getState().nodes, [site.id]: site } })
    useViewer.setState({ xrayFamily: null, walkthroughMode: false, groundWindowVeiled: false })
    const renderer = await create(
      <>
        <LiveFamilyVisibility />
        <SectionGroup>
          <SiteRenderer node={site} />
        </SectionGroup>
      </>,
    )
    try {
      for (const sectionEnabled of [false, true]) {
        await act(async () => useViewer.setState({ sectionEnabled, xrayFamily: null }))
        await renderer.advanceFrames(2, 0.05)
        const ground = siteGround()
        const horizon = ground.solid.find((mesh) => mesh.userData.pascalExport === 'strip')!
        const veil = ground.veil.find(
          (mesh) => (mesh as Mesh).geometry === (horizon as Mesh).geometry,
        )!
        const lotSurfaces = siteSurfaces().filter((mesh) => mesh !== horizon && mesh !== veil)
        expect(lotSurfaces.length).toBeGreaterThan(0)
        const defaults = [...lotSurfaces, horizon, veil].map((mesh) => [
          mesh.visible,
          mesh.layers.mask,
        ])
        await act(async () => useViewer.getState().setXrayFamily('walls'))
        expect(drawn(horizon)).toBe(true)
        expect(veil.layers.isEnabled(SCENE_LAYER)).toBe(true)
        expect(veil.visible).toBe(false)
        expect(lotSurfaces.every((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
        expect(siteGround()).toEqual(ground)
        expect(siteSurfaces()).toContain(horizon)
        const restoreCapture = temporarilyVeilGround(true)
        expect(drawn(horizon)).toBe(false)
        expect(drawn(veil)).toBe(true)
        restoreCapture()
        expect(drawn(horizon)).toBe(true)
        expect(veil.visible).toBe(false)
        await act(async () => useViewer.getState().setXrayFamily(null))
        expect(
          [...lotSurfaces, horizon, veil].map((mesh) => [mesh.visible, mesh.layers.mask]),
        ).toEqual(defaults)
      }
    } finally {
      await renderer.unmount()
      restoreRegistry()
    }
  },
)

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

test.each(['x', 'y', 'z'] as const)(
  'a %s cut leaves all site surfaces outside the model scope',
  async (axis) => {
    setHouse(false)
    showGroundFloor()
    useViewer.setState({
      sectionEnabled: true,
      sectionAxis: axis,
      sectionPosition: axis === 'y' ? -2 : 0,
    })
    const restoreRegistry = nodeRegistry._snapshot()
    registerNode({
      kind: 'item',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'furnish',
      defaults: () => ({}) as never,
      capabilities: {},
      renderer: {
        kind: 'parametric',
        module: async () => ({ default: () => <mesh name="tree-on-lot" position={[3, 2, 1]} /> }),
      },
    })
    const site = lot(true)
    const tree = { id: 'item_cut_tree', type: 'item', parentId: site.id, visible: true } as AnyNode
    site.children = [tree.id]
    useScene.setState({ nodes: { ...useScene.getState().nodes, [tree.id]: tree } })
    const renderer = await create(
      <SectionGroup name="cut-model">
        <SiteRenderer node={site} />
      </SectionGroup>,
    )
    try {
      const scene = renderer.scene.instance as Object3D
      const scope = renderer.scene.findByProps({ name: 'cut-model' }).instance
      const isInside = (object: Object3D) => {
        for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
          if (ancestor === scope) return true
        }
        return false
      }
      const treeMesh = renderer.scene.findByProps({ name: 'tree-on-lot' }).instance as Object3D
      expect(isInside(treeMesh)).toBe(true)
      expect(
        (scope as ClippingGroup).clippingPlanes[0]!.distanceToPoint(
          treeMesh.getWorldPosition(new Vector3()),
        ),
      ).toBeLessThan(0)
      const ground = surfaces(scene, 'solid')
      const horizon = ground.filter((mesh) => mesh.userData.pascalExport === 'strip')
      expect(horizon).toHaveLength(1)
      expect(horizon.every((mesh) => !isInside(mesh))).toBe(true)
      expect(
        ground.filter((mesh) => !horizon.includes(mesh)).every((mesh) => !isInside(mesh)),
      ).toBe(true)
      const lines: Object3D[] = []
      scene.traverse((object) => {
        if (object.type === 'Line' || object.renderOrder === 9) lines.push(object)
      })
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.every((line) => !isInside(line))).toBe(true)
      await act(async () => useViewer.getState().setExporting(true))
      // The exporter clones the model root after this commit, with the full lot under its site.
      const exportedGround = surfaces(scope, 'solid').filter(
        (mesh) => mesh.userData.pascalExport !== 'strip',
      )
      expect(exportedGround).toHaveLength(1)
      await act(async () => useViewer.getState().setExporting(false))
      expect(surfaces(scope, 'solid')).toHaveLength(0)
    } finally {
      await renderer.unmount()
      restoreRegistry()
    }
  },
)

test('default site surfaces keep the original parent chain and child order', async () => {
  setHouse(false)
  showGroundFloor()
  useViewer.setState({ sectionEnabled: false })
  const node = lot(true)
  const hierarchy = (root: Object3D) => {
    const result: {
      path: number[]
      kind: string
      ground: unknown
      export: unknown
      order: number
    }[] = []
    const visit = (object: Object3D, path: number[]) => {
      result.push({
        path,
        kind: object.type,
        ground: object.userData[SITE_GROUND],
        export: object.userData.pascalExport,
        order: object.renderOrder,
      })
      object.children.forEach((child, i) => {
        visit(child, [...path, i])
      })
    }
    root.children.forEach((child, i) => {
      visit(child, [i])
    })
    return result
  }
  // Pins the default site's parent chain and surface order before this change.
  const expected: ReturnType<typeof hierarchy> = [
    { path: [0], kind: 'Group', ground: undefined, export: undefined, order: 0 },
    { path: [0, 0], kind: 'Mesh', ground: 'solid', export: undefined, order: 0 },
    { path: [0, 1], kind: 'Mesh', ground: 'veil', export: 'strip', order: 0 },
    { path: [0, 2], kind: 'Mesh', ground: 'solid', export: 'strip', order: 0 },
    { path: [0, 3], kind: 'Mesh', ground: 'veil', export: 'strip', order: 0 },
    { path: [0, 4], kind: 'Line', ground: undefined, export: undefined, order: 9 },
  ]
  const renderer = await create(<SiteRenderer node={node} />)
  try {
    const actual = hierarchy(renderer.scene.instance)
    expect(actual.filter((object) => object.ground === 'solid')).toHaveLength(2)
    expect(actual.filter((object) => object.ground === 'veil')).toHaveLength(2)
    expect(actual).toEqual(expected)
  } finally {
    await renderer.unmount()
  }
})
