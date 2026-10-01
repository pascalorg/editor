import { expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  createSceneApi,
  emitter,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  resolveSurfacePlacement,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { events, type RootStore } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { resolveItemTransform } from '../item/floorplan'
import { restingNodePlanFrame } from '../shared/resting-surface-plan'
import {
  boxAsset as asset,
  CatalogMover,
  installMountedScene,
  LevelScene,
  boxRecipe as recipe,
  SceneSystems,
  settle,
} from './harness'

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })
type Mover = 'registry' | 'catalog'
installMountedScene()

function Scene({ mover, child }: { mover?: Mover; child?: AnyNode }) {
  const moving = useInteractionScope((s) => s.scope.kind === 'moving')
  return (
    <>
      <LevelScene level={level} />
      {moving &&
        child &&
        (mover === 'catalog' ? (
          <CatalogMover source={child as ItemNode} />
        ) : (
          <MoveRegistryNodeTool node={child} />
        ))}
      <SceneSystems />
    </>
  )
}
function seed(entries: AnyNode[], slab = false) {
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
    viewMode: '3d',
  })
  useEditor.getState().setSnappingMode('item', 'off')
  useViewer.setState({
    textures: false,
    showZones: false,
    showMeasurements: false,
    selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
  })
}
function world(id: AnyNodeId) {
  const o = sceneRegistry.nodes.get(id)!
  o.updateWorldMatrix(true, true)
  return o.getWorldPosition(new Vector3())
}
function plan(item: ItemNode) {
  return resolveItemTransform(item, {
    resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
  } as never)!
}
function genericHost(parentId = level.id) {
  const kind = 'plugin:column-audit'
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
      floorPlaced: { footprint: () => ({ dimensions: [2, 1, 2], rotation: [0, 0.6, 0] }) },
    },
    geometry: () => {
      const group = new Group()
      group.add(new Mesh(new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), new MeshBasicMaterial()))
      return group
    },
  } as never)
  return schema.parse({ parentId, position: [1, 0, -1], rotation: [0, 0.6, 0] }) as AnyNode
}
function pointerDispatcher(side = false) {
  const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
  const store = object.__r3f.root
  const manager = events(store)
  store.setState({ events: manager })
  const state = store.getState()
  state.setSize(1000, 1000)
  state.camera.position.set(...((side ? [0, 2, 5] : [1, 12, -1]) as [number, number, number]))
  state.camera.up.set(0, 0, -1)
  state.camera.lookAt(...((side ? [0, 0.4, 0] : [1, 0, -1]) as [number, number, number]))
  state.camera.updateMatrixWorld()
  state.raycaster.layers.enableAll()
  return (point: Vector3, phase: 'onPointerMove' | 'onPointerUp' = 'onPointerMove') => {
    state.scene.updateMatrixWorld(true)
    const ndc = point.clone().project(state.camera)
    const native = {
      offsetX: (ndc.x + 1) * 500,
      offsetY: (1 - ndc.y) * 500,
      pointerId: 1,
      button: 0,
      target: { setPointerCapture() {}, releasePointerCapture() {} },
    }
    return { native, dispatch: () => manager.handlers![phase](native as never) }
  }
}

