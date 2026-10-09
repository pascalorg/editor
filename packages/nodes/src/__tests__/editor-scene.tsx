/**
 * Editor interaction helpers on top of the mounted-scene harness: a scene with the real menus,
 * movers, keyboard and grid events, plus pointer, key and menu drivers. Used by the duplicate and
 * host-lifecycle suites.
 */
import { beforeEach, expect } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import {
  MoveRegistryNodeTool,
  sceneLayout,
  useEditor,
  type VisibleScene,
  visibleScene,
} from '@pascal-app/editor'
import { useViewer, WallSystem } from '@pascal-app/viewer'
import { events, type RootStore, useThree } from '@react-three/fiber'
import { act, type create } from '@react-three/test-renderer'
import { Children, isValidElement, type ReactNode } from 'react'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { FloatingActionMenu } from '../../../editor/src/components/editor/floating-action-menu'
import { NodeActionMenu } from '../../../editor/src/components/editor/node-action-menu'
import { FloorplanRegistryActionMenu } from '../../../editor/src/components/editor-2d/floorplan-registry-action-menu'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import { useGridEvents } from '../../../editor/src/hooks/use-grid-events'
import { useKeyboard } from '../../../editor/src/hooks/use-keyboard'
import useInteractionScope, {
  getMovingNode,
  useMovingNode,
} from '../../../editor/src/store/use-interaction-scope'
import ItemTool from '../item/tool'
import {
  boxAsset as asset,
  CatalogMover,
  installMountedScene,
  LevelScene,
  boxRecipe as recipe,
  SceneSystems,
  settle,
} from './harness'

export const site = SiteNode.parse({})
export const building = BuildingNode.parse({ parentId: site.id })
export const level = LevelNode.parse({ parentId: building.id })
export type Mover = 'registry' | 'catalog'
/** `<Html>` labels and portals rendered so far; menus are found here. */
let htmlChildren: ReactNode[] = []

/** The harness plus captured `<Html>`/portal children and the floor-plan SVG the overlays measure. */
export function installEditorScene() {
  installMountedScene({
    html: (props) => {
      htmlChildren.push(props.children)
      return null
    },
    portal: (children) => htmlChildren.push(children),
  })
  beforeEach(() => {
    htmlChildren = []
    // The floor-plan move overlay measures its SVG scene.
    const svg = {
      getBoundingClientRect: () => ({ left: -100, top: -100, right: 100, bottom: 100 }),
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y }
        },
      }),
    }
    Object.assign(document, {
      createElementNS: () => ({ setAttribute() {}, remove() {} }),
      querySelector: () => ({
        appendChild() {},
        ownerSVGElement: svg,
        getScreenCTM: () => ({ inverse: () => ({}) }),
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }),
      }),
    })
  })
}

