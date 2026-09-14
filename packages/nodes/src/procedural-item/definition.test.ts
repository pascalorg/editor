import { expect, test } from 'bun:test'
import {
  createSceneApi,
  type GeometryContext,
  type HandleDescriptor,
  ItemNode,
  useScene,
} from '@pascal-app/core'
import {
  bedRecipe,
  evaluateRecipe,
  ProceduralItemNode,
  parseRecipe,
  queryProceduralItem,
  radiatorRecipe,
} from '@pascal-app/core/procedural-items'
import { proceduralItemDefinition } from './definition'

const scene = createSceneApi(useScene)
const handles = (node: ProceduralItemNode): HandleDescriptor<ProceduralItemNode>[] => {
  const definition = proceduralItemDefinition.handles!
  return typeof definition === 'function' ? definition(node, scene) : definition
}
const recipe = parseRecipe({
  version: 1,
  name: 'Offset box',
  description: 'Tests non-centered evaluated bounds.',
  parameters: ['width', 'height', 'depth'].map((id, index) => ({
    id,
    label: id,
    default: 0.12,
    min: 0.06,
    max: 3,
    step: 0.01,
    unit: 'm',
    axis: ['x', 'y', 'z'][index],
  })),
  slots: [{ id: 'body', label: 'Body', color: '#777777' }],
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        {
          id: 'box',
          primitive: 'box',
          slot: 'body',
          size: ['width', 'height', 'depth'],
          position: [0.4, 2, -0.3],
        },
      ],
    },
  ],
  constraints: [],
})

for (const size of [0.12, 2.4]) {
  test(`places arrows and floor rotate handle outside an offset ${size} m evaluated recipe`, () => {
    const node = ProceduralItemNode.parse({
      recipe,
      parameters: { width: size, height: size, depth: size },
    })
    const b = evaluateRecipe(node.recipe, node.parameters)
    const all = handles(node)
    const arrows = all.filter((h) => h.kind === 'linear-resize')
    expect(arrows).toHaveLength(3)
    arrows.forEach((arrow, index) => {
      const position = arrow.placement.position(node, scene)
      position.forEach((value, axis) => {
        expect(value).toBeCloseTo(
          axis === index ? b.max[axis]! + 0.15 : (b.min[axis]! + b.max[axis]!) / 2,
        )
      })
      expect(arrow.placement.clearance?.edge(node, scene)).toBeCloseTo(b.max[index]!)
      expect(arrow.placement.clearance?.distance).toBe(0.4)
    })
    const rotate = all.find((h) => h.kind === 'arc-resize')!
    expect(rotate.shape).toBe('rotate')
    expect(rotate.placement.position(node, scene)).toEqual([b.max[0] + 0.3, 2, b.max[2] + 0.3])
    expect(rotate.placement.rotationY?.(node, scene)).toBe(-Math.PI / 4)
    expect(rotate.decoration?.radius(node, scene)).toBeCloseTo(
      Math.hypot(size / 2, size / 2) + 0.06,
    )
    rotate.decoration?.center?.(node, scene).forEach((v, i) => {
      expect(v).toBeCloseTo([0.4, 2, -0.3][i]!)
    })
    expect(rotate.decoration?.y?.(node)).toBeCloseTo(2)
    expect(all.some((h) => h.kind === 'tap-action' && h.shape === 'move-cross')).toBe(false)
    const initial = { ...node, rotation: [0.1, 0.2, 0.3] as [number, number, number] }
    expect(rotate.apply(initial, Math.PI / 12, scene)).toEqual({
      rotation: [0.1, 0.2 - Math.PI / 12, 0.3],
    })
  })
}

test('part arrows retain their latch group and use the part edge for clearance', () => {
  const node = ProceduralItemNode.parse({ recipe: bedRecipe })
  const arrow = handles(node).find(
    (h) => h.kind === 'linear-resize' && h.latchGroup === 'headboard',
  )!
  expect(arrow.kind).toBe('linear-resize')
  if (arrow.kind !== 'linear-resize') return
  expect(arrow.placement.position(node, scene)[1]).toBeCloseTo(1.25)
  expect(arrow.placement.clearance?.edge(node, scene)).toBeCloseTo(1.1)
})

