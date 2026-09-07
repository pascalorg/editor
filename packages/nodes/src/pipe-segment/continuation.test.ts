import { describe, expect, test } from 'bun:test'
import { type AnyNode, nodeRegistry, PipeFittingNode, registerNode } from '@pascal-app/core'
import { pipeFittingDefinition } from '../pipe-fitting/definition'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import {
  pipeContinuationHandlePlan,
  pipeContinuationHandlePoint,
  pipeEndpointPort,
  resolvePipeContinuationSeed,
} from './continuation'
import { pipeSegmentDefinition } from './definition'
import { PipeSegmentNode } from './schema'

function makePipe() {
  return PipeSegmentNode.parse({
    ...pipeSegmentDefinition.defaults(),
    path: [
      [1, 0.0381, 2],
      [4, 0.0381, 2],
    ],
    diameter: 3,
    pipeMaterial: 'abs',
    system: 'vent',
  })
}

describe('pipe continuation', () => {
  test('exposes outward-facing ports and offset plus handles at both ends', () => {
    const pipe = makePipe()

    expect(pipeEndpointPort(pipe, 'start')?.direction).toEqual([-1, 0, 0])
    expect(pipeEndpointPort(pipe, 'end')?.direction).toEqual([1, 0, 0])
    expect(pipeContinuationHandlePoint(pipe, 'start')).toEqual([0.72, 0.0381, 2])
    expect(pipeContinuationHandlePoint(pipe, 'end')).toEqual([4.28, 0.0381, 2])
  })

  test('restores the selected endpoint and pipe profile when the draw tool mounts', () => {
    const pipe = makePipe()
    const nodes = { [pipe.id]: pipe } as Record<string, AnyNode>

    const seed = resolvePipeContinuationSeed(
      { continuation: { nodeId: pipe.id, endpoint: 'end' } },
      nodes,
    )

    expect(seed?.pipe).toBe(pipe)
    expect(seed?.port.position).toEqual([4, 0.0381, 2])
    expect(seed?.pipe.diameter).toBe(3)
    expect(seed?.pipe.pipeMaterial).toBe('abs')
    expect(seed?.pipe.system).toBe('vent')
  })

  test('rejects missing pipes and malformed endpoint seeds', () => {
    expect(
      resolvePipeContinuationSeed(
        { continuation: { nodeId: 'pipe-segment_missing', endpoint: 'end' } },
        {},
      ),
    ).toBeNull()
    expect(
      resolvePipeContinuationSeed(
        { continuation: { nodeId: makePipe().id, endpoint: 'middle' } },
        {},
      ),
    ).toBeNull()
  })

  test('moves the action from a square bend to the future sanitary-tee outlet', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode(pipeSegmentDefinition)
      registerNode(pipeFittingDefinition)
      const elbow = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        fittingType: 'elbow',
        angle: 90,
        position: [1, 0.1, 2],
      })
      const ports = getPipeFittingPorts(elbow)
      const outlet = ports.find((port) => port.id === 'outlet')!
      const inlet = ports.find((port) => port.id === 'inlet')!
      const selected = PipeSegmentNode.parse({
        ...pipeSegmentDefinition.defaults(),
        path: [
          [...outlet.position],
          [outlet.position[0], outlet.position[1], outlet.position[2] + 2],
        ],
      })
      const other = PipeSegmentNode.parse({
        ...pipeSegmentDefinition.defaults(),
        path: [[...inlet.position], [inlet.position[0] - 2, inlet.position[1], inlet.position[2]]],
      })
      const nodes = {
        [selected.id]: selected,
        [other.id]: other,
        [elbow.id]: elbow,
      } as Record<string, AnyNode>

      const handle = pipeContinuationHandlePlan(selected, 'start', nodes)
      expect(handle?.fittingId).toBe(elbow.id)
      const seed = resolvePipeContinuationSeed(
        { continuation: { nodeId: selected.id, endpoint: 'start', fittingId: elbow.id } },
        nodes,
      )
      expect(seed?.promotedFitting?.fittingType).toBe('sanitary-tee')
      expect(seed?.port.id).toBe('outlet')
    } finally {
      restoreRegistry()
    }
  })

  test('shows the cross continuation when any sanitary-tee leg is selected', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode(pipeSegmentDefinition)
      registerNode(pipeFittingDefinition)
      const tee = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        fittingType: 'sanitary-tee',
        position: [1, 0.1, 2],
      })
      const connectedRuns = getPipeFittingPorts(tee).map((port) =>
        PipeSegmentNode.parse({
          ...pipeSegmentDefinition.defaults(),
          path: [
            [...port.position],
            [
              port.position[0] + port.direction[0],
              port.position[1] + port.direction[1],
              port.position[2] + port.direction[2],
            ],
          ],
        }),
      )
      const nodes = Object.fromEntries(
        [tee, ...connectedRuns].map((node) => [node.id, node as AnyNode]),
      )
      const handles = connectedRuns.map((run) => pipeContinuationHandlePlan(run, 'start', nodes))

      expect(handles.every((handle) => handle?.fittingId === tee.id)).toBe(true)
      expect(new Set(handles.map((handle) => JSON.stringify(handle?.position))).size).toBe(1)
      const seed = resolvePipeContinuationSeed(
        {
          continuation: {
            nodeId: connectedRuns[0]!.id,
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
})
