import { describe, expect, test } from 'bun:test'
import { BeamNode } from './beam'
import { ColumnNode } from './column'
import { ConstructionJointNode } from './construction-joint'
import { FormworkAssemblyNode } from './formwork-assembly'
import { FormworkBoxOutNode } from './formwork-box-out'
import { SlabNode } from './slab'
import { WallNode } from './wall'

describe('castable hosts accept formwork children', () => {
  // A shutter is parented to the element it forms, and the joint between two
  // pour units to the element that was cut. Without a `children` declaration
  // the assembly has no schema-sanctioned home on the host: it is stripped on
  // the next parse, and the renderer never mounts what the panel just created.
  const assembly = FormworkAssemblyNode.parse({})
  const joint = ConstructionJointNode.parse({ elementIds: [] })
  const boxOut = FormworkBoxOutNode.parse({})

  const hosts = [
    { kind: 'wall', schema: WallNode, seed: { start: [0, 0], end: [4, 0] } },
    { kind: 'column', schema: ColumnNode, seed: {} },
    {
      kind: 'slab',
      schema: SlabNode,
      seed: {
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    },
    { kind: 'beam', schema: BeamNode, seed: { start: [0, 0], end: [4, 0] } },
  ] as const

  test.each(hosts)('$kind hosts an assembly and a joint', ({ schema, seed }) => {
    expect(schema.parse(seed).children).toEqual([])
    expect(schema.parse({ ...seed, children: [assembly.id, joint.id] }).children).toEqual([
      assembly.id,
      joint.id,
    ])
  })

  test.each([
    { kind: 'wall', schema: WallNode, seed: { start: [0, 0], end: [4, 0] } },
    {
      kind: 'slab',
      schema: SlabNode,
      seed: {
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    },
  ] as const)('$kind hosts a box-out — the void survives the parse', ({ schema, seed }) => {
    // A box-out is parented to the element it voids, so the host's children
    // union must accept its id: parse is what a scene load runs, and a wall
    // whose children reject a box-out id throws the whole scene out.
    expect(schema.parse({ ...seed, children: [boxOut.id] }).children).toEqual([boxOut.id])
  })
})
