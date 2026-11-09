import { expect, spyOn, test } from 'bun:test'
import {
  configureArtifactStore,
  DoorNode,
  GeometryArtifactManifest,
  getArtifactStore,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useLoader } from '@react-three/fiber'
import { act } from '@react-three/test-renderer'
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  VectorKeyframeTrack,
} from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { ItemGLTFLoader } from '../item/model-loader'
import { doorMechanism } from './mechanism'
import DoorRenderer from './renderer'

installMountedScene({ nodes: [] })

// A sliding door built from a script, as its compile leaves it: two leaf groups under the part,
// one `open` clip that slides each of them apart along x.
const LEAF_CLOSED = 0.255
const LEAF_OPEN = 0.729
const source = {
  kind: 'script' as const,
  script: 'b'.repeat(64),
  artifact: 'a'.repeat(64),
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.6, 0, -0.11], max: [0.6, 2.55, 0.11] },
    triangles: 12,
    animations: [{ name: 'open', duration: 1.3 }],
  }),
}

function stubSlidingLeaves() {
  return spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const scene = new Group()
    for (const side of [-1, 1]) {
      const leaf = new Group()
      leaf.name = `leaf_${side < 0 ? 0 : 1}`
      leaf.position.set(side * LEAF_CLOSED, 0, 0.025)
      leaf.add(new Mesh(new BoxGeometry(0.5, 2, 0.02), new MeshStandardMaterial()))
      scene.add(leaf)
    }
    const slide = (name: string, side: number) =>
      new VectorKeyframeTrack(
        `${name}.position`,
        [0, 1.3],
        [side * LEAF_CLOSED, 0, 0.025, side * LEAF_OPEN, 0, 0.025],
      )
    const clip = new AnimationClip('open', 1.3, [slide('leaf_0', -1), slide('leaf_1', 1)])
    onLoad({
      scene,
      scenes: [scene],
      animations: [clip],
      cameras: [],
      asset: { version: '2.0' },
      parser: {},
    } as never)
  })
}

test('a scripted sliding door opens and closes its leaves through the door mechanism', async () => {
  const oldStore = getArtifactStore()
  const url = 'https://example.com/scripted-sliding-door-test.glb'
  configureArtifactStore({ ...oldStore, url: () => url })
  const loader = stubSlidingLeaves()
  try {
    useLoader.preload(ItemGLTFLoader, url)
    await Promise.resolve()
    const node = DoorNode.parse({ id: 'door_sliding', doorType: 'sliding', source })
    useScene.setState({ nodes: { [node.id]: node } } as never)
    const renderer = await mount(<DoorRenderer node={node} />)
    const leaf = (name: string) => renderer.scene.instance.getObjectByName(name)!
    const frames = (count: number) =>
      act(async () => {
        await renderer.advanceFrames(count, 1 / 60)
      })
    await frames(3)

    // the door's open control exists once its model has loaded, and is closed
    expect(sceneRegistry.nodes.get(node.id)).toBeDefined()
    expect(useInteractive.getState().items[node.id]?.controlValues).toEqual([false])
    expect(doorMechanism.has(node)).toBe(true)
    expect(doorMechanism.isOn(node, useInteractive.getState())).toBe(false)
    expect(leaf('leaf_0').position.x).toBeCloseTo(-LEAF_CLOSED, 3)

    await act(async () => doorMechanism.set(node, true))
    await frames(90)
    expect(doorMechanism.isOn(node, useInteractive.getState())).toBe(true)
    expect(leaf('leaf_0').position.x).toBeCloseTo(-LEAF_OPEN, 3)
    expect(leaf('leaf_1').position.x).toBeCloseTo(LEAF_OPEN, 3)

    await act(async () => doorMechanism.set(node, false))
    await frames(90)
    expect(leaf('leaf_0').position.x).toBeCloseTo(-LEAF_CLOSED, 3)
    expect(leaf('leaf_1').position.x).toBeCloseTo(LEAF_CLOSED, 3)
    await renderer.unmount()
  } finally {
    useLoader.clear(ItemGLTFLoader, url)
    loader.mockRestore()
    configureArtifactStore(oldStore)
  }
})
