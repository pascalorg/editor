import { describe, expect, test } from 'bun:test'
import { ColumnNode } from './column'
import { ConstructionJointNode } from './construction-joint'
import { FormworkAssemblyNode } from './formwork-assembly'
import { SlabNode } from './slab'
import { WallNode } from './wall'

describe('castable hosts accept formwork children', () => {
  // A shutter is parented to the element it forms, and the joint between two
  // pour units to the element that was cut. Without a `children` declaration
  // the assembly has no schema-sanctioned home on the host: it is stripped on
  // the next parse, and the renderer never mounts what the panel just created.
  const assembly = FormworkAssemblyNode.parse({})
  const joint = ConstructionJointNode.parse({ elementIds: [] })

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
  ] as const

  test.each(hosts)('$kind hosts an assembly and a joint', ({ schema, seed }) => {
    expect(schema.parse(seed).children).toEqual([])
    expect(schema.parse({ ...seed, children: [assembly.id, joint.id] }).children).toEqual([
      assembly.id,
      joint.id,
    ])
  })
})
