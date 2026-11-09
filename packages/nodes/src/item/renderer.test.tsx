import { expect, spyOn, test } from 'bun:test'
import {
  ColumnNode,
  configureArtifactStore,
  DoorNode,
  GeometryArtifactManifest,
  getArtifactStore,
  ItemNode,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import { resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import { useLoader } from '@react-three/fiber'
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { ScriptedOpeningModel } from '../shared/scripted-opening'
import { itemDefinition } from './definition'
import { ItemGLTFLoader } from './model-loader'
import { ItemRenderer } from './renderer'

installMountedScene({ nodes: [itemDefinition] })

test.each([false, true])(
  'authored Glass appearance survives item rendering (material array: %s)',
  async (array) => {
    useViewer.setState({ textures: true, shading: 'rendered' })
    const texture = new DataTexture(new Uint8Array([33, 80, 120, 90]), 1, 1)
    const authored = new MeshStandardMaterial({
      color: '#227799',
      map: texture,
      transparent: true,
      opacity: 0.42,
      roughness: 0.17,
      metalness: 0.23,
    })
    authored.name = 'Glass'
    const node = ItemNode.parse({
      id: 'item_authored-glass',
      asset: {
        id: 'authored-glass',
        name: 'Authored glazing',
        category: 'object',
        src: `/authored-glass-${array}.glb`,
        thumbnail: '',
        dimensions: [1, 2, 0.02],
      },
    })
    useScene.setState({ nodes: { [node.id]: node } })
    const loader = spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      const scene = new Group()
      const pane = new Mesh(
        new BoxGeometry(1, 2, 0.02),
        array ? [authored, new MeshStandardMaterial()] : authored,
      )
      pane.name = 'authored-pane'
      scene.add(pane)
      onLoad({
        scene,
        scenes: [scene],
        animations: [],
        cameras: [],
        asset: { version: '2.0' },
        parser: {},
      } as never)
    })
    const url = resolveCdnUrl(node.asset.src)!
    try {
      useLoader.preload(ItemGLTFLoader, url)
      await Promise.resolve()
      const renderer = await mount(<ItemRenderer node={node} />)
      const pane = renderer.scene.instance.getObjectByName('authored-pane') as Mesh
      const material = (
        Array.isArray(pane.material) ? pane.material[0] : pane.material
      ) as MeshStandardMaterial
      expect(material.color.getHexString()).toBe('227799')
      expect(material).toMatchObject({
        transparent: true,
        opacity: 0.42,
        roughness: 0.17,
        metalness: 0.23,
      })
      expect(material.map?.image.data).toEqual(texture.image.data)
      await renderer.unmount()
    } finally {
      useLoader.clear(ItemGLTFLoader, url)
      loader.mockRestore()
      texture.dispose()
      authored.dispose()
    }
  },
)

const source = {
  kind: 'script' as const,
  script: 'b'.repeat(64),
  artifact: 'a'.repeat(64),
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.1], max: [0.5, 2, 0.1] },
    triangles: 12,
  }),
}

function stubGlassPanel() {
  return spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const scene = new Group()
    const material = new MeshStandardMaterial()
    material.name = 'slot_panel'
    material.userData.pascal_material = 'preset-glass'
    const pane = new Mesh(new BoxGeometry(1, 2, 0.02), material)
    pane.name = 'panel'
    scene.add(pane)
    onLoad({
      scene,
      scenes: [scene],
      animations: [],
      cameras: [],
      asset: { version: '2.0' },
      parser: {},
    } as never)
  })
}

test('a matched item panel stops casting, repainting opaque restores casting, and receiving stays enabled', async () => {
  useViewer.setState({ textures: true, shading: 'rendered' })
  const node = ItemNode.parse({
    id: 'item_glass-panel',
    asset: {
      id: 'glass-panel',
      name: 'Panel',
      category: 'object',
      src: '/glass-panel-test.glb',
      thumbnail: '',
      dimensions: [1, 2, 0.02],
    },
    source,
  })
  useScene.setState({ nodes: { [node.id]: node } })
  const loader = stubGlassPanel()
  const url = resolveCdnUrl(node.asset.src)!
  try {
    useLoader.preload(ItemGLTFLoader, url)
    await Promise.resolve()
    const renderer = await mount(<ItemRenderer node={node} />)
    const panel = renderer.scene.instance.getObjectByName('panel') as Mesh
    expect(panel).toBeDefined()
    expect(panel.castShadow).toBe(false)
    expect(panel.receiveShadow).toBe(true)

    await renderer.update(<ItemRenderer node={{ ...node, slots: { panel: '#cccccc' } }} />)
    expect(panel.castShadow).toBe(true)
    expect(panel.receiveShadow).toBe(true)
    await renderer.update(
      <ItemRenderer node={{ ...node, slots: { panel: 'library:preset-glass' } }} />,
    )
    expect(panel.castShadow).toBe(false)
    expect(panel.receiveShadow).toBe(true)
    await renderer.unmount()
  } finally {
    useLoader.clear(ItemGLTFLoader, url)
    loader.mockRestore()
  }
})

test('scripted door, window and column artifacts share the glass slot shadow policy', async () => {
  useViewer.setState({ textures: true, shading: 'solid' })
  const oldStore = getArtifactStore()
  configureArtifactStore({ ...oldStore, url: () => 'https://example.com/scripted-glass-test.glb' })
  const loader = stubGlassPanel()
  const url = 'https://example.com/scripted-glass-test.glb'
  try {
    useLoader.preload(ItemGLTFLoader, url)
    await Promise.resolve()
    for (const schema of [DoorNode, WindowNode, ColumnNode]) {
      const node = schema.parse({ source, slots: { panel: 'library:preset-glass' } })
      const renderer = await mount(<ScriptedOpeningModel node={node} />)
      const panel = renderer.scene.instance.getObjectByName('panel') as Mesh
      expect(panel).toBeDefined()
      expect(panel.castShadow).toBe(false)
      expect(panel.receiveShadow).toBe(true)
      await renderer.unmount()
    }
  } finally {
    useLoader.clear(ItemGLTFLoader, url)
    loader.mockRestore()
    configureArtifactStore(oldStore)
  }
})