test('mounted recipes never expose rotation or move crosses, including before a wall is assigned', () => {
  for (const wallId of [undefined, 'wall_gizmo-test']) {
    const node = ProceduralItemNode.parse({ recipe: radiatorRecipe, wallId })
    const all = handles(node)
    expect(all.some((h) => h.kind === 'arc-resize')).toBe(false)
    expect(all.some((h) => h.kind === 'tap-action' && h.shape === 'move-cross')).toBe(false)
  }
})

const floorplanContext: GeometryContext = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
}

test('missing, empty and invalid plan image metadata retain the existing level bounds rect', () => {
  for (const floorPlanUrl of [undefined, '', '  ', 42]) {
    const node = ProceduralItemNode.parse({
      recipe,
      position: [3, 0, 4],
      rotation: [0, 0.7, 0],
      metadata: { floorPlanUrl },
    })
    const bounds = queryProceduralItem(node, {}).levelBounds
    expect(proceduralItemDefinition.floorplan!(node, floorplanContext)).toEqual({
      kind: 'rect',
      x: bounds.min[0],
      y: bounds.min[2],
      width: bounds.dimensions[0],
      height: bounds.dimensions[2],
      fill: '#777777',
      stroke: '#44403c',
      strokeWidth: 0.01,
    })
  }
})

test('snapshot image and transparent hit polygon share root yaw, offset center and parameter scale', () => {
  const url = 'https://example.test/chair-plan.png'
  for (const width of [0.12, 2.4]) {
    const node = ProceduralItemNode.parse({
      recipe,
      parameters: { width },
      position: [3, 0, 4],
      rotation: [0, Math.PI / 2, 0],
      metadata: { floorPlanUrl: url },
    })
    const result = proceduralItemDefinition.floorplan!(node, floorplanContext)
    expect(result?.kind).toBe('group')
    if (result?.kind !== 'group') throw new Error('Expected image group')
    expect(result.children).toHaveLength(2)
    const [polygon, image] = result.children
    expect(polygon).toMatchObject({ kind: 'polygon', fill: 'transparent' })
    expect(image).toMatchObject({ kind: 'image', url })
    if (image?.kind !== 'image' || polygon?.kind !== 'polygon')
      throw new Error('Missing plan layers')
    expect(image.center[0]).toBeCloseTo(2.7)
    expect(image.center[1]).toBeCloseTo(3.6)
    expect(image.width).toBeCloseTo(width)
    expect(image.height).toBeCloseTo(0.12)
    expect(image.rotation).toBeCloseTo(-Math.PI / 2)
    expect(polygon.points[0]![0]).toBeCloseTo(2.64)
    expect(polygon.points[0]![1]).toBeCloseTo(3.6 + width / 2)
  }
})

test('plan image composes item host yaw and draws selected outline over the snapshot', () => {
  const host = ItemNode.parse({
    position: [5, 0, 6],
    rotation: [0, Math.PI / 4, 0],
    asset: {
      id: 'table',
      name: 'Table',
      category: 'furniture',
      src: '/table.glb',
      thumbnail: '',
      dimensions: [4, 1, 4],
    },
  })
  const node = ProceduralItemNode.parse({
    recipe,
    parentId: host.id,
    rotation: [0, Math.PI / 4, 0],
    metadata: { floorPlanUrl: 'data:image/png;base64,snapshot' },
  })
  const result = proceduralItemDefinition.floorplan!(node, {
    ...floorplanContext,
    resolve: (() => host) as GeometryContext['resolve'],
    parent: host,
    viewState: { selected: true },
  })
  if (result?.kind !== 'group') throw new Error('Expected image group')
  expect(result.children).toHaveLength(3)
  const image = result.children[1]
  if (image?.kind !== 'image') throw new Error('Missing image')
  expect(image.rotation).toBeCloseTo(-Math.PI / 2)
  expect(image.center[0]).toBeCloseTo(4.7)
  expect(image.center[1]).toBeCloseTo(5.6)
  expect(result.children[2]).toMatchObject({ kind: 'polygon', fill: 'none', strokeWidth: 0.035 })
})
