// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  levelStackGroundBox,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
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
  ambianceFocus,
  ambianceNow,
  EYE_FILL_INTENSITY,
  earthNow,
  FADE_SECONDS,
  groundHoleOpenNow,
  SKY_LIGHT_SCALE,
  setAmbianceFactor,
  setEarthFactor,
  setGroundHoleOpen,
  temporarilyWithoutAmbiance,
  undergroundAmbianceNode,
  undergroundEarthNode,
} from '../../lib/underground-ambiance'
import useViewer, { DEFAULT_UNDERGROUND_LOOK } from '../../store/use-viewer'
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
  setEarthFactor(0)
  setGroundHoleOpen(0)
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

function ambientOf(root: Object3D) {
  let ambient: AmbientLight | null = null
  root.traverse((object) => {
    if ((object as AmbientLight).isAmbientLight) ambient = object as AmbientLight
  })
  return ambient as AmbientLight | null
}

/** The eye's fill: the one directional light that casts no shadow and is not a theme light. */
function fillOf(root: Object3D) {
  let fill: DirectionalLight | null = null
  root.traverse((object) => {
    const light = object as DirectionalLight
    if (light.isDirectionalLight && !light.castShadow && light.intensity !== undefined) fill = light
  })
  return fill as DirectionalLight | null
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

const CROSSING_FRAMES = Math.ceil(AMBIANCE_SECONDS / 0.05) + 2
const BELOW_GRADE = { belowGrade: true, gradeStanding: 'below-grade' } as const

test('a veiled basement seen from above opens a hole and leaves the world as it is: the eye’s fill is the veil’s own 1', async () => {
  const { renderer, scene, camera } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    const { hemisphere } = lightsOf(scene)
    if (!(ambient && hemisphere)) throw new Error('the lights include an ambient and a hemisphere')
    const atGrade = ambient.intensity
    expect(groundHoleOpenNow()).toBe(0)
    expect(hemisphere.groundColor.equals(hemisphere.color)).toBe(false)

    await act(async () => useViewer.setState(BELOW_GRADE))
    await renderer.advanceFrames(4, 0.05)
    // The hole eases open over the crossing...
    expect(groundHoleOpenNow()).toBeGreaterThan(0)
    expect(groundHoleOpenNow()).toBeLessThan(1)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(groundHoleOpenNow()).toBe(1)
    // ...and nothing of the dark mode: no factor, the sky's light as it was.
    expect(ambianceNow()).toBe(0)
    expect(useViewer.getState().ambianceActive).toBe(false)
    expect(undergroundAmbianceNode().value).toBe(0)
    expect(ambient.intensity).toBe(atGrade)
    // The floor is lit from below as well as from above (the hemisphere settles on the sky's
    // colour), and the fill shines from the eye.
    await renderer.advanceFrames(30, 0.1)
    expect(fillOf(scene)?.intensity).toBe(1)
    expect(fillOf(scene)?.position.distanceTo(camera.position)).toBeLessThan(1e-6)
    expect(hemisphere.groundColor.getHex()).toBe(hemisphere.color.getHex())

    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(groundHoleOpenNow()).toBe(0)
  } finally {
    await renderer.unmount()
  }
})

test('the eye going under the ground eases the dark mode in over the crossing, and out again, and leaves the shown level’s own look alone', async () => {
  const { renderer, scene, camera } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    if (!ambient) throw new Error('the lights include an ambient light')
    const floor = (scene.getObjectByName('floor-under-test') as Mesh)
      .material as MeshStandardMaterial
    const look = () => [floor.color.getHexString(), floor.emissive.getHexString(), floor.roughness]
    const [above, before] = [ambient.intensity, look()]
    camera.position.set(0, 6, 8)
    await renderer.advanceFrames(2, 0.05)
    expect(useViewer.getState().eyeUnderGround).toBe(false)
    expect(ambianceNow()).toBe(0)

    camera.position.set(0, -3, 8)
    await renderer.advanceFrames(2, 0.05)
    // The fill mounts when the dive begins (a state change from inside a frame).
    await act(async () => {})
    await renderer.advanceFrames(2, 0.05)
    const mid = ambianceNow()
    expect(useViewer.getState().eyeUnderGround).toBe(true)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(useViewer.getState().ambianceActive).toBe(true)
    expect(undergroundAmbianceNode().value).toBe(mid)
    // The eye's light rides the same factor from its rest (0 here: no veil): no step.
    expect(fillOf(scene)?.intensity).toBeCloseTo(EYE_FILL_INTENSITY * mid, 6)

    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(1)
    // The sky's light is down; a level at grade has no hole; the floor is as it was.
    expect(ambient.intensity).toBeCloseTo(above * SKY_LIGHT_SCALE, 6)
    expect(fillOf(scene)?.intensity).toBeCloseTo(EYE_FILL_INTENSITY, 6)
    expect(groundHoleOpenNow()).toBe(0)
    expect(look()).toEqual(before)

    camera.position.set(0, 6, 8)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(0)
    expect(useViewer.getState().ambianceActive).toBe(false)
    expect(ambient.intensity).toBeCloseTo(above, 6)
  } finally {
    await renderer.unmount()
  }
})

