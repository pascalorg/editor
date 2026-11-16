import { expect, test } from 'bun:test'
import { nodeRegistry, SiteNode, WallNode } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { Suspense } from 'react'
import type { Mesh } from 'three'
import { BATCHED_LAYER, SCENE_LAYER } from '../../lib/layers'
import useViewer from '../../store/use-viewer'
import { DaylightAtmosphere } from './daylight-atmosphere'
import { GlbScene } from './glb-scene'

test('baked daylight ground survives walls X-ray while the parcel hides, with and without a cut', async () => {
  const previous = useViewer.getState()
  const globals = [
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'ProgressEvent',
  ] as const
  const descriptors = globals.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  const restoreRegistry = nodeRegistry._snapshot()
  globalThis.requestAnimationFrame ??= () => 0
  globalThis.cancelAnimationFrame ??= () => {}
  globalThis.ProgressEvent ??= class extends Event {} as typeof ProgressEvent
  Object.assign(globalThis, { document: { body: { style: {} }, querySelector: () => null } })
  for (const [kind, family] of [
    ['site', 'site'],
    ['wall', 'walls'],
  ] as const)
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      extensions: { 'pascal:viewer': { family } },
    } as never)
  const site = SiteNode.parse({ id: 'site_baked_ground' })
  const wall = WallNode.parse({
    id: 'wall_baked_ground',
    parentId: site.id,
    start: [0, 0],
    end: [1, 0],
  })
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1])
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'site', extras: { pascalId: site.id, kind: 'site' }, children: [1, 2] },
      { name: 'parcel', mesh: 0 },
      { name: 'wall', mesh: 0, extras: { pascalId: wall.id, kind: 'wall' } },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [
      {
        byteLength: positions.byteLength,
        uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 0, 1],
      },
    ],
  }
  const url = `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(gltf)).toString('base64')}`
  useViewer.setState({ xrayFamily: null, walkthroughMode: false, sectionEnabled: false })
  const renderer = await create(
    <>
      <DaylightAtmosphere />
      <Suspense fallback={null}>
        <GlbScene sceneNodes={{ [site.id]: site, [wall.id]: wall }} url={url} />
      </Suspense>
    </>,
  )
  try {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
    })
    const root = renderer.scene.instance
    const parcel = root.getObjectByName('parcel')!
    const wallMesh = root.getObjectByName('wall')!
    expect(parcel).toBeDefined()
    const horizon = renderer.scene.findAll(
      (instance) =>
        (instance.instance as Mesh).geometry?.type === 'PlaneGeometry' &&
        instance.instance.position.y === -0.07,
    )[0]!.instance
    const mask = horizon.layers.mask
    for (const sectionEnabled of [false, true]) {
      await act(async () => useViewer.setState({ sectionEnabled, xrayFamily: 'walls' }))
      await renderer.advanceFrames(2, 1 / 60)
      expect(horizon.visible).toBe(true)
      expect(horizon.layers.mask).toBe(mask)
      expect(horizon.layers.isEnabled(SCENE_LAYER)).toBe(true)
      expect(parcel.layers.isEnabled(SCENE_LAYER)).toBe(false)
      expect(wallMesh.layers.isEnabled(SCENE_LAYER)).toBe(true)
      await act(async () => useViewer.getState().setXrayFamily(null))
      expect(horizon.layers.mask).toBe(mask)
      expect(parcel.layers.isEnabled(SCENE_LAYER) || parcel.layers.isEnabled(BATCHED_LAYER)).toBe(
        true,
      )
    }
  } finally {
    await renderer.unmount()
    useViewer.setState(previous, true)
    restoreRegistry()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
