import { afterEach, expect, test } from 'bun:test'
import { DuctSegmentNode, useScene } from '@pascal-app/core'
import { Vector3 } from 'three'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { ductEndpointPort } from '../duct-segment/continuation'
import { planDuctDraw } from '../duct-segment/tool'
import type { DuctProfile } from './auto-fitting'

const original = useScene.getState().nodes
afterEach(() => useScene.setState({ nodes: original }))
const profiles: DuctProfile[] = [
  { shape: 'round', diameter: 6, width: 14, height: 8 },
  { shape: 'rect', diameter: 6, width: 14, height: 8 },
  { shape: 'oval', diameter: 6, width: 14, height: 8 },
]
for (const source of profiles)
  for (const target of profiles) {
    for (const direction of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ] as [number, number, number][]) {
      test(`${source.shape} to ${target.shape} aligns both collars along ${direction}`, () => {
        const axis = new Vector3(...direction)
        const run = DuctSegmentNode.parse({
          ...source,
          path: [axis.clone().multiplyScalar(-3).toArray(), [0, 0, 0]],
        })
        useScene.setState({ nodes: { [run.id]: run } })
        const end = axis.clone().multiplyScalar(3).toArray()
        const plan = planDuctDraw(
          [0, 0, 0],
          end,
          ductEndpointPort(run, 'end'),
          null,
          null,
          null,
          target,
        )!
        expect(plan.validationMessage).toBeNull()
        expect(plan.fittings).toHaveLength(source.shape === target.shape ? 0 : 1)
        if (source.shape === target.shape) return
        const fitting = plan.fittings[0]!
        expect(fitting.fittingType).toBe('transition')
        const ports = getDuctFittingPorts(fitting)
        expect(ports.map((p) => p.shape)).toEqual([source.shape, target.shape])
        expect(new Vector3(...ports[0]!.position).length()).toBeLessThan(1e-6)
        expect(
          new Vector3(...ports[1]!.position).distanceTo(new Vector3(...plan.ducts[0]!.path[0]!)),
        ).toBeLessThan(1e-6)
        expect(new Vector3(...ports[0]!.direction).dot(axis)).toBeCloseTo(-1)
        expect(new Vector3(...ports[1]!.direction).dot(axis)).toBeCloseTo(1)
        expect(
          buildDuctFittingGeometry(fitting).getObjectByName('fitting-transition-loft'),
        ).toBeDefined()
      })
    }
  }
for (const source of profiles)
  test(`${source.shape} size change inserts reducer at destination`, () => {
    const target = { ...source, diameter: 4, width: 10, height: 6 }
    const run = DuctSegmentNode.parse({
      ...source,
      path: [
        [3, 0, 0],
        [6, 0, 0],
      ],
    })
    useScene.setState({ nodes: { [run.id]: run } })
    const plan = planDuctDraw(
      [0, 0, 0],
      [3, 0, 0],
      null,
      null,
      ductEndpointPort(run, 'start'),
      null,
      target,
    )!
    expect(plan.validationMessage).toBeNull()
    expect(plan.fittings).toHaveLength(1)
    expect(plan.fittings[0]!.fittingType).toBe('reducer')
    const ports = getDuctFittingPorts(plan.fittings[0]!)
    expect(
      new Vector3(...ports[1]!.position).distanceTo(new Vector3(...plan.ducts[0]!.path[1]!)),
    ).toBeLessThan(1e-6)
  })
test('insufficient length blocks the whole adapter placement', () => {
  const run = DuctSegmentNode.parse({
    ...profiles[1],
    path: [
      [-3, 0, 0],
      [0, 0, 0],
    ],
  })
  useScene.setState({ nodes: { [run.id]: run } })
  const plan = planDuctDraw(
    [0, 0, 0],
    [0.2, 0, 0],
    ductEndpointPort(run, 'end'),
    null,
    null,
    null,
    profiles[0]!,
  )!
  expect(plan.validationMessage).toBeTruthy()
  expect(plan.fittings).toHaveLength(0)
  expect(plan.ducts).toHaveLength(0)
})
test('a bend with a profile change keeps the elbow and adds a transition', () => {
  const run = DuctSegmentNode.parse({
    ...profiles[1],
    path: [
      [-3, 0, 0],
      [0, 0, 0],
    ],
  })
  useScene.setState({ nodes: { [run.id]: run } })
  const plan = planDuctDraw(
    [0, 0, 0],
    [0, 0, 3],
    ductEndpointPort(run, 'end'),
    null,
    null,
    null,
    profiles[0]!,
  )!
  expect(plan.validationMessage).toBeNull()
  expect(plan.fittings.map((f) => f.fittingType)).toEqual(['elbow', 'transition'])
  const elbowEnd = getDuctFittingPorts(plan.fittings[0]!)[1]!
  const inlet = getDuctFittingPorts(plan.fittings[1]!)[0]!
  expect(new Vector3(...elbowEnd.position).distanceTo(new Vector3(...inlet.position))).toBeLessThan(
    1e-6,
  )
})

test('adapter and duct are committed, undone, and redone together', () => {
  const run = DuctSegmentNode.parse({
    ...profiles[1],
    path: [
      [-3, 0, 0],
      [0, 0, 0],
    ],
  })
  useScene.setState({ nodes: { [run.id]: run } })
  const history = useScene.temporal.getState()
  history.resume()
  history.clear()
  const plan = planDuctDraw(
    [0, 0, 0],
    [3, 0, 0],
    ductEndpointPort(run, 'end'),
    null,
    null,
    null,
    profiles[0]!,
  )!
  useScene.getState().applyNodeChanges({
    create: [...plan.fittings, ...plan.ducts].map((node) => ({ node, parentId: null })),
    update: plan.updates,
  })
  expect(Object.values(useScene.getState().nodes)).toHaveLength(3)
  history.undo()
  expect(Object.values(useScene.getState().nodes)).toEqual([run])
  history.redo()
  expect(Object.values(useScene.getState().nodes)).toHaveLength(3)
  history.clear()
})
