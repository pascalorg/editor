import { afterEach, beforeEach, expect, test } from 'bun:test'
import { type SitePresentation, sceneRegistry } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Color, type DirectionalLight, Mesh, Vector3 } from 'three'
import { vec3 } from 'three/tsl'
import { setKeyLightDirectionOverride } from '../../lib/key-light-override'
import useViewer from '../../store/use-viewer'
import { Lights } from './lights'
import { SceneAtmosphere, type SceneAtmosphereSource } from './scene-atmosphere'

const authored: SitePresentation = {
  shadows: true,
  lighting: {
    lights: [
      {
        position: [-18, 35, 20],
        target: [0, 0, 0],
        color: '#fff4df',
        intensity: 2.7,
        castShadow: true,
        shadow: {
          intensity: 1,
          mapSize: 4096,
          bias: -0.0002,
          normalBias: 0.015,
          radius: 1,
          camera: { left: -26, right: 26, top: 26, bottom: -26, near: 0.5, far: 500 },
        },
      },
    ],
  },
}
let previous: ReturnType<typeof useViewer.getState>
let context: Mesh

beforeEach(() => {
  previous = useViewer.getState()
  context = new Mesh(new BoxGeometry(300, 0.1, 300))
  sceneRegistry.nodes.set('item_shadow-test-context', context)
  useViewer.getState().setProjectId('project_shadow-test')
  useViewer.getState().setProjectPresentation(authored)
})

afterEach(() => {
  sceneRegistry.nodes.delete('item_shadow-test-context')
  context.geometry.dispose()
  useViewer.setState(previous, true)
  setKeyLightDirectionOverride(null)
})

test('authored shadow coverage survives distant ground, then returns to automatic fitting with the project look', async () => {
  const renderer = await create(<Lights />)
  try {
    await renderer.advanceFrames(1, 0.016)
    const light = renderer.scene.findByType('DirectionalLight').instance as DirectionalLight
    expect(light.position.toArray()).toEqual([-18, 35, 20])
    expect(light.target.position.toArray()).toEqual([0, 0, 0])
    expect(light.shadow.camera).toMatchObject({
      left: -26,
      right: 26,
      top: 26,
      bottom: -26,
      near: 0.5,
      far: 500,
    })
    expect(light.shadow.mapSize.toArray()).toEqual([4096, 4096])
    expect(light.shadow).toMatchObject({
      intensity: 1,
      bias: -0.0002,
      normalBias: 0.015,
      radius: 1,
    })
    await act(async () => {
      useViewer.getState().setProjectPresentation({
        shadows: true,
        lighting: {
          lights: [{ position: [10, 10, 10], color: '#ffffff', intensity: 4, castShadow: true }],
        },
      })
    })
    await renderer.advanceFrames(1, 0.016)
    expect(light.shadow.camera.right).toBeGreaterThan(100)
    expect(light.shadow.mapSize.toArray()).toEqual([1024, 1024])
    expect(light.shadow.normalBias).not.toBe(0.015)
    expect(light.shadow.bias).not.toBe(-0.0002)
  } finally {
    await renderer.unmount()
  }
})

test('a capture can temporarily aim an authored light without losing its saved pose or frustum', async () => {
  const renderer = await create(<Lights />)
  try {
    setKeyLightDirectionOverride([1, 0, 0])
    await renderer.advanceFrames(1, 0.016)
    const light = renderer.scene.findByType('DirectionalLight').instance as DirectionalLight
    expect(light.position.x).toBeCloseTo(Math.hypot(-18, 35, 20))
    expect(light.position.y).toBe(0)
    expect(light.position.z).toBe(0)
    expect(light.shadow.camera.right).toBe(26)
    setKeyLightDirectionOverride(null)
    await renderer.advanceFrames(1, 0.016)
    expect(light.position.toArray()).toEqual([-18, 35, 20])
  } finally {
    await renderer.unmount()
  }
})

test('an atmosphere owns the light while mounted and releases back to the authored shadow', async () => {
  const source: SceneAtmosphereSource = {
    skyRadiance: () => vec3(1),
    reflectionRadiance: () => vec3(1),
    fogRadiance: () => vec3(1),
    environmentNode: vec3(1),
    sunDirection: new Vector3(1, 1, 1).normalize(),
    sunColor: new Color('#ffffff'),
    sunIntensity: 2,
    moonDirection: new Vector3(-1, -1, -1).normalize(),
    moonColor: new Color('#ffffff'),
    moonIntensity: 0,
    skyColor: new Color('#ffffff'),
    groundColor: new Color('#ffffff'),
    hemisphereIntensity: 1,
    ambientIntensity: 0,
    exposure: 1,
    fogStart: 50,
    fogEnd: 100,
  }
  const renderer = await create(
    <>
      <SceneAtmosphere source={source} />
      <Lights />
    </>,
  )
  try {
    await renderer.advanceFrames(1, 0.016)
    const light = renderer.scene.findAllByType('DirectionalLight')[0]!.instance as DirectionalLight
    expect(light.shadow.camera.right).toBeGreaterThan(100)
    expect(light.shadow.mapSize.toArray()).toEqual([1024, 1024])
    await renderer.update(<Lights />)
    await renderer.advanceFrames(1, 0.016)
    const restored = renderer.scene.findByType('DirectionalLight').instance as DirectionalLight
    expect(restored.shadow.camera.right).toBe(26)
    expect(restored.shadow.mapSize.toArray()).toEqual([4096, 4096])
    expect(restored.position.toArray()).toEqual([-18, 35, 20])
  } finally {
    await renderer.unmount()
  }
})