export function Grid() {
  const canvas = useThree((s) => s.gl.domElement)
  if (!(canvas as any).__native) {
    const target = Object.assign(new EventTarget(), {
      setPointerCapture() {},
      releasePointerCapture() {},
    })
    Object.assign(canvas, {
      __native: target,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    })
  }
  useGridEvents(0)
  return null
}
export function Scene({
  mover,
  child,
  fresh = false,
  menu = false,
  panes,
}: {
  mover?: Mover
  child?: AnyNode
  fresh?: boolean
  menu?: boolean
  panes?: { plan: boolean; spatial: boolean }
}) {
  useKeyboard({})
  const plan = useEditor((s) => visibleScene(s) === '2d')
  const activeNode = useMovingNode()
  const source = child ?? activeNode
  const moving = useInteractionScope((s) => s.scope.kind === 'moving' || s.scope.kind === 'placing')
  const armed = useEditor((s) => s.mode === 'build' && s.tool === 'item')
  return (
    <>
      <LevelScene level={level} />
      <Grid />
      {menu && (plan ? <FloorplanRegistryActionMenu /> : <FloatingActionMenu />)}
      {(panes?.plan ?? plan) && moving && <FloorplanRegistryMoveOverlay />}
      {fresh && armed && <ItemTool />}
      {moving &&
        (panes?.spatial ?? !plan) &&
        source &&
        (source.type === 'item' ? (
          <CatalogMover source={source as ItemNode} />
        ) : (
          <MoveRegistryNodeTool node={source} />
        ))}
      <SceneSystems />
      <WallSystem />
    </>
  )
}
export function seed(entries: AnyNode[], slab = false) {
  const support = SlabNode.parse({
    parentId: level.id,
    elevation: 0.4,
    polygon: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
  })
  const nodes = Object.fromEntries(
    [site, building, level, ...entries, ...(slab ? [support] : [])].map((n) => [
      n.id,
      { ...n, children: [] },
    ]),
  ) as Record<AnyNodeId, AnyNode>
  for (const n of Object.values(nodes))
    if (n.parentId) (nodes[n.parentId] as AnyNode & { children: string[] })?.children?.push(n.id)
  useScene.setState({
    nodes,
    rootNodeIds: [site.id],
    dirtyNodes: new Set(entries.map((n) => n.id)),
    readOnly: false,
    materials: {},
    collections: {},
    installedPlugins: [],
  })
  if (slab) spatialGridManager.handleNodeCreated(support, level.id)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().pause()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'item',
    movingNodeOrigin: '3d',
    placementDragMode: false,
    isFloorplanHovered: false,
    viewLayouts: {},
  })
  useEditor.getState().setSnappingMode('item', 'off')
  useEditor.getState().setContinuation('point', 'single')
  useViewer.setState({
    textures: false,
    cameraDragging: false,
    inputDragging: false,
    showZones: false,
    showMeasurements: false,
    selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
  })
}
export function world(id: AnyNodeId) {
  const o = sceneRegistry.nodes.get(id)!
  o.updateWorldMatrix(true, true)
  return o.getWorldPosition(new Vector3())
}
export function pointerDispatcher(side = false) {
  const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
  const store = object.__r3f.root
  const manager = events(store)
  store.setState({ events: manager })
  const state = store.getState()
  state.setSize(1000, 1000)
  state.camera.position.set(...((side ? [0, 1.2, 5] : [0, 10, 0]) as [number, number, number]))
  state.camera.up.set(0, 0, -1)
  state.camera.lookAt(0, side ? 0.4 : 0, 0)
  state.camera.updateMatrixWorld()
  state.raycaster.layers.enableAll()
  const ray = (point: Vector3) => {
    state.scene.updateMatrixWorld(true)
    const ndc = point.clone().project(state.camera)
    const cast = new Raycaster()
    cast.layers.enableAll()
    cast.setFromCamera(new Vector2(ndc.x, ndc.y), state.camera)
    return { ndc, cast }
  }
  const dispatch = (point: Vector3, order: string, click = false) => {
    const { ndc } = ray(point)
    const type = click ? 'pointerup' : 'pointermove'
    const native = Object.assign(new Event(type), {
      offsetX: (ndc.x + 1) * 500,
      offsetY: (1 - ndc.y) * 500,
      clientX: (ndc.x + 1) * 500,
      clientY: (1 - ndc.y) * 500,
      pointerId: 1,
      button: 0,
    })
    const grid = () => state.gl.domElement.dispatchEvent(native)
    const host = () => manager.handlers![click ? 'onPointerUp' : 'onPointerMove'](native as never)
    if (order === 'grid first') {
      grid()
      host()
    } else {
      host()
      grid()
    }
    if (click)
      state.gl.domElement.dispatchEvent(
        Object.assign(new Event('click'), {
          clientX: native.clientX,
          clientY: native.clientY,
          button: 0,
        }),
      )
  }
  return {
    ray,
    send: (point: Vector3, order: string, click = false) =>
      act(async () => dispatch(point, order, click)),
    // One input frame coalesces grid dispatch before its zero-delay task runs.
    sendFrame: (points: Vector3[], order: string) =>
      act(async () => {
        for (const point of points) dispatch(point, order)
      }),
  }
}
export function menuAction(
  action: 'onDuplicate' | 'onMove' = 'onDuplicate',
): ((event: { stopPropagation(): void }) => void) | undefined {
  const search = (value: ReactNode): any => {
    for (const element of Children.toArray(value)) {
      if (!isValidElement(element)) continue
      if (element.type === NodeActionMenu) return (element.props as any)[action]
      const child = search((element.props as any).children)
      if (child) return child
    }
  }
  return htmlChildren.map(search).filter(Boolean).at(-1)
}
export function genericHost(declared = false) {
  const kind = 'plugin:browser-host'
  const schema = nodeRegistry
    .get('shelf')!
    .schema.extend({ id: objectId(kind), type: nodeType(kind) })
  registerNode({
    kind,
    schema,
    schemaVersion: 1,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      ...(declared
        ? {
            surfaces: {
              hosting: {
                childFrame: 'host-local',
                resolveHit: (_host: AnyNode, hit: { normalWorldY: number }) =>
                  hit.normalWorldY >= 0.75
                    ? {
                        id: 'declared-top',
                        position: [0, 1, 0],
                        normal: [0, 1, 0],
                        region: { kind: 'rect', size: [0.5, 0.5] },
                      }
                    : null,
              },
            },
          }
        : {}),
      selectable: { hitVolume: 'bbox' },
      movable: { axes: ['x', 'z'] },
      duplicable: true,
      deletable: true,
      floorPlaced: { footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }) },
    },
    geometry: () => {
      const group = new Group()
      group.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial()))
      return group
    },
  } as never)
  return schema.parse({ parentId: level.id }) as AnyNode
}