async function paired(
  pointer: ReturnType<typeof pointerDispatcher>,
  point: Vector3,
  order: string,
  floor: [number, number, number] = [8, 0, 8],
) {
  const move = pointer(point)
  const grid = {
    position: floor,
    localPosition: floor,
    nativeEvent: { nativeEvent: move.native },
    stopPropagation() {},
  }
  await act(async () => {
    if (order === 'grid first') emitter.emit('grid:move', grid as never)
    move.dispatch()
    if (order === 'host first') emitter.emit('grid:move', grid as never)
  })
}
for (const mover of ['catalog', 'registry'] as const)
  for (const order of ['grid first', 'host first'])
    for (const refusal of ['cutout', 'occupied'])
      test(`${mover} ${refusal}: real R3F refusal owns the bubbled event, ${order}`, async () => {
        const column = ColumnNode.parse({
          parentId: level.id,
          position: [0, 0, 0],
          height: 0.8,
          radius: 0.2,
          capitalStyle: 'none',
          baseStyle: 'none',
        })
        const child =
          mover === 'catalog'
            ? ItemNode.parse({ asset, parentId: level.id, position: [-4, 0, -4] })
            : ProceduralItemNode.parse({ recipe, parentId: level.id, position: [-4, 0, -4] })
        let host: AnyNode
        const entries: AnyNode[] = [column, child]
        if (refusal === 'cutout') {
          host = CabinetNode.parse({
            parentId: column.id,
            position: [0.8, 0.8, 0],
            withCountertop: true,
            countertopThickness: 0.03,
          })
          entries.push(
            CabinetModuleNode.parse({
              parentId: host.id,
              withCountertop: false,
              width: 0.6,
              depth: 0.6,
              carcassHeight: 0.72,
              position: [0, 0.1, 0],
              stack: [{ id: 'sink', type: 'sink' }],
            }),
          )
        } else {
          host = ProceduralItemNode.parse({
            parentId: column.id,
            position: [0.8, 0.8, 0],
            recipe: {
              ...recipe,
              parts: [
                {
                  id: 'body',
                  label: 'Body',
                  count: 1,
                  shapes: [
                    {
                      id: 'box',
                      primitive: 'box',
                      size: [0.8, 0.2, 0.8],
                      position: [0, 0.1, 0],
                      slot: 'body',
                    },
                  ],
                },
              ],
              surfaces: [
                {
                  id: 'top',
                  label: 'Top',
                  position: [0, 0.2, 0],
                  rotation: [0, 0, 0],
                  size: [0.8, 0.8],
                },
              ],
            },
          })
          const occupant = ItemNode.parse({ parentId: host.id, asset, position: [0.075, 0, 0] })
          host.attachments[occupant.id] = 'top'
          entries.push(occupant)
        }
        entries.push(host)
        seed(entries)
        if (refusal === 'cutout') {
          useEditor.setState({ gridSnapStep: 1 })
          useEditor.getState().setSnappingMode('item', 'grid')
        }
        useEditor.getState().setMovingNode(child)
        const renderer = await create(<Scene mover={mover} child={child} />)
        const seen: string[] = []
        const observe = (e: { node: AnyNode }) => seen.push(e.node.id)
        emitter.on('node:move', observe)
        const provider = getSurfaceProvider(column),
          ancestor = spyOn(provider, 'resolveHit')
        try {
          await settle(renderer)
          let rejection: string | undefined
          resolveSurfacePlacement({
            host: useScene.getState().nodes[host.id]!,
            childKind: child.type,
            childId: child.id,
            childFootprint: { size: [0.1, 0.2, 0.1], rotationY: 0 },
            hit: { point: [0, refusal === 'cutout' ? 0.85 : 0.2, 0.02], normalWorldY: 1 },
            scene: createSceneApi(useScene),
            onReject: (r) => {
              rejection = r
            },
          })
          expect(rejection).toBe(refusal === 'cutout' ? 'surface-cutout' : 'surface-occupied')
          const pointer = pointerDispatcher()
          const point = sceneRegistry.nodes
            .get(host.id)!
            .localToWorld(
              new Vector3(
                refusal === 'cutout' ? 0.28 : 0,
                refusal === 'cutout' ? 0.85 : 0.2,
                refusal === 'cutout' ? 0.28 : 0.02,
              ),
            )
          await paired(pointer, point, order)
          await settle(renderer)
          await act(async () => pointer(point, 'onPointerUp').dispatch())
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('moving')
          expect(ancestor).not.toHaveBeenCalled()
          expect(seen).toContain(host.id)
          expect(seen).not.toContain(column.id)
        } finally {
          emitter.off('node:move', observe)
          ancestor.mockRestore()
          await renderer.unmount()
        }
      })
for (const order of ['grid first', 'host first'])
  test(`catalog generic side yields silently to the floor through R3F, ${order}`, async () => {
    const host = ColumnNode.parse({
      parentId: level.id,
      height: 0.8,
      radius: 0.2,
      capitalStyle: 'none',
      baseStyle: 'none',
    })
    const child = ItemNode.parse({ parentId: level.id, asset, position: [-4, 0, -4] })
    seed([host, child])
    useEditor.getState().setMovingNode(child)
    const renderer = await create(<Scene mover="catalog" child={child} />)
    const seen: string[] = []
    const observe = (e: { node: AnyNode }) => seen.push(e.node.id)
    emitter.on('node:move', observe)
    try {
      await settle(renderer)
      const pointer = pointerDispatcher(true)
      await paired(pointer, new Vector3(-4, 0, -4), order, [-4, 0, -4])
      await settle(renderer)
      const point = new Vector3(0, 0.4, 0.2)
      await paired(pointer, point, order)
      await settle(renderer)
      expect(seen).toContain(host.id)
      const draft = useScene.getState().nodes[child.id] as ItemNode
      expect(draft.parentId).toBe(level.id)
      expect(world(child.id).toArray()).toEqual([8, 0, 8])
      await act(async () => pointer(point, 'onPointerUp').dispatch())
      await settle(renderer)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
      expect((useScene.getState().nodes[child.id] as ItemNode).position).toEqual([8, 0, 8])
    } finally {
      emitter.off('node:move', observe)
      await renderer.unmount()
    }
  })
