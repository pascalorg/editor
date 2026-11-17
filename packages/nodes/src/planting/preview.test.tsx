import { expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  PlantingNode,
  SiteNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  FloorplanSitePlanLayer,
  RegistryToolProvider,
  sceneLayout,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act as actThree, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { type BufferGeometry, type Object3D, Vector3 } from 'three'
import { PlantingAreaControl, plantingAreaPatch } from './area-control'
import { plantingDefinition } from './definition'
import { usePlantingDraft } from './draft'
import { createPlantingMoveSession } from './floorplan-move'
import { plantingParametrics } from './parametrics'
import PlantingTool from './tool'

// These are actual mounted adapters, not snapshots of the source or mocked renderers.
// Happy DOM supplies events/SVG only; the R3F test renderer does not exercise a GPU.
async function withDom(run: () => Promise<void>) {
  const dom = new TestWindow()
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLCanvasElement: dom.HTMLCanvasElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  const saved = {
    scene: useScene.getState(),
    editor: useEditor.getState(),
    viewer: useViewer.getState(),
    overrides: useLiveNodeOverrides.getState(),
    scope: useInteractionScope.getState(),
  }
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  try {
    useEditor.setState({
      mode: 'build',
      tool: 'planting',
      workspaceMode: 'edit',
      viewLayouts: { edit: sceneLayout('3d') },
    })
    useLiveNodeOverrides.getState().clearAll()
    await run()
  } finally {
    useScene.setState(saved.scene)
    useEditor.setState(saved.editor)
    useViewer.setState(saved.viewer)
    useLiveNodeOverrides.setState(saved.overrides)
    useInteractionScope.setState(saved.scope)
    usePlantingDraft.setState({ points: [], hover: null, error: null })
    clearSceneHistory()
    await dom.happyDOM.abort()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

test('the real 3D draft follows a slab in Site world metres beneath a transformed active building', async () =>
  withDom(async () => {
    const site = SiteNode.parse({ id: 'site_frame', children: ['building_frame', 'slab_preview'] })
    const building = BuildingNode.parse({
      id: 'building_frame',
      parentId: site.id,
      position: [10, 2, -3],
      rotation: [0, Math.PI / 2, 0],
      children: ['level_frame'],
    })
    const level = LevelNode.parse({ id: 'level_frame', parentId: building.id, level: 0 })
    const slab = SlabNode.parse({
      id: 'slab_preview',
      parentId: site.id,
      polygon: [
        [1, 2],
        [5, 2],
        [5, 4],
        [1, 4],
      ],
      elevation: 0.7,
      thickness: 0.2,
    })
    useScene.setState({
      nodes: { [site.id]: site, [building.id]: building, [level.id]: level, [slab.id]: slab },
      rootNodeIds: [site.id],
    } as never)
    useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
    const renderer = await create(
      createElement(
        'group',
        { position: building.position, rotation: building.rotation },
        createElement(RegistryToolProvider, {
          value: {
            activeLevelId: level.id,
            sceneApi: createSceneApi(useScene),
            isCameraDragging: () => false,
            selectNode: () => {},
            unit: 'metric',
          },
          children: createElement(PlantingTool),
        }),
      ),
    )
    try {
      await actThree(async () =>
        usePlantingDraft.setState({
          points: [
            [2, 3],
            [4, 3],
          ],
          hover: null,
          error: null,
        }),
      )
      const root = renderer.scene.instance
      root.updateMatrixWorld(true)
      const lines: (Object3D & { geometry: BufferGeometry })[] = []
      root.traverse((object) => {
        const candidate = object as Object3D & { geometry?: BufferGeometry }
        if (candidate.geometry?.getAttribute('instanceStart'))
          lines.push(candidate as Object3D & { geometry: BufferGeometry })
      })
      expect(lines).toHaveLength(1)
      const line = lines[0]!,
        starts = line.geometry.getAttribute('instanceStart'),
        ends = line.geometry.getAttribute('instanceEnd')
      const start = new Vector3(starts.getX(0), starts.getY(0), starts.getZ(0)).applyMatrix4(
        line.matrixWorld,
      )
      const end = new Vector3(ends.getX(0), ends.getY(0), ends.getZ(0)).applyMatrix4(
        line.matrixWorld,
      )
      for (const [actual, expected] of [
        [start, [2, 0.75, 3]],
        [end, [4, 0.75, 3]],
      ] as const) {
        expect(actual.x).toBeCloseTo(expected[0], 6)
        expect(actual.y).toBeCloseTo(expected[1], 6)
        expect(actual.z).toBeCloseTo(expected[2], 6)
      }
      expect(usePlantingDraft.getState().points).toEqual([
        [2, 3],
        [4, 3],
      ])
    } finally {
      await actThree(async () => renderer.unmount())
    }
  }))

test('the mounted site-plan symbol follows move overrides without a persisted write and returns on cancellation', async () =>
  withDom(async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    const site = SiteNode.parse({
      id: 'site_preview',
      children: ['planting_preview'],
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
    })
    const node = PlantingNode.parse({
      id: 'planting_preview',
      parentId: site.id,
      outline: [
        [-3, -2],
        [3, -2],
        [3, 2],
        [-3, 2],
      ],
      seed: 19,
    })
    useScene.setState({
      nodes: { [site.id]: site, [node.id]: node },
      rootNodeIds: [site.id],
    } as never)
    const original = useScene.getState().nodes
    useEditor.setState({ viewLayouts: { edit: sceneLayout('2d') } })
    const root = createRoot(document.body)
    try {
      await loadPlugin({ id: 'pascal:core', apiVersion: 1, nodes: [plantingDefinition] })
      await act(async () =>
        root.render(
          <svg>
            <FloorplanSitePlanLayer />
          </svg>,
        ),
      )
      const circles = () =>
        [...document.querySelectorAll('circle')].map((circle) => [
          Number(circle.getAttribute('cx')),
          Number(circle.getAttribute('cy')),
        ])
      const outlineCenter = () => {
        const polygon = document.querySelector('polygon[fill="#b29b79"]')
        if (!polygon) throw new Error('The actual planting outline must be visible')
        const points = polygon
          .getAttribute('points')!
          .trim()
          .split(/\s+/)
          .map((pair) => pair.split(',').map(Number))
        let twiceArea = 0,
          x = 0,
          z = 0
        points.forEach((p, i) => {
          const q = points[(i + 1) % points.length]!,
            cross = p[0]! * q[1]! - q[0]! * p[1]!
          twiceArea += cross
          x += (p[0]! + q[0]!) * cross
          z += (p[1]! + q[1]!) * cross
        })
        return [x / (3 * twiceArea), z / (3 * twiceArea)]
      }
      const before = circles()
      const beforeCenter = outlineCenter()
      expect(before.length).toBeGreaterThan(0)
      const session = createPlantingMoveSession({ node, nodes: original } as never)!
      const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
      await act(async () => {
        session.apply({ planPoint: [0, 0], modifiers } as never)
        session.apply({ planPoint: [5, 3], modifiers } as never)
      })
      expect(useScene.getState().nodes).toBe(original)
      expect(circles().length).toBeGreaterThan(0)
      expect(circles()).not.toEqual(before)
      const movedCenter = outlineCenter()
      expect(movedCenter[0]! - beforeCenter[0]!).toBeCloseTo(5, 6)
      expect(movedCenter[1]! - beforeCenter[1]!).toBeCloseTo(3, 6)
      await act(async () => useLiveNodeOverrides.getState().clear(node.id))
      expect(circles()).toEqual(before)
      expect(useScene.getState().nodes).toBe(original)
    } finally {
      await act(async () => root.unmount())
      restoreRegistry()
    }
  }))

test('area candidates validate the whole node, and the real control refuses an in-range area outside Site bounds', async () =>
  withDom(async () => {
    const boundary = PlantingNode.parse({ id: 'planting_area', area: 0.25, center: [9999, 0] })
    expect(plantingAreaPatch(boundary, 12)).toBeNull()
    expect(plantingAreaPatch(PlantingNode.parse({ area: 0.25 }), 12)).toEqual({ area: 12 })
    const field = plantingParametrics.groups
      .flatMap((group) => group.fields)
      .find((field) => field.key === 'area')
    expect(field?.kind).toBe('custom')
    if (field?.kind !== 'custom') throw new Error('Area must use the validated custom control')
    expect(field.component).toBe(PlantingAreaControl)
    // A Shift-wheel proposes 2.75m²: valid as a scalar, invalid at this center.
    const node = PlantingNode.parse({ id: 'planting_area', area: 0.25, center: [9999.5, 0] })
    useScene.setState({ nodes: { [node.id]: node }, rootNodeIds: [] } as never)
    const updates: Partial<PlantingNode>[] = []
    const root = createRoot(document.body)
    try {
      await act(async () =>
        root.render(<PlantingAreaControl node={node} onUpdate={(patch) => updates.push(patch)} />),
      )
      const label = [...document.querySelectorAll('div')].find(
        (element) => element.textContent === 'Area',
      )
      expect(label).toBeDefined()
      await act(async () => {
        const event = new window.WheelEvent('wheel', {
          deltaY: -1,
          bubbles: true,
          cancelable: true,
        })
        // This Happy DOM WheelEvent extends UIEvent and drops modifier init fields.
        // Supply the browser's read-only modifier value, not a control callback mock.
        Object.defineProperty(event, 'shiftKey', { value: true })
        expect(event.shiftKey).toBe(true)
        label!.dispatchEvent(event)
      })
      expect(updates).toEqual([])
      expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
      expect(useScene.getState().nodes[node.id]).toBe(node)
      expect(document.querySelector('[role="status"]')?.textContent).toContain('outside')
      await act(async () => {
        label!.dispatchEvent(
          new window.WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }),
        )
      })
      expect(updates).toEqual([{ area: 0.5 }])
      expect(PlantingNode.safeParse({ ...node, ...updates[0] }).success).toBe(true)
    } finally {
      await act(async () => root.unmount())
    }
  }))