export function snapshot() {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return JSON.stringify({ nodes, rootNodeIds, collections, materials, installedPlugins })
}
export async function duplicate(
  renderer: Awaited<ReturnType<typeof create>>,
  firstFrame?: () => void,
) {
  await settle(renderer)
  const callback = menuAction()
  expect(callback).toBeDefined()
  await act(async () => callback!({ stopPropagation() {} }))
  if (firstFrame) {
    await act(async () => renderer.advanceFrames(1, 1 / 60))
    firstFrame()
  }
  await settle(renderer)
  return getMovingNode()!
}
export async function key(key: string) {
  await act(async () =>
    window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { key, code: key }),
    ),
  )
}
export async function planPointer(x: number, z: number, click = false) {
  await act(async () =>
    window.dispatchEvent(
      Object.assign(new Event(click ? 'pointerup' : 'pointermove'), {
        clientX: x,
        clientY: z,
        button: 0,
      }),
    ),
  )
}
export function select(root: AnyNode, view = '3d') {
  useEditor.setState({
    mode: 'select',
    tool: null,
    viewLayouts: { edit: sceneLayout(view as VisibleScene) },
    isFloorplanHovered: view === '2d',
  })
  useViewer.getState().setSelection({ selectedIds: [root.id] })
  useScene.temporal.getState().resume()
}
export function namedFixture(childless: boolean) {
  const host = ProceduralItemNode.parse({
    parentId: level.id,
    recipe: {
      ...recipe,
      parts: [
        {
          ...recipe.parts[0]!,
          shapes: [{ ...recipe.parts[0]!.shapes[0]!, size: [4, 0.2, 4], position: [0, 1.9, 0] }],
        },
      ],
      surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [4, 4] }],
    },
  })
  const root = ItemNode.parse({ parentId: host.id, asset, position: [-1, 0, 0] })
  host.attachments[root.id] = 'top'
  const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
  const other = ProceduralItemNode.parse({
    ...host,
    id: 'procedural-item_other',
    position: [6, 0, 0],
    attachments: {},
  })
  seed([host, root, ...(childless ? [] : [leaf]), other])
  return { host, root, leaf, other }
}
export function lifecycleFixture(kind: string, childless: boolean, named = true) {
  const fixture = namedFixture(true)
  const root =
    kind === 'item'
      ? fixture.root
      : kind === 'shelf'
        ? ShelfNode.parse({ parentId: level.id, position: [-1, 0, 0], width: 0.5, depth: 0.3 })
        : ProceduralItemNode.parse({ parentId: fixture.host.id, position: [-1, 0, 0], recipe })
  if (!named) root.parentId = level.id
  fixture.host.attachments = kind === 'shelf' || !named ? {} : { [root.id]: 'top' }
  if (kind === 'shelf' || !named) fixture.host.position = [20, 0, 0]
  const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
  seed([fixture.host, root, ...(childless ? [] : [leaf])])
  return { root, host: fixture.host }
}
export function genericPlanDOM() {
  const scene = document.querySelector('[data-floorplan-scene]')!
  const element = () => ({
    style: {},
    setAttribute() {},
    removeAttribute() {},
    remove() {},
    getBBox: () => ({ x: -0.5, y: -0.3, width: 1, height: 0.6 }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }),
  })
  Object.assign(scene, {
    querySelector: () => element(),
    querySelectorAll: () => [],
    appendChild() {},
  })
  Object.assign(document, { querySelector: () => scene, createElementNS: element })
  Object.defineProperty(globalThis, 'DOMRect', {
    configurable: true,
    value: class {
      constructor(
        public x: number,
        public y: number,
        public width: number,
        public height: number,
      ) {}
    },
  })
}
export function interactionFixture(kind: string) {
  if (kind !== 'cabinet') return lifecycleFixture(kind, false)
  genericPlanDOM()
  const root = CabinetNode.parse({
    ...nodeRegistry.get('cabinet')!.defaults(),
    parentId: level.id,
  })
  const child = CabinetModuleNode.parse({
    ...nodeRegistry.get('cabinet-module')!.defaults(),
    parentId: root.id,
  })
  seed([root, child])
  return { root }
}
export const panesFor = (view: string) => ({ plan: view !== '3d', spatial: view !== '2d' })
