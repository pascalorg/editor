// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import type { Camera, DirectionalLight, HemisphereLight, Object3D } from 'three/webgpu'
import useViewer from '../../store/use-viewer'
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
afterEach(() => useViewer.setState(previous, true))

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
    expect(lightsOf(scene).directional).toHaveLength(before.directional.length)
  } finally {
    await renderer.unmount()
  }
})
