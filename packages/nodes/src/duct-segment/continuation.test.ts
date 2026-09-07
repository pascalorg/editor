import { describe, expect, test } from 'bun:test'
import { type AnyNode, DuctFittingNode, nodeRegistry, registerNode } from '@pascal-app/core'
import { ductFittingDefinition } from '../duct-fitting/definition'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import {
  ductContinuationHandlePlan,
  ductContinuationHandlePoint,
  ductEndpointPort,
  resolveDuctContinuationSeed,
} from './continuation'
import { ductSegmentDefinition } from './definition'
import { buildDuctSegmentFloorplan } from './floorplan'
import { DuctSegmentNode } from './schema'

function makeDuct() {
  return DuctSegmentNode.parse({
    ...ductSegmentDefinition.defaults(),
    path: [
      [1, 0.2, 2],
      [4, 0.2, 2],
    ],
    shape: 'rect',
    width: 18,
    height: 10,
    ductMaterial: 'sheet-metal',
    system: 'return',
  })
}

describe('duct continuation', () => {
  test('exposes outward-facing ports and offset plus handles at both ends', () => {
    const duct = makeDuct()

    expect(ductEndpointPort(duct, 'start')?.direction).toEqual([-1, 0, 0])
    expect(ductEndpointPort(duct, 'end')?.direction).toEqual([1, 0, 0])
    expect(ductContinuationHandlePoint(duct, 'start')).toEqual([0.72, 0.2, 2])
    expect(ductContinuationHandlePoint(duct, 'end')).toEqual([4.28, 0.2, 2])
  })

  test('restores the selected endpoint and duct profile when the draw tool mounts', () => {
    const duct = makeDuct()
    const nodes = { [duct.id]: duct } as Record<string, AnyNode>

    const seed = resolveDuctContinuationSeed(
      { continuation: { nodeId: duct.id, endpoint: 'end' } },
      nodes,
    )

    expect(seed?.duct).toBe(duct)
    expect(seed?.port.position).toEqual([4, 0.2, 2])
    expect(seed?.duct.width).toBe(18)
    expect(seed?.duct.height).toBe(10)
    expect(seed?.duct.ductMaterial).toBe('sheet-metal')
    expect(seed?.duct.system).toBe('return')
  })

  test('rejects missing ducts and malformed endpoint seeds', () => {
    expect(
      resolveDuctContinuationSeed(
        { continuation: { nodeId: 'duct-segment_missing', endpoint: 'end' } },
        {},
      ),
    ).toBeNull()
    expect(
      resolveDuctContinuationSeed(
        { continuation: { nodeId: makeDuct().id, endpoint: 'middle' } },
        {},
      ),
    ).toBeNull()
  })

  test('moves the action from an occupied run end to an elbow branch and seeds a tee', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode(ductSegmentDefinition)
      registerNode(ductFittingDefinition)
      const elbow = DuctFittingNode.parse({
        ...ductFittingDefinition.defaults(),
        fittingType: 'elbow',
        angle: 90,
        shape: 'rect',
        diameter: 12,
        position: [1, 0.3, 2],
      })
      const ports = getDuctFittingPorts(elbow)
      const outlet = ports.find((port) => port.id === 'outlet')!
      const inlet = ports.find((port) => port.id === 'inlet')!
      const selected = DuctSegmentNode.parse({
        ...ductSegmentDefinition.defaults(),
        path: [
          [...outlet.position],
          [outlet.position[0], outlet.position[1], outlet.position[2] + 2],
        ],
      })
      const other = DuctSegmentNode.parse({
        ...ductSegmentDefinition.defaults(),
        path: [[...inlet.position], [inlet.position[0] - 2, inlet.position[1], inlet.position[2]]],
      })
      const nodes = {
        [selected.id]: selected,
        [other.id]: other,
        [elbow.id]: elbow,
      } as Record<string, AnyNode>

      const handle = ductContinuationHandlePlan(selected, 'start', nodes)
      expect(handle?.fittingId).toBe(elbow.id)
      expect(handle?.position[2]).toBeLessThan(elbow.position[2])

      const seed = resolveDuctContinuationSeed(
        { continuation: { nodeId: selected.id, endpoint: 'start', fittingId: elbow.id } },
        nodes,
      )
      expect(seed?.promotedFitting?.fittingType).toBe('tee')
      expect(seed?.port.id).toBe('outlet')
    } finally {
      restoreRegistry()
    }
  })

  test('does not show a continuation action on a butt-connected endpoint', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode(ductSegmentDefinition)
      const left = makeDuct()
      const right = DuctSegmentNode.parse({
        ...ductSegmentDefinition.defaults(),
        path: [[...left.path.at(-1)!], [6, 0.2, 2]],
        system: left.system,
      })
      const nodes = { [left.id]: left, [right.id]: right } as Record<string, AnyNode>
      expect(ductContinuationHandlePlan(left, 'end', nodes)).toBeNull()
    } finally {
      restoreRegistry()
    }
  })

  test('shows the same fourth-side action from every run connected to a tee', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode(ductSegmentDefinition)
      registerNode(ductFittingDefinition)
      const tee = DuctFittingNode.parse({
        ...ductFittingDefinition.defaults(),
        fittingType: 'tee',
        branchAngle: 90,
        shape: 'rect',
        shape2: 'rect',
        diameter: 12,
        diameter2: 12,
        position: [2, 0.3, 2],
      })
      const connectedRuns = getDuctFittingPorts(tee).map((port) =>
        DuctSegmentNode.parse({
          ...ductSegmentDefinition.defaults(),
          path: [
            [...port.position],
            [
              port.position[0] + port.direction[0] * 2,
              port.position[1] + port.direction[1] * 2,
              port.position[2] + port.direction[2] * 2,
            ],
          ],
        }),
      )
      const nodes = Object.fromEntries(
        [tee, ...connectedRuns].map((node) => [node.id, node as AnyNode]),
      )
      const handles = connectedRuns.map((run) => ductContinuationHandlePlan(run, 'start', nodes))

      expect(handles.every((handle) => handle?.fittingId === tee.id)).toBe(true)
      expect(new Set(handles.map((handle) => JSON.stringify(handle?.position))).size).toBe(1)
      const seed = resolveDuctContinuationSeed(
        {
          continuation: {
            nodeId: connectedRuns[2]!.id,
            endpoint: 'start',
            fittingId: tee.id,
          },
        },
        nodes,
      )
      expect(seed?.promotedFitting?.fittingType).toBe('cross')
      expect(seed?.port.id).toBe('branch2')
    } finally {
      restoreRegistry()
    }
  })

  test('shows click-only continuation handles beyond selected plan endpoints', () => {
    const geometry = buildDuctSegmentFloorplan(makeDuct(), {
      viewState: { selected: true },
    } as never)
    const handles =
      geometry?.kind === 'group'
        ? geometry.children.filter(
            (child) => child.kind === 'midpoint-handle' && child.activation === 'action',
          )
        : []

    expect(handles).toHaveLength(3)
    const points = handles.map((handle) => handle.kind === 'midpoint-handle' && handle.point)
    expect(points[0]?.[0]).toBeCloseTo(0.5914)
    expect(points[0]?.[1]).toBeCloseTo(2)
    expect(points[1]?.[0]).toBeCloseTo(4.4086)
    expect(points[1]?.[1]).toBeCloseTo(2)
  })
})
