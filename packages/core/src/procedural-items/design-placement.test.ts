import { describe, expect, test } from 'bun:test'
import { CeilingNode } from '../schema/nodes/ceiling'
import { LevelNode } from '../schema/nodes/level'
import { SlabNode } from '../schema/nodes/slab'
import { WallNode } from '../schema/nodes/wall'
import jointCabinetJson from './__fixtures__/joint_cabinet.json'
import airHandlerJson from './__fixtures__/trial-e2-air-handler.json'
import louverJson from './__fixtures__/trial-e5-louver.json'
import stairGuardJson from './__fixtures__/trial-e8-stair-guard.json'
import { DESIGN_EXAMPLE, validateDesign } from './design'
import {
  type DesignPlacement,
  DesignPlacementError,
  type DesignPlacementRequest,
  planDesignPlacement,
} from './design-placement'
import type { QueryNodes } from './query'

const square = (a: number, b: number): [number, number][] => [
  [a, a],
  [b, a],
  [b, b],
  [a, b],
]
const level = LevelNode.parse({ id: 'level_place', height: 3 })
const wall = WallNode.parse({
  id: 'wall_place',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
  height: 2.7,
})
const ceiling = CeilingNode.parse({
  id: 'ceiling_place',
  parentId: level.id,
  polygon: square(-3, 7),
})
const slab = SlabNode.parse({ id: 'slab_place', parentId: level.id, polygon: square(0, 4) })
const scene: QueryNodes = {
  [level.id]: { ...level, children: [wall.id, ceiling.id, slab.id] },
  [wall.id]: wall,
  [ceiling.id]: ceiling,
  [slab.id]: slab,
}
const vase = {
  ...DESIGN_EXAMPLE,
  name: 'Vase',
  parameters: [DESIGN_EXAMPLE.parameters[0]!],
  parts: [
    {
      id: 'body',
      label: 'Body',
      count: 1,
      shapes: [
        {
          id: 'pot',
          primitive: 'cylinder' as const,
          slot: 'wood',
          size: [0.1, 0.2, 0.1],
          position: [0, 0.1, 0],
        },
      ],
    },
  ],
}

function refusal(nodes: QueryNodes, request: DesignPlacementRequest) {
  try {
    planDesignPlacement(nodes, request)
  } catch (error) {
    if (error instanceof DesignPlacementError) return { code: error.code, message: error.message }
    throw error
  }
  throw new Error('expected a refusal')
}

function commit(nodes: QueryNodes, { node, parentId, hostUpdate }: DesignPlacement): QueryNodes {
  const parent = nodes[parentId] as { children: string[] }
  return {
    ...nodes,
    [node.id]: node,
    [parentId]: {
      ...parent,
      children: [...parent.children, node.id],
      ...(hostUpdate && { attachments: hostUpdate.attachments }),
    },
  } as QueryNodes
}