test('the simple fade crosses in FADE_SECONDS, the noise mask in AMBIANCE_SECONDS, and the hole opens at its own pace either way', async () => {
  const fadeFrames = Math.ceil(FADE_SECONDS / 0.05) + 2
  expect(fadeFrames).toBeLessThan(CROSSING_FRAMES - 3)
  for (const transition of ['fade', 'noise'] as const) {
    const { renderer, camera } = await mountLights()
    try {
      useViewer.getState().setUndergroundLook({ transition })
      camera.position.set(0, 6, 8)
      await renderer.advanceFrames(2, 0.05)
      camera.position.set(0, -3, 8)
      await renderer.advanceFrames(2, 0.05)
      await act(async () => {})
      await renderer.advanceFrames(fadeFrames, 0.05)
      // Arrived on the fade's clock; still crossing on the mask's.
      if (transition === 'fade') expect(ambianceNow()).toBe(1)
      else {
        expect(ambianceNow()).toBeGreaterThan(0)
        expect(ambianceNow()).toBeLessThan(1)
      }
      camera.position.set(0, 6, 8)
      await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
      expect(ambianceNow()).toBe(0)

      // The hole is not the dive: the same 0.7 s whichever crossing is chosen.
      await act(async () => useViewer.setState(BELOW_GRADE))
      await renderer.advanceFrames(fadeFrames, 0.05)
      expect(groundHoleOpenNow()).toBeGreaterThan(0)
      expect(groundHoleOpenNow()).toBeLessThan(1)
      await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
      await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    } finally {
      useViewer.getState().setUndergroundLook(DEFAULT_UNDERGROUND_LOOK)
      await renderer.unmount()
    }
  }
})

test('with Animation off the dive, the hole and the earth are instant, in both directions', async () => {
  const driver = startConstructionReveal({ reveals: () => false, level: () => 'off' })
  const { renderer, camera } = await mountLights()
  try {
    camera.position.set(0, -3, 8)
    await act(async () => useViewer.setState(BELOW_GRADE))
    await renderer.advanceFrames(1, 0.016)
    expect(ambianceNow()).toBe(1)
    expect(groundHoleOpenNow()).toBe(1)
    camera.position.set(0, 6, 8)
    await act(async () => useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' }))
    await renderer.advanceFrames(1, 0.016)
    expect(ambianceNow()).toBe(0)
    expect(groundHoleOpenNow()).toBe(0)
    // The earth outside, in the walkthrough, is instant too.
    await act(async () => useViewer.setState({ walkthroughMode: true }))
    camera.position.set(0, -1.75, 0)
    await renderer.advanceFrames(1, 0.016)
    expect(earthNow()).toBe(1)
  } finally {
    driver.stop()
    await renderer.unmount()
  }
})

test('Solid turns the dark mode and the hole off, whatever the eye does', async () => {
  const { renderer, camera } = await mountLights()
  try {
    await act(async () => useViewer.setState({ ...BELOW_GRADE, groundMode: 'solid' }))
    camera.position.set(0, -3, 8)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(0)
    expect(groundHoleOpenNow()).toBe(0)
    await act(async () => useViewer.setState({ groundMode: 'auto' }))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(1)
    expect(groundHoleOpenNow()).toBe(1)
  } finally {
    await renderer.unmount()
  }
})

test('a capture is taken in the world’s own light, with no hole and no earth, and the dive comes back after it', async () => {
  const { renderer, scene, camera } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    if (!ambient) throw new Error('the lights include an ambient light')
    const atGrade = ambient.intensity
    await act(async () => useViewer.setState({ ...BELOW_GRADE, walkthroughMode: true }))
    camera.position.set(0, -3, 8)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(earthNow()).toBe(1)
    await act(async () => useViewer.setState({ walkthroughMode: false }))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambient.intensity).toBeLessThan(atGrade)
    expect(groundHoleOpenNow()).toBe(1)

    const release = temporarilyWithoutAmbiance()
    expect(ambient.intensity).toBeCloseTo(atGrade, 6)
    expect(undergroundAmbianceNode().value).toBe(0)
    expect(undergroundEarthNode().value).toBe(0)
    expect(groundHoleOpenNow()).toBe(0)
    // What a capture had before the dive existed: the veil's own fill over a veiled ground.
    expect(fillOf(scene)?.intensity).toBe(1)
    // A frame that runs during the capture keeps to it.
    await renderer.advanceFrames(2, 0.05)
    expect(ambient.intensity).toBeCloseTo(atGrade, 6)
    expect(groundHoleOpenNow()).toBe(0)

    release()
    await renderer.advanceFrames(2, 0.05)
    expect(ambient.intensity).toBeLessThan(atGrade)
    expect(undergroundAmbianceNode().value).toBe(1)
    expect(groundHoleOpenNow()).toBe(1)
  } finally {
    await renderer.unmount()
  }
})

