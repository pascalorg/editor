import { expect, test } from 'bun:test'
import {
  canHostSurfaceChild,
  getSelectableKinds,
  isRegistryMovable,
  isRegistrySelectable,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { separatorDefinition } from './definition'

test('separator registers selectable dashed plan and 3D renderers, without movement or baking', () => {
  const restore = nodeRegistry._snapshot()
  try {
    registerNode(separatorDefinition)
    expect(isRegistrySelectable('separator')).toBe(true)
    expect(getSelectableKinds()).toContain('separator')
    expect(isRegistryMovable('separator')).toBe(false)
    expect(separatorDefinition.renderer?.kind).toBe('parametric')
    expect(separatorDefinition.geometry).toBeUndefined()
    expect(separatorDefinition.floorplan).toBeFunction()
    expect(separatorDefinition.dirtyTracking).toBe(false)
    expect(separatorDefinition.bake).toBe('strip')
    const node = separatorDefinition.schema.parse(separatorDefinition.defaults())
    expect(node.type).toBe('separator')
    expect(separatorDefinition.floorplan!(node, {} as never)).toMatchObject({
      kind: 'line',
      strokeDasharray: '6 4',
      pointerEvents: 'stroke',
    })
    expect(canHostSurfaceChild(node, 'item')).toBe(false)
    expect(node).not.toHaveProperty('thickness')
  } finally {
    restore()
  }
})

test('a selected separator shows a wall’s handles on the plan: its two ends and a push arrow off each side', () => {
  const node = separatorDefinition.schema.parse({
    ...separatorDefinition.defaults(),
    start: [0, 0],
    end: [4, 0],
  })
  const geometry = separatorDefinition.floorplan!(node, { viewState: { selected: true } } as never)
  const children = geometry?.kind === 'group' ? geometry.children : []
  expect(children[0]).toMatchObject({ kind: 'line', strokeDasharray: '6 4' })
  expect(
    children.flatMap((child) =>
      child.kind === 'endpoint-handle' ? [[child.affordance, child.payload]] : [],
    ),
  ).toEqual([
    ['move-endpoint', { separatorId: node.id, endpoint: 'start' }],
    ['move-endpoint', { separatorId: node.id, endpoint: 'end' }],
  ])
  const arrows = children.flatMap((child) => (child.kind === 'move-arrow' ? [child] : []))
  expect(arrows.map((arrow) => arrow.payload)).toEqual([
    { wallId: node.id, side: 'a' },
    { wallId: node.id, side: 'b' },
  ])
  // One off each side of the line.
  expect(arrows.map((arrow) => Math.sign(arrow.point[1]))).toEqual([1, -1])
  expect(separatorDefinition.floorplanAffordances?.['move-endpoint']).toBeDefined()
  expect(separatorDefinition.snapProfile).toBe('structural')
})
