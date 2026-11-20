import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  nodeRegistry,
  SiteNode,
  sceneRegistry,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  NodeRenderer,
  SCENE_LAYER,
  SectionGroup,
  SITE_GROUND,
  siteGround,
  siteSurfaces,
  temporarilyHideSiteSurfaces,
  temporarilyVeilGround,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { useRef } from 'react'
import type { Mesh, Object3D } from 'three'
import { BuildingRenderer } from '../building/renderer'
import { LevelRenderer } from '../level/renderer'
import { SiteRenderer } from './renderer'

// Stand-ins for geometry systems / downloaded assets; registration and hosted parenting are live.
function LiveDraw({ node }: { node: AnyNode }) {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, node.type, ref)
  return (
    <mesh ref={ref} name={node.id}>
      <boxGeometry />
      {(node.children ?? []).map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </mesh>
  )
}

const ids = (objects: Object3D[]) => objects.map((object) => `${object.type}:${object.uuid}`).sort()

test('thumbnail helper preserves a building mounted by the live site renderer across section cycles', async () => {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const restoreDefinitions = nodeRegistry._snapshot()
  for (const [kind, renderer] of [
    ['building', BuildingRenderer],
    ['level', LevelRenderer],
    ['wall', LiveDraw],
    ['item', LiveDraw],
  ] as const)
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      renderer: { kind: 'parametric', module: async () => ({ default: renderer }) },
    } as never)
  const site = SiteNode.parse({
    id: 'site_thumbnail',
    children: ['building_thumbnail'],
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
  const building = BuildingNode.parse({
    id: 'building_thumbnail',
    parentId: site.id,
    children: ['level_thumbnail'],
  })
  const level = LevelNode.parse({
    id: 'level_thumbnail',
    parentId: building.id,
    children: ['wall_thumbnail'],
  })
  const wall = {
    id: 'wall_thumbnail',
    type: 'wall',
    parentId: level.id,
    children: ['item_thumbnail'],
  } as AnyNode
  const item = { id: 'item_thumbnail', type: 'item', parentId: wall.id } as AnyNode
  useScene.setState({
    nodes: Object.fromEntries([site, building, level, wall, item].map((node) => [node.id, node])),
    rootNodeIds: [site.id],
  })
  useViewer.setState({
    sectionEnabled: false,
    walkthroughMode: false,
    isExporting: false,
    belowGrade: false,
    groundWindowVeiled: false,
  })
  const renderer = await create(
    <SectionGroup>
      <SiteRenderer node={site} />
    </SectionGroup>,
  )
  try {
    const root = sceneRegistry.nodes.get(site.id)!
    root.traverse((object) => expect(object.userData.pascalId).toBeUndefined())
    const buildingMeshes = [wall.id, item.id].map((id) => sceneRegistry.nodes.get(id)!)
    expect(buildingMeshes.every(Boolean)).toBe(true)
    const own = root.children.filter((object) => 'geometry' in object)
    // Literal main baseline for this polygon: lot + horizon + outline; two hidden veils.
    expect(own).toHaveLength(5)
    const signature = (objects: Object3D[]) =>
      objects.map((object) => `${object.type}:${object.userData[SITE_GROUND] ?? 'outline'}`).sort()
    const expectedShown = ['Line:outline', 'Mesh:solid', 'Mesh:solid']
    for (const sectionEnabled of [false, true, false, true, false]) {
      await act(async () => useViewer.getState().setSectionEnabled(sectionEnabled))
      await renderer.advanceFrames(1, 0.01)
      // Live section scopes remount their JSX surfaces. Compare current objects exactly, and
      // pin the same semantic surface counts across every mount.
      const currentOwn: Object3D[] = []
      renderer.scene.instance.traverse((object) => {
        if (object.userData[SITE_GROUND] || object.type === 'Line') currentOwn.push(object)
      })
      const shown = currentOwn.filter((object) => object.visible)
      const solids = currentOwn.filter((object) => object.userData[SITE_GROUND] === 'solid')
      const veils = currentOwn.filter((object) => object.userData[SITE_GROUND] === 'veil')
      expect(signature(shown)).toEqual(expectedShown)
      expect(solids).toHaveLength(2)
      expect(veils).toHaveLength(2)
      expect(ids(siteSurfaces())).toEqual(ids(shown))
      expect(siteSurfaces()).toHaveLength(3)
      expect(ids(siteGround().solid)).toEqual(ids(solids))
      expect(ids(siteGround().veil)).toEqual(ids(veils))
      const visibleBuilding = () =>
        buildingMeshes.every((mesh) => {
          if (!mesh.layers.isEnabled(SCENE_LAYER)) return false
          for (let object: Object3D | null = mesh; object; object = object.parent)
            if (!object.visible) return false
          return true
        })
      const restoreVeil = temporarilyVeilGround(true)
      try {
        expect(visibleBuilding()).toBe(true)
      } finally {
        restoreVeil()
      }
      const restoreThumbnail = temporarilyHideSiteSurfaces()
      try {
        expect(shown.filter((object) => !object.layers.isEnabled(SCENE_LAYER))).toHaveLength(3)
        expect(visibleBuilding()).toBe(true)
      } finally {
        restoreThumbnail()
      }
      expect(ids(siteSurfaces())).toEqual(ids(shown))
    }
  } finally {
    await renderer.unmount()
    restoreDefinitions()
    useScene.setState(previousScene, true)
    useViewer.setState(previousViewer, true)
  }
})
