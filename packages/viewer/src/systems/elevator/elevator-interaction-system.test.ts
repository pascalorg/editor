import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { _roots, createRoot, type Instance } from '@react-three/fiber'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three'
import { createPascalPointerEvents, type ViewerBreadcrumb } from '../../lib/pointer-events'
import { collectElevatorButtons } from './elevator-interaction-system'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

/** A wall caught mid paint preview: its groups draw palette entry 4 of a one-entry array. */
function tornWall() {
  const torn = new Mesh(new BoxGeometry(2, 2, 0.2), [new MeshBasicMaterial()])
  torn.geometry.clearGroups()
  torn.geometry.addGroup(0, Number.POSITIVE_INFINITY, 4)
  torn.position.z = 1
  return torn
}

function elevatorButton() {
  const panel = new Group()
  const button = new Mesh(new BoxGeometry(0.1, 0.1, 0.05), new MeshBasicMaterial())
  panel.userData.elevatorButton = { action: 'open-door', disabled: false, elevatorId: 'e' }
  panel.add(button)
  return { panel, button }
}

/**
 * The viewer's pointer manager on a bare R3F root, its camera looking down -z
 * at the scene centre, with `onPointerMove` handlers on `roots` in order.
 */
async function pointerRoot(roots: Object3D[], onBreadcrumb: (b: ViewerBreadcrumb) => void) {
  const noop = () => {}
  const canvas = {
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
  } as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  cleanups.push(() => _roots.delete(canvas))
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.z = 10
  camera.updateMatrixWorld()
  await root.configure({
    gl: { render: noop, setSize: noop, setPixelRatio: noop } as never,
    camera,
    events: (store) => createPascalPointerEvents(store, onBreadcrumb),
    frameloop: 'never',
    dpr: 1,
    size: { width: 100, height: 100, top: 0, left: 0 },
  })
  const store = _roots.get(canvas)!.store
  const state = store.getState()
  state.raycaster = new Raycaster()
  const moved: Object3D[] = []
  for (const object of roots) {
    state.scene.add(object)
    Object.assign(object, {
      __r3f: {
        root: store,
        type: 'primitive',
        parent: null,
        children: [],
        props: { object },
        object,
        eventCount: 1,
        handlers: { onPointerMove: (event: { object: Object3D }) => moved.push(event.object) },
        isHidden: false,
      } satisfies Partial<Instance<Object3D>>,
    })
    state.internal.interaction.push(object)
  }
  state.scene.updateMatrixWorld(true)
  const move = () =>
    state.events.handlers!.onPointerMove({
      type: 'pointermove',
      offsetX: 50,
      offsetY: 50,
      pointerId: 1,
      buttons: 0,
      target: canvas,
    } as unknown as PointerEvent)
  return { move, moved }
}

describe('elevator buttons', () => {
  test('a click raycasts only the buttons, past a mesh whose groups have no material', () => {
    const scene = new Scene()
    // Three throws on any raycast of the torn wall in front of the button.
    const torn = tornWall()
    const { panel, button } = elevatorButton()
    scene.add(torn, new Group().add(panel))
    scene.updateMatrixWorld(true)

    const buttons = collectElevatorButtons(scene)
    expect(buttons).toEqual([panel])
    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
    expect(() => raycaster.intersectObjects(scene.children, true)).toThrow()
    expect(raycaster.intersectObjects(buttons, true).map((hit) => hit.object)).toContain(button)
  })

  for (const path of ['cached', 'stock'] as const)
    test(`a pointer move over the same scene skips the torn wall on the ${path} path and records it`, async () => {
      const torn = tornWall()
      const { panel, button } = elevatorButton()
      const wallRoot = new Group().add(torn, panel)
      sceneRegistry.nodes.set('wall_torn', torn)
      const nodes = useScene.getState().nodes
      useScene.setState({
        nodes: { ...nodes, wall_torn: { id: 'wall_torn', type: 'wall' } } as never,
      })
      cleanups.push(() => {
        sceneRegistry.nodes.delete('wall_torn')
        useScene.setState({ nodes })
      })

      const roots: Object3D[] = [wallRoot]
      if (path === 'stock') {
        // An untagged two-argument raycast sends the whole event down three's own recursion.
        const handle = new Mesh()
        handle.raycast = function untaggedRaycast(_raycaster, _hits) {}
        roots.unshift(handle)
      }
      const breadcrumbs: ViewerBreadcrumb[] = []
      const { move, moved } = await pointerRoot(roots, (b) => breadcrumbs.push(b))

      expect(() => move()).not.toThrow()
      expect(() => move()).not.toThrow()
      expect(moved).toEqual([button, button])
      expect(breadcrumbs).toEqual([
        {
          category: 'raycast_invalid_material',
          message: 'Pointer raycast skipped a mesh whose geometry groups have no material',
          level: 'warning',
          data: { nodeType: 'wall', nodeId: 'wall_torn', objectName: '' },
        },
      ])
    })
})
