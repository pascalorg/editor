import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AssetInput,
  BlockNode,
  BuildingNode,
  createBoxBlockTopology,
  emitter,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useDraftNode, usePlacementCoordinator } from '@pascal-app/editor'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { Children, cloneElement, isValidElement, type ReactNode, useRef } from 'react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { getInitialState } from '../item/move-tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other suites replace production renderers with process-global mocks.
if (process.env.PASCAL_BLOCK_BLINK_ISOLATED !== '1') {
  test('block face blink with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/block-face-blink.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_BLOCK_BLINK_ISOLATED: '1' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    console.log(stdout, stderr)
    expect(code).toBe(0)
  }, 120_000)
} else {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id })
  let savedScene: ReturnType<typeof useScene.getState>
  let savedEditor: ReturnType<typeof useEditor.getState>
  let savedViewer: ReturnType<typeof useViewer.getState>
  let savedScope: ReturnType<typeof useInteractionScope.getState>
  let restoreRegistry: () => void
  let restoreGlobals: () => void
  let loadModel: ReturnType<typeof spyOn>

  beforeEach(() => {
    savedScene = useScene.getState()
    savedEditor = useEditor.getState()
    savedViewer = useViewer.getState()
    savedScope = useInteractionScope.getState()
    const names = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
    restoreGlobals = () =>
      names.forEach((name, i) => {
        const descriptor = descriptors[i]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      })
    globalThis.window = new EventTarget() as Window & typeof globalThis
    globalThis.document = {
      body: { style: { cursor: '' } },
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected DOM element: ${tag}`)
        const context = new Proxy(
          {},
          {
            get: (_target, key) =>
              key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
          },
        )
        return { width: 0, height: 0, getContext: () => context }
      },
    } as unknown as Document
    getDefaultPanelMaterial()
    Reflect.deleteProperty(globalThis.document, 'createElement')
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    loadModel = spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      const scene = new Group()
      scene.add(
        new Mesh(new BoxGeometry(0.1, 0.2, 0.1).translate(0, 0.1, 0), new MeshBasicMaterial()),
      )
      onLoad({
        scene,
        scenes: [scene],
        animations: [],
        cameras: [],
        asset: { version: '2.0' },
        parser: {},
      } as never)
    })
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    for (const def of builtinPlugin.nodes!) registerNode(def)
  })
  afterEach(() => {
    loadModel.mockRestore()
    sceneRegistry.nodes.clear()
    spatialGridManager.clear()
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    useScene.setState(savedScene)
    useEditor.setState(savedEditor)
    useViewer.setState(savedViewer)
    useInteractionScope.setState(savedScope)
    restoreRegistry()
    restoreGlobals()
  })

  function withoutLabels(element: ReactNode): ReactNode {
    if (!isValidElement<{ children?: ReactNode }>(element)) return element
    if (element.type === Html) return null
    return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
  }
  function Placement({ asset, source }: { asset: AssetInput; source?: ItemNode }) {
    const draftNode = useDraftNode()
    return withoutLabels(
      usePlacementCoordinator({
        asset,
        draftNode,
        initialState: source ? getInitialState(source) : undefined,
        initDraft: (position) => {
          if (source) {
            draftNode.adopt(source)
            position.set(...source.position)
          } else if (!asset.attachTo) draftNode.create(position, asset)
        },
        onCommitted: () => false,
      }),
    )
  }
  function Scene({ asset, source }: { asset: AssetInput; source?: ItemNode }) {
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const ref = useRef<Group>(null!)
    const buildingRef = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    useRegistry(building.id, 'building', buildingRef)
    return (
      <>
        <group ref={buildingRef}>
          <group ref={ref}>
            {children.map((id) => (
              <NodeRenderer key={id} nodeId={id} />
            ))}
          </group>
        </group>
        <Placement asset={asset} source={source} />
        <FloorElevationSystem />
        <ItemSystem />
        <GeometrySystem />
      </>
    )
  }
  async function settle(renderer: Awaited<ReturnType<typeof create>>) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
  }
  for (const order of ['grid first', 'host first'])
    for (const moving of [false, true])
      for (const side of [false, true])
        for (const rotation of [0, Math.PI / 6])
          test(`${moving ? 'move' : 'fresh'} ${side ? 'side' : 'top'} face stays mounted, ${rotation}, ${order}`, async () => {
            const asset: AssetInput = {
              id: 'blink-box',
              name: 'Blink box',
              category: 'decor',
              thumbnail: '',
              src: '/block-blink.glb',
              dimensions: [0.2, 0.3, 0.2],
              ...(side ? { attachTo: 'wall' as const } : {}),
            }
            const host = BlockNode.parse({
              parentId: level.id,
              topology: createBoxBlockTopology(1.5, 1.5, 1.5),
              rotation,
            })
            const faceId = side ? 'f-back' : 'f-top'
            const source = moving
              ? ItemNode.parse({
                  asset,
                  parentId: host.id,
                  blockFaceId: faceId,
                  position: [0, 0, 0],
                  rotation: side ? [0, 0, 0] : [Math.PI / 2, 0, 0],
                })
              : undefined
            useScene.setState({
              nodes: {
                [site.id]: { ...site, children: [building.id] },
                [building.id]: { ...building, children: [level.id] },
                [level.id]: { ...level, children: [host.id] },
                [host.id]: { ...host, children: source ? [source.id] : [] },
                ...(source ? { [source.id]: source } : {}),
              },
              rootNodeIds: [site.id],
              dirtyNodes: new Set(),
              readOnly: false,
              materials: {},
              collections: {},
              installedPlugins: [],
            })
            useScene.temporal.getState().pause()
            useEditor.setState({
              mode: 'build',
              tool: 'item',
              viewMode: '3d',
              movingNodeOrigin: '3d',
              placementDragMode: false,
            })
            useEditor.getState().setSnappingMode('item', 'off')
            useViewer.setState({
              textures: false,
              showZones: false,
              showMeasurements: false,
              selection: {
                buildingId: building.id,
                levelId: level.id,
                zoneId: null,
                selectedIds: [],
              },
            })
            const renderer = await create(<Scene asset={asset} source={source} />)
            try {
              await settle(renderer)
              const group = sceneRegistry.nodes.get(host.id)!
              const body = () => group.children.find((o) => o.name === 'block-body') as Mesh
              const move = async (i: number, targetFace = faceId) => {
                const object = body()
                const range = object.geometry.userData.blockFaces.find(
                  (r: { faceId: string }) => r.faceId === targetFace,
                )
                const localPosition: [number, number, number] =
                  targetFace === 'f-right'
                    ? [0.75, 0.8, -0.2 + i * 0.02]
                    : side
                      ? [-0.2 + i * 0.02, 0.8, 0.75]
                      : [-0.2 + i * 0.02, 1.5, 0]
                const position = object.localToWorld(new Vector3(...localPosition)).toArray()
                const nativeEvent = {}
                const event = {
                  node: useScene.getState().nodes[host.id],
                  object,
                  faceIndex: range.start / 3,
                  localPosition,
                  position,
                  nativeEvent: { nativeEvent },
                  stopPropagation() {},
                }
                const grid = () =>
                  emitter.emit('grid:move', {
                    ...event,
                    position: [position[0], 0, position[2]],
                    localPosition: [position[0], 0, position[2]],
                  } as never)
                const hit = () => {
                  if (i === 0) {
                    if (source) emitter.emit('node:leave', { ...event, node: source } as never)
                    emitter.emit('block:enter', event as never)
                    emitter.emit('node:enter', event as never)
                  }
                  emitter.emit('block:move', event as never)
                  emitter.emit('node:move', event as never)
                }
                await act(async () => {
                  if (order === 'grid first') {
                    grid()
                    hit()
                  } else {
                    hit()
                    grid()
                  }
                })
                await settle(renderer)
              }
              const initialHostMesh = body().uuid
              await move(0)
              expect(body().uuid).toBe(initialHostMesh)
              const item = Object.values(useScene.getState().nodes).find(
                (n) => n.type === 'item',
              ) as ItemNode
              const mesh = sceneRegistry.nodes.get(item.id)!
              const wrapper = mesh.parent
              const geometry = body().geometry
              const hostMesh = body()
              for (let i = 1; i <= 10; i++) {
                await move(i)
                expect(body()).toBe(hostMesh)
                expect(body().geometry).toBe(geometry)
                expect(sceneRegistry.nodes.get(item.id)).toBe(mesh)
                expect(mesh.parent).toBe(wrapper)
                expect(mesh.visible).toBe(true)
                const stored = useScene.getState().nodes[item.id] as ItemNode
                expect(stored.parentId).toBe(host.id)
                expect(
                  useLiveNodeOverrides.getState().get(item.id)?.blockFaceId ?? stored.blockFaceId,
                ).toBe(faceId)
                mesh.updateWorldMatrix(true, false)
                expect(mesh.getWorldPosition(new Vector3()).toArray().every(Number.isFinite)).toBe(
                  true,
                )
              }
              if (side) {
                await move(11, 'f-right')
                await move(12, 'f-right')
                expect(useLiveNodeOverrides.getState().get(item.id)?.blockFaceId).toBe('f-right')
                expect(sceneRegistry.nodes.get(item.id)).toBe(mesh)
                expect(mesh.parent).toBe(wrapper)
                expect(body().uuid).toBe(initialHostMesh)
              }
            } finally {
              await renderer.unmount()
            }
          })
}
