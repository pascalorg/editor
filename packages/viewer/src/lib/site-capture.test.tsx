import { expect, test } from 'bun:test'
import { sceneRegistry, useRegistry } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { type ReactNode, useRef } from 'react'
import type { Group, Mesh, Object3D } from 'three'
import { SectionGroup } from '../components/viewer/section-group'
import { SiteSurfaceScope } from '../components/viewer/site-surface-scope'
import useViewer from '../store/use-viewer'
import { SCENE_LAYER } from './layers'
import {
  SITE_GROUND,
  SITE_HORIZON,
  siteGround,
  siteSurfaces,
  temporarilyHideSiteSurfaces,
  temporarilyVeilGround,
} from './site-surfaces'

// Live renderers register refs, never pascalId. Hosted items can sit under a wall mesh.
function LiveNode({
  id,
  type,
  mesh,
  children,
}: {
  id: string
  type: string
  mesh?: boolean
  children?: ReactNode
}) {
  const ref = useRef<Group & Mesh>(null!)
  useRegistry(id, type, ref)
  return mesh ? (
    <mesh name={id} ref={ref}>
      {children}
    </mesh>
  ) : (
    <group name={id} ref={ref}>
      {children}
    </group>
  )
}

function LiveSite() {
  return (
    <LiveNode id="site_capture" type="site">
      <LiveNode id="building_capture" type="building">
        <LiveNode id="level_capture" type="level">
          <LiveNode id="wall_capture" type="wall" mesh>
            <mesh name="wall-finish" />
            <LiveNode id="item_capture" type="item">
              <mesh name="item-draw" />
            </LiveNode>
          </LiveNode>
          <LiveNode id="slab_capture" type="slab" mesh />
        </LiveNode>
      </LiveNode>
      <SiteSurfaceScope
        siteId="site_capture"
        object={() => sceneRegistry.nodes.get('site_capture')}
      >
        <mesh name="lot" userData={{ [SITE_GROUND]: 'solid' }} />
        <mesh name="lot-veil" visible={false} userData={{ [SITE_GROUND]: 'veil' }} />
        <mesh name="horizon" userData={{ [SITE_GROUND]: 'solid', [SITE_HORIZON]: true }} />
        <mesh
          name="horizon-veil"
          visible={false}
          userData={{ [SITE_GROUND]: 'veil', [SITE_HORIZON]: true }}
        />
        <mesh name="outline" />
      </SiteSurfaceScope>
    </LiveNode>
  )
}

const names = (objects: Object3D[]) => objects.map((object) => object.name).sort()

// Main's direct-child rule for this fixture: 3 shown site draws, 2 solids, 2 hidden veils.
// The four building draws are descendants of registered roots, all without baked metadata.
test('live capture ownership and veiling preserve every building draw through section cycles', async () => {
  const previousViewer = useViewer.getState()
  useViewer.setState({ sectionEnabled: false, walkthroughMode: false, isExporting: false })
  const renderer = await create(
    <SectionGroup>
      <LiveSite />
    </SectionGroup>,
  )
  const buildingDraws = ['wall_capture', 'wall-finish', 'item-draw', 'slab_capture'].map(
    (name) => renderer.scene.findByProps({ name }).instance as Object3D,
  )
  const check = () => {
    expect(names(siteSurfaces())).toEqual(['horizon', 'lot', 'outline'])
    expect(siteSurfaces()).toHaveLength(3)
    expect(names(siteGround().solid)).toEqual(['horizon', 'lot'])
    expect(names(siteGround().veil)).toEqual(['horizon-veil', 'lot-veil'])
    for (const veiled of [true, false]) {
      const restore = temporarilyVeilGround(veiled)
      try {
        expect(
          buildingDraws.every((mesh) => mesh.visible && mesh.layers.isEnabled(SCENE_LAYER)),
        ).toBe(true)
      } finally {
        restore()
      }
    }
    const shownMeshes: Object3D[] = []
    renderer.scene.instance.traverse((object) => {
      if ('geometry' in object && object.visible && object.layers.isEnabled(SCENE_LAYER))
        shownMeshes.push(object)
    })
    const restoreThumbnail = temporarilyHideSiteSurfaces()
    try {
      // Exercises the exact helper BakeThumbnail calls, with the complete live hierarchy mounted.
      expect(shownMeshes.filter((mesh) => !mesh.layers.isEnabled(SCENE_LAYER))).toHaveLength(3)
      expect(
        buildingDraws.every((mesh) => mesh.visible && mesh.layers.isEnabled(SCENE_LAYER)),
      ).toBe(true)
      expect(buildingDraws).toHaveLength(4)
    } finally {
      restoreThumbnail()
    }
    expect(shownMeshes.every((mesh) => mesh.visible && mesh.layers.isEnabled(SCENE_LAYER))).toBe(
      true,
    )
    expect(names(siteSurfaces())).toEqual(['horizon', 'lot', 'outline'])
  }
  try {
    renderer.scene.instance.traverse((object) => expect(object.userData.pascalId).toBeUndefined())
    check()
    for (const sectionEnabled of [true, false, true, false]) {
      await act(async () => useViewer.getState().setSectionEnabled(sectionEnabled))
      await renderer.advanceFrames(1, 0.01)
      check()
    }
  } finally {
    await renderer.unmount()
    useViewer.setState(previousViewer, true)
    sceneRegistry.clear()
  }
})
