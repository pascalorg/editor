/**
 * One fixture for the suites that mount real node renderers, movers and viewer systems in the
 * R3F test renderer (the hosting, move and duplicate suites in this folder, cabinet and item).
 *
 * `installMountedScene()` registers, for the calling file:
 * - every builtin node kind in a fresh registry (restored afterwards);
 * - the editor, scene, viewer and interaction-scope stores, restored by replacement so keys a
 *   test adds cannot outlive it;
 * - a minimal `window`/`document` (there is no DOM), with `requestAnimationFrame` queued and
 *   run once per settled frame;
 * - drei `<Html>` labels rendered as nothing (or handed to `html`), and item models loaded as a
 *   box instead of fetched;
 * - fake timers: `settle()` and `advance()` move time, nothing waits on the wall clock.
 */
import { afterEach, beforeAll, beforeEach, jest, spyOn } from 'bun:test'
import {
  type AnyNode,
  type BuildingNode,
  clearSceneHistory,
  type ItemNode,
  type LevelNode,
  nodeRegistry,
  registerNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import type { Recipe } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor, useInteractionScope } from '@pascal-app/editor'
import { NodeRenderer, resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { type ReactElement, type ReactNode, useMemo, useRef } from 'react'
import * as ReactDOM from 'react-dom'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
// `GeometrySystem` is not exported by @pascal-app/viewer; these three come from its source so a
// mounted scene runs the same frame systems as the editor. Keep viewer-source imports here only.
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

export { FloorElevationSystem, GeometrySystem, ItemSystem }

/** One frame of virtual time. */
export const FRAME_MS = 1000 / 60

type Renderer = Awaited<ReturnType<typeof create>>
type Size = [number, number, number]
type NodeDefinition = Parameters<typeof registerNode>[0]

/** `requestAnimationFrame` callbacks not yet run; `settle()` runs them. */
const animationFrames: FrameRequestCallback[] = []
/** Renderers from `mount()` still mounted; the harness unmounts them before restoring. */
const mounted = new Set<Renderer>()

export type MountedSceneOptions = {
  /** Kinds to register instead of every builtin. */
  nodes?: readonly NodeDefinition[]
  /** Receives each `<Html>` label's props; whatever it returns renders in its place. */
  html?: (props: { children?: ReactNode }) => ReactNode
  /** Receives `createPortal` children (floating menus) instead of mounting them. */
  portal?: (children: ReactNode) => void
  /** Size of the box every item model loads as. */
  modelSize?: (url: string) => Size
}

export type MountedScene = {
  /** Change the stub model size for the rest of the test. */
  setModelSize(size: (url: string) => Size): void
}

/** 0.1 × 0.2 × 0.1 m box: the default catalog asset and procedural recipe of these suites. */
export const boxAsset = {
  id: 'audit-box',
  name: 'Audit box',
  category: 'decor',
  thumbnail: '',
  src: '/unrenderable-host-audit.glb',
  dimensions: [0.1, 0.2, 0.1] as Size,
}

export const boxRecipe: Recipe = {
  version: 1,
  name: 'Audit box',
  description: '',
  constraints: [],
  parameters: [
    { id: 'width', label: 'Width', default: 0.1, min: 0.05, max: 1, step: 0.05, unit: 'm' },
  ],
  slots: [{ id: 'body', label: 'Body', color: '#ffffff' }],
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        {
          id: 'box',
          primitive: 'box',
          size: [0.1, 0.2, 0.1],
          position: [0, 0.1, 0],
          slot: 'body',
        },
      ],
    },
  ],
  surfaces: [],
}

const GLOBALS = [
  'window',
  'document',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'DOMRect',
] as const