// Adding or taking away a light changes every lit material's shader (a runtime compile, ~430 ms on
// the villa). A scene with a level below grade has the eye's fill from the start, and a house with
// no basement has it once the host says the eye may dive.
test.each([
  ['a scene with a level below grade', { hasLevelBelowGrade: true }],
  ['a house with none, once the eye may dive', { diveAvailable: true }],
] as const)('switching floors and diving add and take away no light: %s', async (_, ready) => {
  const { renderer, scene, camera } = await mountLights()
  try {
    await act(async () => void useViewer.setState(ready))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    const lights = () => {
      const { directional, hemisphere } = lightsOf(scene)
      const ambient = ambientOf(scene)
      return [...directional, ...(hemisphere ? [hemisphere] : []), ...(ambient ? [ambient] : [])]
    }
    const start = lights()
    expect(fillOf(scene)?.intensity).toBe(0)
    const steps: Array<() => Promise<void>> = [
      () => act(async () => void useViewer.setState(BELOW_GRADE)),
      async () => void camera.position.set(0, -3, 8),
      () =>
        act(async () => void useViewer.setState({ belowGrade: false, gradeStanding: 'at-grade' })),
      async () => void camera.position.set(0, 6, 8),
      () => act(async () => void useViewer.setState({ ...BELOW_GRADE, groundMode: 'solid' })),
      () => act(async () => void useViewer.setState({ groundMode: 'auto' })),
    ]
    for (const step of steps) {
      await step()
      await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
      const now = lights()
      expect(now).toHaveLength(start.length)
      for (const light of now) expect(start).toContain(light)
    }
  } finally {
    await renderer.unmount()
  }
})

