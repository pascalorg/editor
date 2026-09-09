import { describe, expect, test } from 'bun:test'
import { type AnyNode, DuctSegmentNode, PipeSegmentNode } from '@pascal-app/core'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { getPipeFittingPorts } from '../pipe-fitting/ports'
import {
  createDuctRunEndCap,
  createPipeRunEndCap,
  findMatedRunEndCapIds,
  isRunEndCapPort,
} from './automatic-run-end-cap'

describe('automatic run end caps', () => {
  test('closes a rectangular return duct with a matching profile and orientation', () => {
    const duct = DuctSegmentNode.parse({
      path: [
        [0, 1, 0],
        [3, 1, 0],
      ],
      shape: 'rect',
      width: 20,
      height: 10,
      ductMaterial: 'duct-board',
      system: 'return',
      roll: Math.PI / 4,
    })
    const cap = createDuctRunEndCap(duct)!
    const inlet = getDuctFittingPorts(cap)[0]!
    const nodes = { [duct.id]: duct, [cap.id]: cap } as Record<string, AnyNode>

    expect(cap.fittingType).toBe('end-cap')
    expect([cap.shape, cap.width, cap.height, cap.ductMaterial, cap.system]).toEqual([
      'rect',
      20,
      10,
      'duct-board',
      'return',
    ])
    expect(inlet.position[0]).toBeCloseTo(3)
    expect(inlet.position[1]).toBeCloseTo(1)
    expect(inlet.position[2]).toBeCloseTo(0)
    expect(
      findMatedRunEndCapIds(
        {
          ...inlet,
          nodeId: duct.id,
          direction: [1, 0, 0],
        },
        nodes,
        'duct-fitting',
      ),
    ).toEqual([cap.id])
    expect(isRunEndCapPort({ ...inlet, nodeId: cap.id }, nodes)).toBe(true)
  })

  test('closes a vertical vent pipe and preserves its material', () => {
    const pipe = PipeSegmentNode.parse({
      path: [
        [2, 0, 4],
        [2, 3, 4],
      ],
      diameter: 3,
      pipeMaterial: 'cast-iron',
      system: 'vent',
    })
    const cap = createPipeRunEndCap(pipe)!
    const inlet = getPipeFittingPorts(cap)[0]!
    const nodes = { [pipe.id]: pipe, [cap.id]: cap } as Record<string, AnyNode>

    expect([cap.fittingType, cap.diameter, cap.pipeMaterial, cap.system]).toEqual([
      'end-cap',
      3,
      'cast-iron',
      'vent',
    ])
    expect(inlet.position[0]).toBeCloseTo(2)
    expect(inlet.position[1]).toBeCloseTo(3)
    expect(inlet.position[2]).toBeCloseTo(4)
    expect(
      findMatedRunEndCapIds(
        {
          ...inlet,
          nodeId: pipe.id,
          direction: [0, 1, 0],
        },
        nodes,
        'pipe-fitting',
      ),
    ).toEqual([cap.id])
  })

  test('can cap the starting endpoint of a run', () => {
    const pipe = PipeSegmentNode.parse({
      path: [
        [1, 2, 3],
        [4, 2, 3],
      ],
      diameter: 2,
    })
    const cap = createPipeRunEndCap(pipe, 'start')!
    const inlet = getPipeFittingPorts(cap)[0]!

    expect(inlet.position[0]).toBeCloseTo(1)
    expect(inlet.position[1]).toBeCloseTo(2)
    expect(inlet.position[2]).toBeCloseTo(3)
    expect(inlet.direction[0]).toBeCloseTo(1)
    expect(inlet.direction[1]).toBeCloseTo(0)
    expect(inlet.direction[2]).toBeCloseTo(0)
  })
})
