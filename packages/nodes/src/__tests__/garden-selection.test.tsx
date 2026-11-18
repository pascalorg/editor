import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Inspector, SelectionManager, useEditor, useInteractionScope } from '@pascal-app/editor'
import { disposeObject3DResources, NodeRenderer, useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot, events, extend, type RootStore } from '@react-three/fiber'
import { Window as TestWindow } from 'happy-dom'
import { createRoot as createDomRoot } from 'react-dom/client'
import { Group, type Object3D, OrthographicCamera, type WebGLRenderer } from 'three'
import { hedgeDefinition } from '../hedge'
import { plantingDefinition } from '../planting'
import { rockDefinition } from '../rock'

extend({ Group })

const definitions = [hedgeDefinition, plantingDefinition, rockDefinition]
type GardenDefinition = (typeof definitions)[number]
type Phase = 'site' | 'building'
type GardenHarness = {
  store: RootStore
  canvas: HTMLCanvasElement
  inspector: HTMLElement
  node: AnyNode
}

function garden(definition: GardenDefinition) {
  const site = SiteNode.parse({ id: 'site_selection_garden' })
  const building = BuildingNode.parse({ id: 'building_selection_house', parentId: site.id })
  const level = LevelNode.parse({ id: 'level_selection_ground', parentId: building.id })
  const node = definition.schema.parse({
    ...definition.defaults(),
    id: `${definition.kind}_selection_garden`,
    parentId: site.id,
  })
  site.children = [building.id, node.id]
  building.children = [level.id]
  const nodes = Object.fromEntries([site, building, level, node].map((entry) => [entry.id, entry]))
  return { site, building, level, node, nodes }
}

function installDom() {
  const dom = new TestWindow({ width: 1200, height: 900 })
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return async () => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
    await dom.happyDOM.abort()
  }
}

function seedGarden(definition: GardenDefinition, phase: Phase) {
  const fixture = garden(definition)
  const { site, building, level, nodes } = fixture
  nodeRegistry._reset()
  // Icon discovery is remote decoration, not part of inspector selection.
  registerNode({ ...definition, presentation: { ...definition.presentation, icon: undefined } })
  useScene.setState({ nodes, rootNodeIds: [site.id], readOnly: false, installedPlugins: [] })
  useInteractionScope.getState().end()
  useEditor.setState({ phase, mode: 'select', tool: null, room: null, hoveredRoom: null })
  useViewer.setState({ cameraDragging: false, inputDragging: false, focusedUnitId: null })
  useViewer.getState().setSelection({
    buildingId: building.id,
    levelId: level.id,
    zoneId: null,
    selectedIds: [],
  })
  useViewer.getState().setHoveredId(null)
  return fixture
}

