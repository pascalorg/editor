// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type {
  AmbientLight,
  Camera,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three/webgpu'
import {
  AMBIANCE_SECONDS,
  ambianceNow,
  SKY_LIGHT_SCALE,
  setAmbianceFactor,
  temporarilyWithoutAmbiance,
  undergroundAmbianceNode,
} from '../../lib/underground-ambiance'
import useViewer from '../../store/use-viewer'
import { startConstructionReveal } from '../../systems/construction-reveal/construction-reveal'
import { Lights } from './lights'

// Over a level below grade the ground is veiled, but the floor still lies in the shadow of the
// storeys above and has no sky over it: a light from the eye and a hemisphere lifted from below
// keep it from reading as a cave, as the agent's interior pictures are lit.

let previous: ReturnType<typeof useViewer.getState>
beforeEach(() => {
  previous = useViewer.getState()
  // Studio has a hemisphere whose ground colour is darker than its sky.
  useViewer.setState({ sceneTheme: 'studio', belowGrade: false, groundMode: 'auto' })
})
afterEach(() => {
  useViewer.setState(previous, true)
  setAmbianceFactor(0)
})

function lightsOf(root: Object3D) {
  const directional: DirectionalLight[] = []
  let hemisphere: HemisphereLight | null = null
  root.traverse((object) => {
    if ((object as DirectionalLight).isDirectionalLight)
      directional.push(object as DirectionalLight)
    if ((object as HemisphereLight).isHemisphereLight) hemisphere = object as HemisphereLight
  })
  return { directional, hemisphere: hemisphere as HemisphereLight | null }
}

test('over a veiled ground a fill shines from the eye, and the hemisphere lights the floor from below', async () => {
  let eye: Camera | null = null
  function Eye() {
    eye = useThree((state) => state.camera)
    return null
  }
  const renderer = await create(
    <>
      <Eye />
      <Lights />
    </>,
  )
  try {
    const scene = renderer.scene.instance as Object3D
    await renderer.advanceFrames(1, 0.1)
    const before = lightsOf(scene)
    const { hemisphere } = before
    if (!(hemisphere && eye)) throw new Error('the studio theme lights a scene with a camera')
    const camera: Camera = eye
    expect(hemisphere.groundColor.equals(hemisphere.color)).toBe(false)

    await act(async () => useViewer.setState({ belowGrade: true }))
    await renderer.advanceFrames(30, 0.1)
    const fills = lightsOf(scene).directional.filter((light) => !before.directional.includes(light))
    expect(fills).toHaveLength(1)
    const [fill] = fills
    expect(fill?.castShadow).toBe(false)
    expect(fill?.position.distanceTo(camera.position)).toBeLessThan(1e-6)
    expect(hemisphere.groundColor.getHex()).toBe(hemisphere.color.getHex())

    await act(async () => useViewer.setState({ groundMode: 'solid' }))
    // The fill leaves with the earth it came with: it fades out with the ambiance, then goes.
    await renderer.advanceFrames(30, 0.1)
    expect(lightsOf(scene).directional).toHaveLength(before.directional.length)
  } finally {
    await renderer.unmount()
  }
})

// The world turns to earth under the ground: the sky's light comes down, the factor the pipeline,
// the veil and the fill read eases over a short crossing, and the shown level's own materials are
// never touched.

function ambientOf(root: Object3D) {
  let ambient: AmbientLight | null = null
  root.traverse((object) => {
    if ((object as AmbientLight).isAmbientLight) ambient = object as AmbientLight
  })
  return ambient as AmbientLight | null
}

async function mountLights() {
  let camera: Camera | null = null
  function Eye() {
    camera = useThree((state) => state.camera)
    return null
  }
  const renderer = await create(
    <>
      <Eye />
      <Lights />
      <mesh name="floor-under-test">
        <boxGeometry args={[4, 0.2, 4]} />
        <meshStandardMaterial color="#aa5533" emissive="#110000" roughness={0.6} />
      </mesh>
    </>,
  )
  const scene = renderer.scene.instance as Object3D
  await renderer.advanceFrames(2, 0.1)
  if (!camera) throw new Error('the scene has a camera')
  return { renderer, scene, camera: camera as Camera }
}

