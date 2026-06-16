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
        },
      ],
    },
    {
      name: 'arm',
      visuals: [
        {
          geometry: { type: 'box', params: { length: 0.2, width: 0.2, height: 1 } },
          origin: { xyz: [0.5, 0, 0.5], rpy: [0, 0, 0] },
        },
      ],
    },
    {
      name: 'base',
      visuals: [
        {
          geometry: { type: 'cylinder', params: { radius: 0.3, length: 0.2 } },
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
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

describe('Articraft scene converter', () => {
  test('keeps joint metadata when child links appear before parents', () => {
    const converted = convertToSceneNodes(model, { articulationMode: true })
    const armId = converted.nodeIdByLink.get('arm')
    const clawId = converted.nodeIdByLink.get('claw')

    expect(armId).toBeDefined()
    expect(clawId).toBeDefined()
    expect(converted.jointMetadata[armId!]?.jointName).toBe('base_to_arm')
    expect(converted.jointMetadata[clawId!]?.jointName).toBe('arm_to_claw')
  })

  test('creates parents before children and reports the asset root node', () => {
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

    const base = [...created.values()].find(({ node }) => node.name === 'base')
    const arm = [...created.values()].find(({ node }) => node.name === 'arm')
    const claw = [...created.values()].find(({ node }) => node.name === 'claw')

    expect(base?.parentId).toBe(externalParentId)
    expect(arm?.parentId).toBe(base?.node.id)
    expect(claw?.parentId).toBe(arm?.node.id)
    expect(result.rootNodeIds).toEqual([base?.node.id])
  })

  test('applies rootPosition to converted root nodes only', () => {
    const created = new Map<AnyNodeId, { node: AnyNode; parentId?: AnyNodeId }>()

    createModelNodes(
      model,
      (node, parentId) => {
        created.set(node.id, { node, parentId })
        return node.id
      },
      { articulationMode: true, parentId: 'level-1' as AnyNodeId, rootPosition: [10, 2, -3] },
    )

    const base = [...created.values()].find(({ node }) => node.name === 'base')
    const arm = [...created.values()].find(({ node }) => node.name === 'arm')

    expect(base?.node.position).toEqual([10, 2, -3])
    expect(arm?.node.position).toEqual([0.5, 0.5, -0])
  })

})
