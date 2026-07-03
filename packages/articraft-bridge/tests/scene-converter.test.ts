import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { convertToSceneNodes, createModelNodes } from '../src/scene-converter'
import type { ArticraftModelData } from '../src/types'

const model: ArticraftModelData = {
  recordId: 'rec-1',
  name: 'Test articulated asset',
  recordPath: '/tmp/articraft/rec-1',
  modelPyPath: '/tmp/articraft/rec-1/model.py',
  warnings: [],
  meshes: [],
  links: [
    {
      name: 'claw',
      visuals: [
        {
          geometry: { type: 'sphere', params: { radius: 0.1 } },
          origin: { xyz: [1, 0, 1], rpy: [0, 0, 0] },
          material: { name: 'warning_yellow', rgba: [1, 0.8, 0, 1] },
        },
      ],
    },
    {
      name: 'arm',
      visuals: [
        {
          geometry: { type: 'box', params: { sx: 0.2, sy: 0.3, sz: 1 } },
          origin: { xyz: [0.5, 0, 0.5], rpy: [0, 0, 0] },
          material: { name: 'paint_red', rgba: [0.8, 0.1, 0.05, 1] },
        },
      ],
    },
    {
      name: 'base',
      visuals: [
        {
          geometry: { type: 'cylinder', params: { radius: 0.3, length: 0.2 } },
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          material: { name: 'dark_steel', rgba: [0.2, 0.22, 0.24, 1] },
        },
      ],
    },
  ],
  joints: [
    {
      name: 'base_to_arm',
      type: 'revolute',
      parent: 'base',
      child: 'arm',
      origin: { xyz: [0, 0, 0.2], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
      limits: { effort: 1, velocity: 1, lower: -1, upper: 1 },
    },
    {
      name: 'arm_to_claw',
      type: 'fixed',
      parent: 'arm',
      child: 'claw',
      origin: { xyz: [1, 0, 1], rpy: [0, 0, 0] },
      axis: [1, 0, 0],
    },
  ],
}

function createdByName(created: Map<AnyNodeId, { node: AnyNode; parentId?: AnyNodeId }>, name: string) {
  return [...created.values()].find(({ node }) => node.name === name)
}

function expectVecClose(actual: unknown, expected: [number, number, number]) {
  expect(Array.isArray(actual)).toBe(true)
  const values = actual as number[]
  expect(values.length).toBe(3)
  for (let i = 0; i < expected.length; i += 1) {
    expect(values[i]).toBeCloseTo(expected[i]!, 5)
  }
}

describe('Articraft scene converter', () => {
  test('keeps joint metadata on link frames when child links appear before parents', () => {
    const converted = convertToSceneNodes(model, { articulationMode: true })
    const armId = converted.nodeIdByLink.get('arm')
    const clawId = converted.nodeIdByLink.get('claw')

    expect(armId).toBeDefined()
    expect(clawId).toBeDefined()
    expect(converted.jointMetadata[armId!]?.jointName).toBe('base_to_arm')
    expect(converted.jointMetadata[clawId!]?.jointName).toBe('arm_to_claw')
  })

  test('creates articulated link frames before visual children', () => {
    const created = new Map<AnyNodeId, { node: AnyNode; parentId?: AnyNodeId }>()
    const externalParentId = 'level-1' as AnyNodeId

    const result = createModelNodes(
      model,
      (node, parentId) => {
        if (parentId && parentId !== externalParentId) {
          expect(created.has(parentId)).toBe(true)
        }
        created.set(node.id, { node, parentId })
        return node.id
      },
      { articulationMode: true, parentId: externalParentId },
    )

    const base = createdByName(created, 'base')
    const arm = createdByName(created, 'arm')
    const claw = createdByName(created, 'claw')
    const baseVisual = createdByName(created, 'base_visual')
    const armVisual = createdByName(created, 'arm_visual')
    const clawVisual = createdByName(created, 'claw_visual')

    expect(base?.parentId).toBe(externalParentId)
    expect(arm?.parentId).toBe(base?.node.id)
    expect(claw?.parentId).toBe(arm?.node.id)
    expect(baseVisual?.parentId).toBe(base?.node.id)
    expect(armVisual?.parentId).toBe(arm?.node.id)
    expect(clawVisual?.parentId).toBe(claw?.node.id)
    expect(result.rootNodeIds).toEqual([base?.node.id])
  })

  test('applies joint origin to child link frames and rootPosition to root frames only', () => {
    const created = new Map<AnyNodeId, { node: AnyNode; parentId?: AnyNodeId }>()

    createModelNodes(
      model,
      (node, parentId) => {
        created.set(node.id, { node, parentId })
        return node.id
      },
      { articulationMode: true, parentId: 'level-1' as AnyNodeId, rootPosition: [10, 2, -3] },
    )

    const base = createdByName(created, 'base')
    const arm = createdByName(created, 'arm')
    const armVisual = createdByName(created, 'arm_visual')

    expect(base?.node.position).toEqual([10, 2, -3])
    expect(arm?.node.position).toEqual([0, 0.2, -0])
    expect(armVisual?.node.position).toEqual([0.5, 0.5, -0])
  })

  test('preserves visual colors and maps URDF box dimensions into editor axes', () => {
    const converted = convertToSceneNodes(model, { articulationMode: true })
    const armVisual = converted.nodes.find((node) => node.name === 'arm_visual') as AnyNode & {
      length?: number
      width?: number
      height?: number
      material?: { properties?: { color?: string } }
      metadata?: Record<string, unknown>
    }

    expect(armVisual.length).toBe(0.2)
    expect(armVisual.width).toBe(0.3)
    expect(armVisual.height).toBe(1)
    expect(armVisual.material?.properties?.color).toBe('#cc1a0d')
    expect(armVisual.metadata?.disablePrimitiveBatch).toBe(true)
  })

  test('maps compound URDF RPY rotations through the editor coordinate basis', () => {
    const compoundRpyModel: ArticraftModelData = {
      ...model,
      links: [
        {
          name: 'root',
          visuals: [
            {
              geometry: { type: 'cylinder', params: { radius: 0.02, length: 0.4 } },
              origin: { xyz: [0, 0, 0], rpy: [0, Math.PI / 2, Math.PI / 2] },
            },
          ],
        },
      ],
      joints: [],
    }

    const converted = convertToSceneNodes(compoundRpyModel, { articulationMode: true })
    const visual = converted.nodes.find((node) => node.name === 'root_visual') as AnyNode & {
      rotation?: [number, number, number]
    }

    expectVecClose(visual.rotation, [-Math.PI / 2, Math.PI / 2, 0])
  })

  test('keeps sub-centimeter Articraft rods by clamping them to Pascal primitive limits', () => {
    const fineRodModel: ArticraftModelData = {
      ...model,
      links: [
        {
          name: 'root',
          visuals: [
            {
              geometry: { type: 'cylinder', params: { radius: 0.0055, length: 0.18 } },
              origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
            },
          ],
        },
      ],
      joints: [],
    }

    const converted = convertToSceneNodes(fineRodModel, { articulationMode: true })
    const visual = converted.nodes.find((node) => node.name === 'root_visual') as AnyNode & {
      radius?: number
      height?: number
    }

    expect(visual).toBeDefined()
    expect(visual.type).toBe('cylinder')
    expect(visual.radius).toBe(0.01)
    expect(visual.height).toBe(0.18)
  })
})