test('going below grade eases the world to earth over the crossing and back out again', async () => {
  const { renderer, scene } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    if (!ambient) throw new Error('the lights include an ambient light')
    const atGrade = ambient.intensity
    expect(ambianceNow()).toBe(0)
    expect(useViewer.getState().ambianceActive).toBe(false)
    expect(undergroundAmbianceNode().value).toBe(0)

    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    await renderer.advanceFrames(4, 0.05)
    const mid = ambianceNow()
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(useViewer.getState().ambianceActive).toBe(true)
    expect(undergroundAmbianceNode().value).toBe(mid)

    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambianceNow()).toBe(1)
    expect(undergroundAmbianceNode().value).toBe(1)
    // The sky's light is down; the same lights go back as they were on the way out.
    expect(ambient.intensity).toBeCloseTo(atGrade * SKY_LIGHT_SCALE, 6)

    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambianceNow()).toBe(0)
    expect(ambient.intensity).toBeCloseTo(atGrade, 6)
  } finally {
    await renderer.unmount()
  }
})

test('with Animation off the world turns at once, in both directions', async () => {
  const driver = startConstructionReveal({ reveals: () => false, level: () => 'off' })
  const { renderer } = await mountLights()
  try {
    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    await renderer.advanceFrames(1, 0.016)
    expect(ambianceNow()).toBe(1)
    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    await renderer.advanceFrames(1, 0.016)
    expect(ambianceNow()).toBe(0)
  } finally {
    driver.stop()
    await renderer.unmount()
  }
})

test('an eye under the ground at its own position turns the world, over a level at grade too', async () => {
  const { renderer, camera } = await mountLights()
  try {
    camera.position.set(0, -3, 8)
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(useViewer.getState().eyeUnderGround).toBe(true)
    expect(ambianceNow()).toBe(1)

    camera.position.set(0, 6, 8)
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(useViewer.getState().eyeUnderGround).toBe(false)
    expect(ambianceNow()).toBe(0)
  } finally {
    await renderer.unmount()
  }
})

test('Solid turns the ambiance off with the veil, whatever the eye does', async () => {
  const { renderer, camera } = await mountLights()
  try {
    await act(async () =>
      useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade', groundMode: 'solid' }),
    )
    camera.position.set(0, -3, 8)
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambianceNow()).toBe(0)
    await act(async () => useViewer.setState({ groundMode: 'auto' }))
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambianceNow()).toBe(1)
  } finally {
    await renderer.unmount()
  }
})

test('the level that is shown keeps its materials: only the sky, the fog, the lights and the veil move', async () => {
  const { renderer, scene } = await mountLights()
  try {
    const floor = scene.getObjectByName('floor-under-test') as Mesh
    const material = floor.material as MeshStandardMaterial
    const before = {
      color: material.color.getHexString(),
      emissive: material.emissive.getHexString(),
      roughness: material.roughness,
      opacity: material.opacity,
      transparent: material.transparent,
    }
    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambianceNow()).toBe(1)
    expect({
      color: material.color.getHexString(),
      emissive: material.emissive.getHexString(),
      roughness: material.roughness,
      opacity: material.opacity,
      transparent: material.transparent,
    }).toEqual(before)
  } finally {
    await renderer.unmount()
  }
})

test('a capture is taken in the world’s own light, and the earth comes back after it', async () => {
  const { renderer, scene } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    if (!ambient) throw new Error('the lights include an ambient light')
    const atGrade = ambient.intensity
    await act(async () => useViewer.setState({ belowGrade: true, gradeStanding: 'below-grade' }))
    await renderer.advanceFrames(Math.ceil(AMBIANCE_SECONDS / 0.05) + 2, 0.05)
    expect(ambient.intensity).toBeLessThan(atGrade)

    const release = temporarilyWithoutAmbiance()
    expect(ambient.intensity).toBeCloseTo(atGrade, 6)
    expect(undergroundAmbianceNode().value).toBe(0)
    // A frame that runs during the capture keeps to it.
    await renderer.advanceFrames(2, 0.05)
    expect(ambient.intensity).toBeCloseTo(atGrade, 6)
    expect(undergroundAmbianceNode().value).toBe(0)

    release()
    await renderer.advanceFrames(2, 0.05)
    expect(ambient.intensity).toBeLessThan(atGrade)
    expect(undergroundAmbianceNode().value).toBe(1)
  } finally {
    await renderer.unmount()
  }
})