// Several levels below grade (15 Oct): a house over four basements, 3 m a floor, 0 / -1 .. -4.
function withDeepStack() {
  const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const plans: Array<[number, Array<[number, number]>]> = [
    [-4, rect(8, 16, 2, 6)],
    [-3, rect(0, 4, 0, 3)],
    [-2, rect(-3, 13, -3, 11)],
    [-1, rect(0, 10, 0, 8)],
    [0, rect(0, 10, 0, 8)],
  ]
  const list: AnyNode[] = [
    SiteNode.parse({ id: 'site_d', children: ['building_d'] }),
    BuildingNode.parse({
      id: 'building_d',
      parentId: 'site_d',
      children: plans.map(([n]) => `level_d${n + 4}`),
    }),
  ]
  for (const [n, polygon] of plans)
    list.push(
      LevelNode.parse({
        id: `level_d${n + 4}`,
        level: n,
        height: 3,
        baseElevation: n === -4 ? -12 : 0,
        parentId: 'building_d',
        children: [`slab_d${n + 4}`],
      }),
      SlabNode.parse({ id: `slab_d${n + 4}`, parentId: `level_d${n + 4}`, elevation: 0, polygon }),
    )
  const nodes = Object.fromEntries(list.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  useScene.setState({ nodes, rootNodeIds: ['site_d'] } as never)
}

const showDeep = (index: number) =>
  useViewer.setState({
    selection: {
      ...useViewer.getState().selection,
      buildingId: 'building_d',
      levelId: `level_d${index + 4}`,
    },
    hideLevelsAboveSelection: true,
    ...BELOW_GRADE,
    groundWindowBox: null,
  } as never)

test('the fog keeps the shown level and the ones under it clear, not the ones over it, and the host’s ground window box serves when no level is shown', async () => {
  const previousScene = useScene.getState()
  withDeepStack()
  const { renderer, camera } = await mountLights()
  try {
    camera.position.set(30, -3, 30)
    await act(async () => showDeep(-2))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    const stack = levelStackGroundBox(useScene.getState().nodes, 'level_d2')
    expect(ambianceFocus()).toEqual({ min: stack?.min, max: stack?.max })
    // -2, -3 and -4 floors are at -6 .. -12: the box does not reach up to the ground floor.
    expect(stack?.min[1]).toBe(-12)
    expect(stack?.max[1]).toBe(-3)

    const host = {
      min: [-3, -1, -2] as [number, number, number],
      max: [3, 2, 2] as [number, number, number],
    }
    await act(async () =>
      useViewer.setState({
        groundWindowBox: host,
        hideLevelsAboveSelection: false,
        belowGrade: false,
      }),
    )
    await renderer.advanceFrames(2, 0.05)
    expect(ambianceFocus()).toEqual(host)
  } finally {
    useScene.setState(previousScene, true)
    await renderer.unmount()
  }
})

test('with a deep level shown the eye above the ground stays in the day, and the dive is the eye’s own', async () => {
  const previousScene = useScene.getState()
  withDeepStack()
  const { renderer, camera } = await mountLights()
  try {
    // The overview: the target is four storeys down, the eye is over the ground.
    camera.position.set(22, 12, 22)
    for (const index of [-4, -1, -3, -2, -4]) {
      await act(async () => showDeep(index))
      await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
      expect(useViewer.getState().eyeUnderGround).toBe(false)
      expect(ambianceNow()).toBe(0)
      expect(groundHoleOpenNow()).toBe(1)
    }
    // The person dives: only then the dark mode.
    camera.position.set(22, -10, 22)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(useViewer.getState().eyeUnderGround).toBe(true)
    expect(ambianceNow()).toBe(1)
  } finally {
    useScene.setState(previousScene, true)
    await renderer.unmount()
  }
})

// The walkthrough: the ground is solid, the rooms keep their light going down a stair, and only
// what is seen outside turns to earth.
test('in the walkthrough going down into a basement does not dive: no hole, no dark mode, the earth outside; leaving it returns the overview rule', async () => {
  const { renderer, scene, camera } = await mountLights()
  try {
    const ambient = ambientOf(scene)
    if (!ambient) throw new Error('the lights include an ambient light')
    const atGrade = ambient.intensity
    await act(async () => useViewer.setState({ ...BELOW_GRADE, walkthroughMode: true }))
    camera.position.set(0, 1.7, 0)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(groundHoleOpenNow()).toBe(0)
    expect(earthNow()).toBe(0)

    // Down the stair, under the ground: the earth eases in over the crossing, the rooms keep their
    // normal light.
    camera.position.set(0, -1.75, 0)
    await renderer.advanceFrames(4, 0.05)
    expect(earthNow()).toBeGreaterThan(0)
    expect(earthNow()).toBeLessThan(1)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(useViewer.getState().eyeUnderGround).toBe(true)
    expect(earthNow()).toBe(1)
    expect(undergroundEarthNode().value).toBe(1)
    expect(ambianceNow()).toBe(0)
    expect(useViewer.getState().ambianceActive).toBe(false)
    expect(ambient.intensity).toBe(atGrade)
    expect(groundHoleOpenNow()).toBe(0)

    // Leaving the walkthrough: the dark mode below, the hole above.
    await act(async () => useViewer.setState({ walkthroughMode: false }))
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(1)
    expect(earthNow()).toBe(1)
    camera.position.set(22, 12, 22)
    await renderer.advanceFrames(CROSSING_FRAMES, 0.05)
    expect(ambianceNow()).toBe(0)
    expect(earthNow()).toBe(0)
    expect(groundHoleOpenNow()).toBe(1)
  } finally {
    await renderer.unmount()
  }
})