async function configureCanvas() {
  const canvas = Object.assign(new EventTarget(), {
    style: { cursor: '' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const camera = Object.assign(new OrthographicCamera(-5, 5, 5, -5, 0.1, 100), { manual: true })
  camera.position.set(0, 20, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  await root.configure({
    gl: {
      domElement: canvas,
      render() {},
      setSize() {},
      setPixelRatio() {},
    } as unknown as WebGLRenderer,
    camera,
    frameloop: 'never',
    dpr: 1,
    size: { width: 1000, height: 1000, top: 0, left: 0 },
  })
  return { root, canvas }
}

function injectGeometry(definition: GardenDefinition, fixture: ReturnType<typeof garden>) {
  const { node, site, nodes } = fixture
  const rendered = sceneRegistry.nodes.get(node.id)
  if (!rendered) throw new Error(`Missing ${node.type} renderer`)
  const buildGeometry = definition.geometry
  if (!buildGeometry) throw new Error(`Missing ${node.type} geometry builder`)
  // Supply the public geometry builder's real meshes without a WebGL/frame system.
  const geometry = buildGeometry(node as never, {
    resolve: <N = AnyNode>(id: AnyNode['id']) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
    parent: site,
    sceneNodes: nodes,
  })
  rendered.add(geometry)
  return geometry
}

async function withGarden(
  definition: GardenDefinition,
  phase: Phase,
  run: (harness: GardenHarness) => Promise<void>,
) {
  const restoreRegistry = nodeRegistry._snapshot()
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const previousScope = useInteractionScope.getState()
  const restoreDom = installDom()
  const { root, canvas } = await configureCanvas()
  const inspector = document.createElement('div')
  document.body.append(inspector)
  const inspectorRoot = createDomRoot(inspector)
  let geometry: Object3D | undefined
  try {
    const fixture = seedGarden(definition, phase)
    await act(async () => {
      root.render(
        <>
          <SelectionManager />
          <NodeRenderer nodeId={fixture.node.id} />
        </>,
      )
      inspectorRoot.render(<Inspector />)
    })
    geometry = injectGeometry(definition, fixture)
    const store = _roots.get(canvas)?.store
    if (!store) throw new Error('Missing R3F root')
    store.getState().setEvents(events(store))
    store.getState().scene.updateMatrixWorld(true)
    await run({ store, canvas, inspector, node: fixture.node })
  } finally {
    await act(async () => {
      inspectorRoot.unmount()
      root.render(null)
    })
    if (geometry) disposeObject3DResources(geometry)
    _roots.delete(canvas)
    restoreRegistry()
    useScene.setState(previousScene, true)
    useViewer.setState(previousViewer, true)
    useEditor.setState(previousEditor, true)
    useInteractionScope.setState(previousScope, true)
    await restoreDom()
  }
}

async function pointer(
  { store, canvas }: GardenHarness,
  type: 'onPointerMove' | 'onPointerDown' | 'onPointerUp',
  x = 500,
  y = 500,
) {
  const handler = store.getState().events.handlers?.[type]
  if (!handler) throw new Error(`Missing ${type} handler`)
  await act(async () => {
    handler({
      offsetX: x,
      offsetY: y,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      target: canvas,
      type,
    } as unknown as PointerEvent)
  })
}

function intersections({ store }: GardenHarness) {
  const { raycaster, internal } = store.getState()
  return raycaster.intersectObjects(internal.interaction, true)
}

for (const definition of definitions) {
  test(`site: ${definition.kind} selects and shows its inspector without an active building or level`, async () =>
    withGarden(definition, 'site', async (harness) => {
      await act(async () => useViewer.getState().resetSelection())
      await pointer(harness, 'onPointerMove')
      expect(useViewer.getState().hoveredId).toBe(harness.node.id)
      await pointer(harness, 'onPointerDown')
      await pointer(harness, 'onPointerUp')
      expect(useViewer.getState().selection).toMatchObject({
        buildingId: null,
        levelId: null,
        selectedIds: [harness.node.id],
      })
      expect(useEditor.getState().phase).toBe('site')
      expect(harness.inspector.querySelector('h2')?.textContent).toBe(
        definition.presentation?.label ?? definition.kind,
      )
    }))

  for (const phase of ['site', 'building'] as const) {
    test(`${phase}: hovering Site-owned ${definition.kind} geometry highlights it with a house level active`, async () =>
      withGarden(definition, phase, async (harness) => {
        await pointer(harness, 'onPointerMove')
        expect(intersections(harness).length).toBeGreaterThan(0)
        expect(useViewer.getState().hoveredId).toBe(harness.node.id)
      }))

    test(`${phase}: clicking Site-owned ${definition.kind} geometry selects it and shows its inspector`, async () =>
      withGarden(definition, phase, async (harness) => {
        await pointer(harness, 'onPointerDown')
        await pointer(harness, 'onPointerUp')
        expect(useViewer.getState().selection.selectedIds).toEqual([harness.node.id])
        expect(useEditor.getState().phase).toBe(phase)
        expect(harness.inspector.querySelector('h2')?.textContent).toBe(
          definition.presentation?.label ?? definition.kind,
        )
      }))

    test(`${phase}: empty air beside Site-owned ${definition.kind} is not a hit`, async () =>
      withGarden(definition, phase, async (harness) => {
        await pointer(harness, 'onPointerMove', 950, 950)
        expect(intersections(harness)).toHaveLength(0)
        await pointer(harness, 'onPointerDown', 950, 950)
        await pointer(harness, 'onPointerUp', 950, 950)
        expect(useViewer.getState().selection.selectedIds).toEqual([])
        expect(useViewer.getState().hoveredId).toBeNull()
        expect(harness.inspector.querySelector('h2')).toBeNull()
      }))
  }
}