for (const [kind, rotation] of [
  ['duct-fitting', [Math.PI / 2, 0, 0]],
  ['pipe-fitting', [0, 0, Math.PI / 3]],
  ['plugin:column-audit', [0.4, 0.3, -0.2]],
] as const)
  test(`${kind}: live ancestor keeps pitch and roll, plan equals the mounted pose`, async () => {
    if (kind === 'plugin:column-audit') genericHost()
    const ancestor = nodeRegistry
      .get(kind)!
      .schema.parse({ parentId: level.id, position: [2, 0, 3], rotation }) as AnyNode
    const host = ProceduralItemNode.parse({ parentId: ancestor.id, recipe, position: [0, 1, 0] })
    const child = ItemNode.parse({ parentId: host.id, asset, position: [0, 0.9, 0] })
    seed([ancestor, host, child])
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const before = plan(child)
      const expected = world(child.id)
      expect(before.x).toBeCloseTo(expected.x, 8)
      expect(before.y).toBeCloseTo(expected.z, 8)
      await act(async () =>
        useLiveTransforms
          .getState()
          .set(ancestor.id, { position: [2, 0, 3], rotation: rotation[1] }),
      )
      await settle(renderer)
      const after = plan(child)
      expect(after).toEqual(before)
      expect(after.x).toBeCloseTo(world(child.id).x, 8)
      expect(after.y).toBeCloseTo(world(child.id).z, 8)
    } finally {
      await renderer.unmount()
    }
  })
for (const arrangement of ['catalog shelf column', 'catalog item plugin', 'generated shelf column'])
  test(`${arrangement}: arbitrary ancestor chain plan equals mounted 3D`, async () => {
    const root =
      arrangement === 'catalog item plugin'
        ? genericHost()
        : ColumnNode.parse({
            parentId: level.id,
            position: [5, 0, 3],
            rotation: Math.PI / 2,
            height: 0.8,
          })
    const middle =
      arrangement === 'catalog item plugin'
        ? ItemNode.parse({
            asset,
            parentId: root.id,
            position: [0.1, 1, 0.2],
            rotation: [0, 0.3, 0],
          })
        : ShelfNode.parse({ parentId: root.id, position: [0, 0.8, 0] })
    const child =
      arrangement === 'generated shelf column'
        ? ProceduralItemNode.parse({ recipe, parentId: middle.id, position: [0.2, 1, 0.1] })
        : ItemNode.parse({ asset, parentId: middle.id, position: [0.2, 1, 0.1] })
    seed([root, middle, child], true)
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const rendered = world(child.id)
      const pose =
        child.type === 'item'
          ? plan(child)
          : (() => {
              const f = restingNodePlanFrame(child, (id) => useScene.getState().nodes[id])
              return {
                x: f.position[0],
                y: f.position[2],
                rotation: Math.atan2(f.axes[2][0], f.axes[2][2]),
              }
            })()
      expect(pose.x).toBeCloseTo(rendered.x, 8)
      expect(pose.y).toBeCloseTo(rendered.z, 8)
      const matrix = sceneRegistry.nodes.get(child.id)!.matrixWorld.elements
      const renderedYaw = Math.atan2(matrix[8]!, matrix[10]!)
      expect(Math.sin(pose.rotation)).toBeCloseTo(Math.sin(renderedYaw), 8)
      expect(Math.cos(pose.rotation)).toBeCloseTo(Math.cos(renderedYaw), 8)
      if (arrangement !== 'catalog item plugin') {
        expect(pose.x).toBeCloseTo(5.1, 8)
        expect(pose.y).toBeCloseTo(2.8, 8)
      }
    } finally {
      await renderer.unmount()
    }
  })
for (const attachTo of ['wall', 'wall-side', 'ceiling'] as const)
  test(`level-parented ${attachTo} draft keeps the shared slab lift`, async () => {
    const child = ItemNode.parse({
      asset: { ...asset, attachTo },
      parentId: level.id,
      position: [0, 1, 0],
    })
    seed([child], true)
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      expect(sceneRegistry.nodes.get(child.id)).toBeDefined()
      expect(nodeLevelFrame(child.id, useScene.getState().nodes).position[1]).toBeCloseTo(1.4, 8)
    } finally {
      await renderer.unmount()
    }
  })
