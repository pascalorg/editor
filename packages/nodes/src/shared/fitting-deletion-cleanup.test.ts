import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DuctFittingNode,
  nodeRegistry,
  PipeFittingNode,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { ductFittingDefinition } from '../duct-fitting/definition'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { ductSegmentDefinition } from '../duct-segment/definition'
import { DuctSegmentNode } from '../duct-segment/schema'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import { pipeSegmentDefinition } from '../pipe-segment/definition'
import { PipeSegmentNode } from '../pipe-segment/schema'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

function withDistributionDefinitions(run: () => void): void {
  const restoreRegistry = nodeRegistry._snapshot()
  try {
    registerNode(ductSegmentDefinition)
    registerNode(ductFittingDefinition)
    registerNode(pipeSegmentDefinition)
    registerNode(pipeFittingDefinition)
    run()
  } finally {
    useScene.setState({ nodes: {}, rootNodeIds: [], readOnly: false } as never)
    restoreRegistry()
  }
}

function seedDuctFitting(fitting: DuctFittingNode) {
  const runs = Object.fromEntries(
    getDuctFittingPorts(fitting).map((port) => {
      const run = DuctSegmentNode.parse({
        ...ductSegmentDefinition.defaults(),
        id: `duct-segment_${port.id}`,
        system: fitting.system,
        path: [
          [...port.position],
          [
            port.position[0] + port.direction[0] * 2,
            port.position[1] + port.direction[1] * 2,
            port.position[2] + port.direction[2] * 2,
          ],
        ],
      })
      return [port.id, run]
    }),
  ) as Record<string, DuctSegmentNode>
  const nodes = Object.fromEntries(
    [fitting, ...Object.values(runs)].map((node) => [node.id, node as AnyNode]),
  )
  useScene.setState({ nodes, rootNodeIds: Object.keys(nodes), readOnly: false } as never)
  return runs
}

function seedPipeFitting(fitting: PipeFittingNode) {
  const runs = Object.fromEntries(
    getPipeFittingPorts(fitting).map((port) => {
      const run = PipeSegmentNode.parse({
        ...pipeSegmentDefinition.defaults(),
        id: `pipe-segment_${port.id}`,
        system: fitting.system,
        path: [
          [...port.position],
          [
            port.position[0] + port.direction[0] * 2,
            port.position[1] + port.direction[1] * 2,
            port.position[2] + port.direction[2] * 2,
          ],
        ],
      })
      return [port.id, run]
    }),
  ) as Record<string, PipeSegmentNode>
  const nodes = Object.fromEntries(
    [fitting, ...Object.values(runs)].map((node) => [node.id, node as AnyNode]),
  )
  useScene.setState({ nodes, rootNodeIds: Object.keys(nodes), readOnly: false } as never)
  return runs
}

function expectRunStartsOnPorts(
  runs: Array<DuctSegmentNode | PipeSegmentNode>,
  positions: Array<readonly [number, number, number]>,
): void {
  for (const run of runs) {
    const current = useScene.getState().nodes[run.id] as DuctSegmentNode | PipeSegmentNode
    expect(
      positions.some((position) =>
        current.path[0]!.every((coordinate, index) =>
          index < 3 ? Math.abs(coordinate - position[index]!) < 1e-6 : false,
        ),
      ),
    ).toBe(true)
  }
}