describe('planDesignPlacement', () => {
  test('mounts a wall-side trial louver on either face of a wall', () => {
    const front = planDesignPlacement(scene, {
      design: louverJson,
      hostId: wall.id,
      position: [2, 1.5, 0],
    })
    expect(front.parentId).toBe(wall.id)
    expect(front.node).toMatchObject({ wallId: wall.id, side: 'front', position: [2, 1.5, 0] })
    expect(front.hostUpdate).toBeUndefined()
    const back = planDesignPlacement(scene, {
      design: JSON.stringify(louverJson),
      hostId: wall.id,
      position: [1, 1.2, 0],
      side: 'back',
      parameters: { slat_count: 9 },
      name: 'Gable vent',
    })
    expect(back.node).toMatchObject({
      side: 'back',
      name: 'Gable vent',
      parameters: { slat_count: 9 },
    })
  })

  test('says where a wall design fits when it does not', () => {
    const { code, message } = refusal(scene, {
      design: louverJson,
      hostId: wall.id,
      position: [2, 2.5, 0],
    })
    expect(code).toBe('does_not_fit')
    expect(message).toBe(
      'does_not_fit: The mounted item must fit on the wall; the reference fits along 0.317–3.683 m and at height 0.47–2.23 m on this wall',
    )
  })

  test('hangs the trial air handler from a ceiling', () => {
    const placed = planDesignPlacement(scene, {
      design: airHandlerJson,
      hostId: ceiling.id,
      position: [2, 0, 2],
      rotation: Math.PI / 2,
    })
    expect(placed.parentId).toBe(ceiling.id)
    expect(placed.node.rotation).toEqual([0, Math.PI / 2, 0])
    expect(
      refusal(scene, { design: airHandlerJson, hostId: ceiling.id, position: [6.5, 0, 2] }).code,
    ).toBe('does_not_fit')
  })

  test('stands floor designs on the level of a slab or zone', () => {
    for (const hostId of [level.id, slab.id]) {
      const placed = planDesignPlacement(scene, {
        design: DESIGN_EXAMPLE,
        hostId,
        position: [1, 0, 1.5],
        rotation: 0.3,
        slots: { wood: '#334455' },
      })
      expect(placed.parentId).toBe(level.id)
      expect(placed.node.slots).toEqual({ wood: '#334455' })
    }
  })

  test('refuses an explicit id that exists before checking the host surface', () => {
    const table = planDesignPlacement(scene, {
      design: DESIGN_EXAMPLE,
      hostId: level.id,
      position: [1, 0, 1],
      parameters: { width: 0.9 },
    })
    const withTable = commit(scene, table)
    // Reusing the surface host's own id must say node_exists, not does_not_fit.
    expect(
      refusal(withTable, {
        design: vase,
        hostId: table.node.id,
        surfaceId: 'top:0:board:top',
        position: [0, 0, 0],
        id: table.node.id,
      }).code,
    ).toBe('node_exists')
  })

  test('refuses inline designs above the 24 KiB cap (R7) with a code', () => {
    const big = structuredClone(DESIGN_EXAMPLE) as any
    // Ten decorative parts of 24 small studs each: valid, and about 60 KiB of JSON.
    for (let p = 0; p < 10; p++)
      big.parts.push({
        id: `studs_${p}`,
        label: `Studs ${p}`,
        count: 1,
        shapes: Array.from({ length: 24 }, (_, i) => ({
          id: `stud_${i}`,
          primitive: 'box',
          slot: 'wood',
          size: [0.01, 0.01, 0.01],
          position: [-0.2 + i * 0.015, { op: 'sub', args: ['height', 0.035 + p * 0.001] }, 0],
        })),
      })
    expect(JSON.stringify(big).length).toBeGreaterThan(24 * 1024)
    const result = refusal(scene, { design: big, hostId: level.id, position: [0, 0, 0] })
    expect(result.code).toBe('design_too_large')
    expect(result.message).toContain('24 KiB')
    // validate_design reports the same refusal.
    expect(validateDesign(big)).toMatchObject({
      valid: false,
      diagnostics: [
        { code: 'design_too_large', message: result.message.slice('design_too_large: '.length) },
      ],
    })
  })

  test('measures the compact design, so whitespace in a JSON string does not count', () => {
    const padded = `${JSON.stringify(vase, null, 2)}${' '.repeat(30 * 1024)}`
    expect(() =>
      planDesignPlacement(scene, { design: padded, hostId: level.id, position: [1, 0, 1] }),
    ).not.toThrow()
  })

  test('rests a design on a named design surface and refuses an occupied spot', () => {
    const table = planDesignPlacement(scene, {
      design: DESIGN_EXAMPLE,
      hostId: level.id,
      position: [1, 0, 1],
      parameters: { width: 0.9, height: 0.7 },
    })
    const withTable = commit(scene, table)
    const onTop = { design: vase, hostId: table.node.id, surfaceId: 'top:0:board:top' }
    const first = planDesignPlacement(withTable, { ...onTop, position: [-0.2, 0, 0] })
    expect(first.parentId).toBe(table.node.id)
    expect(first.hostUpdate).toEqual({
      id: table.node.id,
      attachments: { [first.node.id]: 'top:0:board:top' },
    })
    const withVase = commit(withTable, first)
    expect(refusal(withVase, { ...onTop, position: [-0.18, 0, 0] })).toMatchObject({
      code: 'does_not_fit',
      message: expect.stringContaining('Another item occupies'),
    })
    expect(
      planDesignPlacement(withVase, { ...onTop, position: [0.2, 0, 0] }).hostUpdate,
    ).toBeDefined()
    expect(refusal(withTable, { ...onTop, surfaceId: 'seat', position: [0, 0, 0] })).toEqual({
      code: 'unknown_surface',
      message: `unknown_surface: ${table.node.id} has no surface seat; it has top:0:board:top`,
    })
    expect(refusal(withTable, { ...onTop, position: [0, 0.1, 0] }).code).toBe('invalid_placement')
  })

  test.each([
    ['invalid_design', { design: stairGuardJson, hostId: 'level_place', position: [0, 0, 0] }],
    [
      'invalid_design',
      {
        design: louverJson,
        hostId: 'wall_place',
        position: [2, 1.5, 0],
        parameters: { slat_count: 40 },
      },
    ],
    ['host_not_found', { design: DESIGN_EXAMPLE, hostId: 'level_missing', position: [0, 0, 0] }],
    ['wrong_host', { design: DESIGN_EXAMPLE, hostId: 'wall_place', position: [0, 0, 0] }],
    ['wrong_host', { design: airHandlerJson, hostId: 'level_place', position: [0, 0, 0] }],
    ['wrong_host', { design: louverJson, hostId: 'ceiling_place', position: [0, 0, 0] }],
    [
      'invalid_placement',
      { design: louverJson, hostId: 'wall_place', position: [2, 1.5, 0], rotation: 1 },
    ],
    [
      'invalid_placement',
      { design: DESIGN_EXAMPLE, hostId: 'level_place', position: [0, 0, 0], side: 'back' },
    ],
    [
      'invalid_placement',
      { design: airHandlerJson, hostId: 'ceiling_place', position: [2, 0.2, 2] },
    ],
    [
      'invalid_placement',
      {
        design: DESIGN_EXAMPLE,
        hostId: 'level_place',
        position: [0, 0, 0],
        slots: { wood: 'red' },
      },
    ],
  ] as const)('refuses with %s', (code, request) => {
    const result = refusal(scene, request as DesignPlacementRequest)
    expect(result.code).toBe(code)
    expect(result.message.startsWith(`${code}: `)).toBe(true)
  })

  test('node refusals name the field', () => {
    expect(
      refusal(scene, {
        design: DESIGN_EXAMPLE,
        hostId: level.id,
        position: [0, 0, 0],
        slots: { paint: '#ffffff' },
      }).message,
    ).toBe('invalid_placement: node: Unknown slot paint')
    expect(
      refusal(scene, {
        design: DESIGN_EXAMPLE,
        hostId: level.id,
        position: [0, 0, 0],
        id: 'item_x',
      }).message,
    ).toStartWith('invalid_placement: id: ')
  })

  test('refuses version 2 designs until writers are enabled', () => {
    const result = refusal(scene, {
      design: jointCabinetJson,
      hostId: level.id,
      position: [0, 0, 0],
    })
    expect(result.code).toBe('design_version_not_enabled')
    expect(result.message).toContain('next release')
  })

  test('invalid designs carry their diagnostics', () => {
    try {
      planDesignPlacement(scene, { design: stairGuardJson, hostId: level.id, position: [0, 0, 0] })
    } catch (error) {
      expect((error as DesignPlacementError).diagnostics).toEqual([
        expect.objectContaining({ code: 'sweep', severity: 'error' }),
      ])
      return
    }
    throw new Error('expected a refusal')
  })
})