function stubGlobals() {
  const descriptors = GLOBALS.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement'])
    Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
  globalThis.window = Object.assign(new EventTarget(), {
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }) as Window & typeof globalThis
  // The solar-panel material paints a canvas once; afterwards nothing may create DOM elements.
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
  globalThis.requestAnimationFrame = (callback) => animationFrames.push(callback)
  globalThis.cancelAnimationFrame = () => {}
  return () =>
    GLOBALS.forEach((name, i) => {
      const descriptor = descriptors[i]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
}

function stubModels(size: () => (url: string) => Size) {
  return spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((url, onLoad) => {
    const [width, height, depth] = size()(url)
    const scene = new Group()
    scene.add(
      new Mesh(
        new BoxGeometry(width, height, depth).translate(0, height / 2, 0),
        new MeshBasicMaterial(),
      ),
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
}

async function loadLazyModules(definitions: readonly NodeDefinition[]) {
  const loads: Promise<unknown>[] = []
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 2) return
    for (const entry of Object.values(value)) {
      if (typeof entry === 'function' && entry.length === 0 && String(entry).includes('import('))
        loads.push(entry())
      else visit(entry, depth + 1)
    }
  }
  for (const definition of definitions) visit(definition, 0)
  await Promise.all(loads)
}

export function installMountedScene(options: MountedSceneOptions = {}): MountedScene {
  const defaultSize = options.modelSize ?? (() => boxAsset.dimensions)
  let modelSize = defaultSize
  const harness: MountedScene = {
    setModelSize(size) {
      modelSize = size
    },
  }
  let restore: () => void = () => {}

  // Time is virtual from here on, but a module import is real I/O: load every lazy renderer,
  // preview and tool up front so `React.lazy` boundaries resolve within one settled frame.
  beforeAll(() => loadLazyModules(options.nodes ?? builtinPlugin.nodes!))

  beforeEach(() => {
    jest.useFakeTimers()
    modelSize = defaultSize
    animationFrames.length = 0
    const stores = [useScene, useEditor, useViewer, useInteractionScope] as const
    const saved = stores.map((store) => store.getState())
    const restoreGlobals = stubGlobals()
    const html = spyOn(
      Html as unknown as { render: (props: { children?: ReactNode }) => ReactNode },
      'render',
    ).mockImplementation(options.html ?? (() => null))
    const portal = options.portal
      ? spyOn(ReactDOM, 'createPortal').mockImplementation((children) => {
          options.portal!(children)
          return null as never
        })
      : null
    const models = stubModels(() => modelSize)
    const restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    // Copies, so a test that adjusts a kind's capabilities cannot change the builtin definition.
    for (const def of options.nodes ?? builtinPlugin.nodes!)
      registerNode({ ...def, capabilities: { ...def.capabilities } })

    restore = () => {
      html.mockRestore()
      portal?.mockRestore()
      models.mockRestore()
      sceneRegistry.clear()
      spatialGridManager.clear()
      useLiveNodeOverrides.getState().clearAll()
      useLiveTransforms.getState().clearAll()
      clearSceneHistory()
      for (const [i, store] of stores.entries())
        (store.setState as (state: unknown, replace: true) => void)(saved[i], true)
      restoreRegistry()
      restoreGlobals()
      jest.useRealTimers()
    }
  })
  afterEach(async () => {
    for (const renderer of [...mounted]) await renderer.unmount()
    restore()
  })

  return harness
}

/** `create()` that the harness unmounts after the test if the test did not. */
export async function mount(element: ReactElement) {
  const renderer = await create(element)
  mounted.add(renderer)
  const unmount = renderer.unmount.bind(renderer)
  renderer.unmount = async () => {
    if (mounted.delete(renderer)) await unmount()
  }
  return renderer
}

/** Moves virtual time by `ms`, firing due timers inside `act`. */
export async function advance(ms = FRAME_MS) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

/**
 * Runs `count` frames: due timers (coalesced grid input, deferred cleanups), the R3F frame loop,
 * then the animation frames queued meanwhile.
 */
export async function settle(renderer: Renderer, count = 3) {
  for (let frame = 0; frame < count; frame++) {
    await advance()
    await act(async () => renderer.advanceFrames(1, FRAME_MS / 1000))
    await act(async () => {
      for (const callback of animationFrames.splice(0)) callback(0)
    })
  }
}

/** Loads the stub model of every item in the scene before mounting, so the mount never suspends. */
export async function preloadItemModels() {
  for (const node of Object.values(useScene.getState().nodes))
    if (node.type === 'item')
      useLoader.preload(ItemGLTFLoader, resolveCdnUrl((node as ItemNode).asset.src) ?? '')
  await Promise.resolve()
}

/** The building and level groups as the viewer mounts them, with every child renderer. */
export function LevelScene({
  building,
  level,
  posed = false,
}: {
  building?: BuildingNode
  level: LevelNode
  /** Apply the stored building position and rotation (default: identity). */
  posed?: boolean
}) {
  const levelChildren = useScene((s) => (s.nodes[level.id] as LevelNode | undefined)?.children)
  const buildingNode = useScene((s) =>
    building ? (s.nodes[building.id] as BuildingNode | undefined) : undefined,
  )
  const levelRef = useRef<Group>(null!)
  const buildingRef = useRef<Group>(null!)
  useRegistry(level.id, 'level', levelRef)
  useRegistry(building?.id ?? '', 'building', buildingRef)
  const levelGroup = (
    <group ref={levelRef}>
      {levelChildren?.map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </group>
  )
  if (!building) return levelGroup
  return (
    <group
      position={posed ? buildingNode?.position : undefined}
      ref={buildingRef}
      rotation={posed ? buildingNode?.rotation : undefined}
    >
      {levelGroup}
      {buildingNode?.children
        .filter((id) => id !== level.id)
        .map((id) => (
          <NodeRenderer key={id} nodeId={id} />
        ))}
    </group>
  )
}

/** The frame systems every mounted suite needs: floor elevation, item placement, geometry. */
export function SceneSystems() {
  return (
    <>
      <FloorElevationSystem />
      <ItemSystem />
      <GeometrySystem />
    </>
  )
}

/** The catalog mover on a copy of `source`, as the editor mounts it for a catalog item. */
export function CatalogMover({ source }: { source: ItemNode }) {
  const node = useMemo(() => structuredClone(source), [source])
  return <MoveItemTool node={node} />
}

/** The mover the editor picks for `node`: catalog items get the catalog mover. */
export function Mover({ node, catalog }: { node: AnyNode; catalog: boolean }) {
  return catalog ? <CatalogMover source={node as ItemNode} /> : <MoveRegistryNodeTool node={node} />
}