describe('fitting cleanup when a connected run is deleted', () => {
  test('downgrades a duct cross to a tee and keeps every surviving collar mated', () => {
    withDistributionDefinitions(() => {
      const fitting = DuctFittingNode.parse({
        ...ductFittingDefinition.defaults(),
        id: 'duct-fitting_cross-delete',
        fittingType: 'cross',
        position: [3, 1, 4],
      })
      const runs = seedDuctFitting(fitting)

      useScene.getState().deleteNode(runs.branch2!.id)

      const next = useScene.getState().nodes[fitting.id] as DuctFittingNode
      expect(next.fittingType).toBe('tee')
      expectRunStartsOnPorts(
        [runs.inlet!, runs.outlet!, runs.branch!],
        getDuctFittingPorts(next).map((port) => port.position),
      )
    })
  })

  test('downgrades a duct tee to an elbow when one run leg is removed', () => {
    withDistributionDefinitions(() => {
      const fitting = DuctFittingNode.parse({
        ...ductFittingDefinition.defaults(),
        id: 'duct-fitting_tee-delete',
        fittingType: 'tee',
        branchAngle: 90,
      })
      const runs = seedDuctFitting(fitting)

      useScene.getState().deleteNode(runs.outlet!.id)

      const next = useScene.getState().nodes[fitting.id] as DuctFittingNode
      expect(next.fittingType).toBe('elbow')
      expect(next.angle).toBeCloseTo(90)
      expectRunStartsOnPorts(
        [runs.inlet!, runs.branch!],
        getDuctFittingPorts(next).map((port) => port.position),
      )
    })
  })

  test('downgrades a pipe cross to a sanitary tee', () => {
    withDistributionDefinitions(() => {
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        id: 'pipe-fitting_cross-delete',
        fittingType: 'cross',
        position: [1, 2, 3],
      })
      const runs = seedPipeFitting(fitting)

      useScene.getState().deleteNode(runs.branch2!.id)

      const next = useScene.getState().nodes[fitting.id] as PipeFittingNode
      expect(next.fittingType).toBe('sanitary-tee')
      expectRunStartsOnPorts(
        [runs.inlet!, runs.outlet!, runs.branch!],
        getPipeFittingPorts(next).map((port) => port.position),
      )
    })
  })

  test('calculates a multi-delete once and converts a pipe cross directly to an elbow', () => {
    withDistributionDefinitions(() => {
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        id: 'pipe-fitting_cross-multi-delete',
        fittingType: 'cross',
        position: [1, 2, 3],
      })
      const runs = seedPipeFitting(fitting)

      useScene.getState().deleteNodes([runs.outlet!.id, runs.branch!.id])

      const next = useScene.getState().nodes[fitting.id] as PipeFittingNode
      expect(next.fittingType).toBe('elbow')
      expect(next.angle).toBeCloseTo(90)
      expectRunStartsOnPorts(
        [runs.inlet!, runs.branch2!],
        getPipeFittingPorts(next).map((port) => port.position),
      )
    })
  })

  test('removes an orphan elbow and restores its surviving pipe to the junction', () => {
    withDistributionDefinitions(() => {
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        id: 'pipe-fitting_elbow-delete',
        fittingType: 'elbow',
        angle: 90,
        position: [2, 0.5, 2],
      })
      const runs = seedPipeFitting(fitting)

      useScene.getState().deleteNode(runs.outlet!.id)

      expect(useScene.getState().nodes[fitting.id]).toBeUndefined()
      const survivor = useScene.getState().nodes[runs.inlet!.id] as PipeSegmentNode
      expect(survivor.path[0]).toEqual(fitting.position)
    })
  })

  test('merges straight-through pipes into one pipe when their tee branch is deleted', () => {
    withDistributionDefinitions(() => {
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        id: 'pipe-fitting_tee-straight-delete',
        fittingType: 'sanitary-tee',
        position: [4, 1, 2],
      })
      const runs = seedPipeFitting(fitting)
      const inletOuter = runs.inlet!.path[1]!
      const outletOuter = runs.outlet!.path[1]!
      useScene.setState((state) => ({
        nodes: {
          ...state.nodes,
          [runs.inlet!.id]: {
            ...state.nodes[runs.inlet!.id],
            path: [inletOuter, runs.inlet!.path[0]],
          } as AnyNode,
        },
      }))

      useScene.getState().deleteNode(runs.branch!.id)

      expect(useScene.getState().nodes[fitting.id]).toBeUndefined()
      expect(useScene.getState().nodes[runs.outlet!.id]).toBeUndefined()
      const survivor = useScene.getState().nodes[runs.inlet!.id] as PipeSegmentNode
      expect(survivor.path).toEqual([inletOuter, outletOuter])
    })
  })

  test('uses the same straight-through merge for duct tees', () => {
    withDistributionDefinitions(() => {
      const fitting = DuctFittingNode.parse({
        ...ductFittingDefinition.defaults(),
        id: 'duct-fitting_tee-straight-delete',
        fittingType: 'tee',
        position: [4, 1, 2],
      })
      const runs = seedDuctFitting(fitting)

      useScene.getState().deleteNode(runs.branch!.id)

      expect(useScene.getState().nodes[fitting.id]).toBeUndefined()
      expect(useScene.getState().nodes[runs.outlet!.id]).toBeUndefined()
      const survivor = useScene.getState().nodes[runs.inlet!.id] as DuctSegmentNode
      expect(survivor.path).toEqual([runs.inlet!.path[1], runs.outlet!.path[1]])
    })
  })
})
