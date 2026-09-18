import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DuctFittingNode,
  DuctSegmentNode,
  type GeometryContext,
  PipeFittingNode,
} from '@pascal-app/core'
import { Box3, Mesh, Raycaster, Vector3 } from 'three'
import { buildDuctFittingFloorplan } from '../duct-fitting/floorplan'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { buildPipeFittingFloorplan } from '../pipe-fitting/floorplan'
import { buildPipeFittingGeometry } from '../pipe-fitting/geometry'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import {
  accessoryMateQuaternion,
  inheritFittingProfile,
  placeAccessPanel,
} from './accessory-placement'

const ctx: GeometryContext = { resolve: () => undefined, children: [], siblings: [], parent: null }
function nodes(...items: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(items.map((n) => [n.id, n]))
}

describe('accessory catalog', () => {
  test.each([
    'round',
    'rect',
    'oval',
  ] as const)('duct caps close the %s opening while sleeves stay hollow', (shape) => {
    const cap = DuctFittingNode.parse({ fittingType: 'end-cap', shape })
    expect(getDuctFittingPorts(cap)).toHaveLength(1)
    const group = buildDuctFittingGeometry(cap)
    group.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(-1, 0, 0), new Vector3(1, 0, 0))
    expect(
      ray.intersectObject(group, true).some((hit) => hit.object.name === 'end-cap-closure'),
    ).toBe(true)
    const coupling = buildDuctFittingGeometry(
      DuctFittingNode.parse({ fittingType: 'coupling', shape }),
    )
    coupling.updateMatrixWorld(true)
    expect(ray.intersectObject(coupling, true)).toHaveLength(0)
  })

  test('damper blade opens independently of its connection ports', () => {
    const closed = DuctFittingNode.parse({ fittingType: 'damper' })
    const open = DuctFittingNode.parse({ ...closed, damperAngle: 90 })
    expect(getDuctFittingPorts(open)).toEqual(getDuctFittingPorts(closed))
    const mesh = buildDuctFittingGeometry(open).getObjectByName('damper-blade')!
    expect(mesh.rotation.z).toBeCloseTo(-Math.PI / 2)
    expect(getDuctFittingPorts(open)).toHaveLength(2)
  })

  test('cleanout service plugs are closed, not dangling flow connections', () => {
    for (const cleanoutStyle of ['end', 'inline'] as const) {
      const node = PipeFittingNode.parse({ fittingType: 'cleanout', cleanoutStyle })
      expect(getPipeFittingPorts(node)).toHaveLength(cleanoutStyle === 'end' ? 1 : 2)
      expect(buildPipeFittingGeometry(node).getObjectByName('cleanout-hex-head')).toBeDefined()
    }
    expect(getPipeFittingPorts(PipeFittingNode.parse({ fittingType: 'end-cap' }))).toHaveLength(1)
  })

  test('pipe reducers advertise different end sizes and couplings retain a single size', () => {
    for (const fittingType of ['reducer', 'coupling'] as const) {
      const ports = getPipeFittingPorts(
        PipeFittingNode.parse({ fittingType, diameter: 4, diameter2: 2 }),
      )
      expect(ports.map((p) => p.diameter)).toEqual(fittingType === 'reducer' ? [4, 2] : [4, 4])
    }
  })

  test('profile inheritance matches rectangular return ducts', () => {
    const run = DuctSegmentNode.parse({
      parentId: null,
      path: [
        [0, 2, 0],
        [4, 2, 0],
      ],
      width: 20,
      height: 12,
      shape: 'rect',
      system: 'return',
    })
    const cap = inheritFittingProfile(
      DuctFittingNode.parse({ fittingType: 'end-cap' }),
      {
        nodeId: run.id,
        id: 'end',
        position: [2, 3, 0],
        direction: [1, 0, 0],
        diameter: 16,
        system: 'return',
      },
      nodes(run),
    )
    expect([cap.width, cap.height, cap.shape, cap.system]).toEqual([20, 12, 'rect', 'return'])
  })

  test('access doors mount on duct faces in both views and reject undersized faces', () => {
    const run = DuctSegmentNode.parse({
      parentId: null,
      path: [
        [0, 2, 0],
        [4, 2, 0],
      ],
      width: 20,
      height: 12,
      shape: 'rect',
    })
    const panel = DuctFittingNode.parse({ fittingType: 'access-panel' })
    expect(getDuctFittingPorts(panel)).toHaveLength(0)
    const plan = placeAccessPanel([2, 0, 0.25], panel, nodes(run), null, false, 0.25)
    const spatial = placeAccessPanel([2, 2, 0.25], panel, nodes(run), null, true, 0.25)
    expect(plan).toEqual(spatial)
    expect(plan?.position[1]).toBe(2)
    expect(plan?.position[2]).toBeCloseTo(0.255)
    expect(
      placeAccessPanel([2, 2, 0.25], { ...panel, panelHeight: 1 }, nodes(run), null, true, 0),
    ).toBeNull()
  })

  test('all catalog models and their plan projections are finite and nonempty', () => {
    const items = [
      ...(['end-cap', 'damper', 'access-panel', 'coupling'] as const).flatMap((fittingType) =>
        (['round', 'rect', 'oval'] as const).map((shape) =>
          DuctFittingNode.parse({ fittingType, shape, rotation: [0.3, 0.7, 1.2] }),
        ),
      ),
      ...(['end-cap', 'cleanout', 'reducer', 'coupling'] as const).map((fittingType) =>
        PipeFittingNode.parse({ fittingType, rotation: [0, 0, Math.PI / 2] }),
      ),
    ]
    for (const node of items) {
      const group =
        node.type === 'duct-fitting'
          ? buildDuctFittingGeometry(node)
          : buildPipeFittingGeometry(node)
      const box = new Box3().setFromObject(group)
      expect(box.isEmpty()).toBe(false)
      expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true)
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        expect(
          Array.from(object.geometry.getAttribute('position').array).every(Number.isFinite),
        ).toBe(true)
      })
      const plan =
        node.type === 'duct-fitting'
          ? buildDuctFittingFloorplan(node, ctx)
          : buildPipeFittingFloorplan(node, ctx)
      expect(plan?.kind).toBe('group')
      if (plan?.kind === 'group') expect(plan.children.length).toBeGreaterThan(0)
    }
  })
})

test('rectangular caps follow the width axis of a rolled vertical riser', () => {
  const host = DuctSegmentNode.parse({
    path: [
      [0, 0, 0],
      [0, 3, 0],
    ],
    shape: 'rect',
    roll: Math.PI / 2,
  })
  const cap = DuctFittingNode.parse({ fittingType: 'end-cap', shape: 'rect' })
  const rotation = accessoryMateQuaternion(
    cap,
    { nodeId: host.id, id: 'end', direction: [0, 1, 0], position: [0, 3, 0], diameter: 12 },
    nodes(host),
  )
  const width = new Vector3(0, 0, 1).applyQuaternion(rotation)
  expect(Math.abs(width.z)).toBeCloseTo(1)
  expect(new Vector3(1, 0, 0).applyQuaternion(rotation).y).toBeCloseTo(1)
})
