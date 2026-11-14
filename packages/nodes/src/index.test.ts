import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AnyNode,
  DoorNode,
  LevelNode,
  loadPlugin,
  nodeKindOf,
  nodeRegistry,
  useInteractive,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { renderPlugin } from '@pascal-app/nodes/render'
import { FloorplanPreview } from '@pascal-app/viewer/ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

describe('builtinPlugin', () => {
  let restoreRegistry: () => void
  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
  })
  afterEach(() => restoreRegistry())

  test('has the expected manifest shape', () => {
    expect(builtinPlugin.id).toBe('pascal:core')
    expect(builtinPlugin.apiVersion).toBe(1)
    expect(Array.isArray(builtinPlugin.nodes)).toBe(true)
  })

  test('loads the registered kinds without error', async () => {
    await loadPlugin(builtinPlugin)
    expect(nodeRegistry.has('shelf')).toBe(true)
    expect(nodeRegistry.size).toBeGreaterThanOrEqual(1)
  })

  test('opening paint reads the body material beneath slot overrides', async () => {
    await loadPlugin(builtinPlugin)
    for (const type of ['door', 'window'] as const) {
      const node = AnyNode.parse({
        type,
        wallId: 'wall_test',
        material: { properties: { color: '#123456' } },
      })
      const paint = nodeRegistry.get(type)?.capabilities?.paint
      const pick = (role: string, painted = node) =>
        paint?.getEffectiveMaterial?.({ node: painted, role, nodes: {} })
      expect(pick('frame')?.material?.properties?.color).toBe('#123456')
      if (type === 'door') expect(pick('panel')?.material?.properties?.color).toBe('#123456')
      expect(pick('glass')).toBeNull()
      expect(
        pick('frame', AnyNode.parse({ ...node, slots: { frame: '#abcdef' } }))?.material?.properties
          ?.color,
      ).toBe('#abcdef')
    }
  })

  test.each([
    ['full', builtinPlugin],
    ['render', renderPlugin],
  ] as const)('%s entry registers every built-in kind exactly once', async (_entry, plugin) => {
    expect(plugin.id).toBe('pascal:core')
    expect(plugin.apiVersion).toBe(1)
    await loadPlugin(plugin)
    const kinds = plugin.nodes!.map((definition) => definition.kind)
    expect(kinds).toHaveLength(56)
    expect(new Set(kinds).size).toBe(56)
    expect([...nodeRegistry.entries()].map(([kind]) => kind).sort()).toEqual(
      AnyNode.options.map(nodeKindOf).sort(),
    )
  })

  test('render keeps geometry, baking, interaction dispatch and the read-only plan without editing contributions', () => {
    expect(renderPlugin.nodes!.map((definition) => definition.kind)).toEqual(
      builtinPlugin.nodes!.map((definition) => definition.kind),
    )
    for (const render of renderPlugin.nodes!) {
      const full = builtinPlugin.nodes!.find((definition) => definition.kind === render.kind)!
      expect(render.schema).toBe(full.schema)
      expect(render.schemaVersion).toBe(full.schemaVersion)
      expect(render.geometry).toBe(full.geometry)
      expect(render.system).toBe(full.system)
      expect(render.bake).toBe(full.bake)
      expect(render.bakeGeometry).toBe(full.bakeGeometry)
      expect(render.bakeGeometryAsync).toBe(full.bakeGeometryAsync)
      expect(render.bakeReplaceRenderer).toBe(full.bakeReplaceRenderer)
      expect(render.exportAnimation).toBe(full.exportAnimation)
      expect(render.capabilities.mechanism).toBe(full.capabilities.mechanism)
      expect(render.capabilities.slots).toBe(full.capabilities.slots)
      expect(render.floorplan).toBe(full.floorplan)
      expect(render.computeFloorplanLevelData).toBe(full.computeFloorplanLevelData)
      expect(render.floorplanScope).toBe(full.floorplanScope)
      expect(render.floorplanLinkedLevelIds).toBe(full.floorplanLinkedLevelIds)
      expect(render.capabilities.paint).toBeUndefined()
      expect(render.floorplanAffordances).toBeUndefined()
      expect(render.floorplanMoveTarget).toBeUndefined()
      expect(render.floorplanDependencies).toBeUndefined()
      expect(render.floorplanDependsOnSiblings).toBeUndefined()
      expect(render.floorplanAffectedIds).toBeUndefined()
      expect(render.floorplanSiblingOverrides).toBeUndefined()
      expect(render.tool).toBeUndefined()
      expect(render.parametrics).toBeUndefined()
      expect(render.extensions).toBeUndefined()
    }
  })
})

test('the render entry alone draws the read-only plan of built-in kinds', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  try {
    await loadPlugin(renderPlugin)
    const walls = [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 3],
      ],
      [
        [4, 3],
        [0, 3],
      ],
      [
        [0, 3],
        [0, 0],
      ],
    ].map(([start, end], index) =>
      WallNode.parse({ id: `wall_${index}`, parentId: 'level_plan', start, end }),
    )
    const zone = ZoneNode.parse({
      id: 'zone_plan',
      parentId: 'level_plan',
      name: 'Room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const level = LevelNode.parse({
      id: 'level_plan',
      children: [...walls.map((wall) => wall.id), zone.id],
    })
    const nodes = Object.fromEntries([level, ...walls, zone].map((node) => [node.id, node]))
    const markup = renderToStaticMarkup(
      createElement(FloorplanPreview, {
        levelId: level.id,
        scene: { nodes },
        showCompass: false,
        showLevelSelector: false,
      }),
    )
    // The plan's own SVG, before the zoom controls' icons.
    const plan = markup.slice(
      markup.indexOf('data-floorplan-preview'),
      markup.indexOf('</svg>', markup.indexOf('data-floorplan-preview')),
    )
    const drawn = new Map(
      plan
        .split('data-floorplan-node-id="')
        .slice(1)
        .map((part) => [part.slice(0, part.indexOf('"')), /<(path|polygon)\b/.test(part)]),
    )
    for (const node of [...walls, zone]) expect(drawn.get(node.id)).toBe(true)
  } finally {
    restoreRegistry()
  }
})

test.each(['hinged', 'sliding'] as const)(
  'render %s door mechanism opens transiently and reverses the displayed value',
  (doorType) => {
    const originalScene = useScene.getState()
    const originalInteractive = useInteractive.getState()
    const node = DoorNode.parse({ doorType })
    const mechanism = renderPlugin.nodes!.find((definition) => definition.kind === 'door')!
      .capabilities.mechanism!
    try {
      useScene.setState({ nodes: { [node.id]: node } })
      useInteractive.setState({ doors: {}, doorAnimations: {} })
      const saved = useScene.getState().nodes
      mechanism.set(node, true)
      const field = doorType === 'sliding' ? 'operationState' : 'swingAngle'
      const opened = doorType === 'sliding' ? 1 : Math.PI / 2
      expect(useInteractive.getState().doorAnimations[node.id]).toMatchObject({
        field,
        from: 0,
        to: opened,
        persist: false,
      })
      useInteractive.getState().setDoorOpenState(node.id, { [field]: opened / 2 })
      mechanism.set(node, false)
      expect(useInteractive.getState().doorAnimations[node.id]).toMatchObject({
        field,
        from: opened / 2,
        to: 0,
        persist: false,
      })
      expect(useScene.getState().nodes).toBe(saved)
    } finally {
      useScene.setState(originalScene)
      useInteractive.setState(originalInteractive)
    }
  },
)
