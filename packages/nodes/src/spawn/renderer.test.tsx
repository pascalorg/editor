import { expect, test } from 'bun:test'
import { SiteNode, SpawnNode, sceneRegistry, useScene } from '@pascal-app/core'
import { LiveWalkthroughController, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import SpawnRenderer from './renderer'

test('the viewer hides the editing marker but walkthrough still starts at its registered world pose', async () => {
  const previousViewer = useViewer.getState()
  const previousScene = useScene.getState()
  const globals = new Map(
    ['document', 'window', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  )
  const documentEvents = Object.assign(new EventTarget(), {
    activeElement: null,
    pointerLockElement: null,
    body: { style: {} },
    querySelector: () => null,
    exitPointerLock: () => {},
  })
  Object.assign(globalThis, {
    document: documentEvents,
    window: Object.assign(new EventTarget(), {
      location: { search: '' },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  })
  const spawn = SpawnNode.parse({ id: 'spawn_viewer', position: [3, 2, -4], rotation: 0.7 })
  const site = SiteNode.parse({ id: 'site_spawn' })
  const root = new Group()
  root.position.x = 10
  sceneRegistry.nodes.set(site.id, root)
  sceneRegistry.byType.site!.add(site.id)
  useScene.setState({ nodes: { [spawn.id]: spawn, [site.id]: site }, rootNodeIds: [site.id] })
  useViewer.setState({
    renderContext: 'viewer',
    walkthroughMode: false,
    walkthroughMovement: 'walk',
    walkthroughInputMode: 'touch',
  })
  const camera = new PerspectiveCamera()
  let renderer: Awaited<ReturnType<typeof create>> | undefined
  try {
    renderer = await create(
      <>
        <primitive object={root}>
          <SpawnRenderer node={spawn} />
        </primitive>
        <LiveWalkthroughController />
      </>,
      {
        camera,
        beforeReturn: (canvas) => {
          Object.assign(canvas, {
            contains: () => false,
            hasAttribute: () => true,
            focus: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
          })
        },
      },
    )
    const object = sceneRegistry.nodes.get(spawn.id)!
    expect(object).toBeDefined()
    expect(object.visible).toBe(false)
    expect(object.getWorldPosition(new Vector3()).toArray()).toEqual([13, 2, -4])
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    await renderer.advanceFrames(1, 1 / 60)
    expect(camera.position.x).toBeCloseTo(13)
    expect(camera.position.z).toBeCloseTo(-4)
    expect(camera.position.y).toBeGreaterThan(2)
    expect(camera.rotation.y).toBeCloseTo(0.7)
    expect(object.visible).toBe(false)
    await act(async () => {
      useViewer.getState().setWalkthroughMode(false)
      useViewer.getState().setRenderContext('editor')
    })
    expect(object.visible).toBe(true)
    await act(async () => useViewer.getState().setRenderContext('viewer'))
    expect(object.visible).toBe(false)
    expect(sceneRegistry.nodes.get(spawn.id)).toBe(object)
  } finally {
    await renderer?.unmount()
    useViewer.setState(previousViewer, true)
    useScene.setState(previousScene)
    sceneRegistry.clear()
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
