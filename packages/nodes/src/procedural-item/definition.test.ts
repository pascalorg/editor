import { expect, test } from 'bun:test'
import { createSceneApi, type HandleDescriptor, useScene } from '@pascal-app/core'
import {
  bedRecipe,
  evaluateRecipe,
  ProceduralItemNode,
  parseRecipe,
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
