import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { AssemblyNode } from '@pascal-app/core/schema'
import { FIXED_FACTORY_LIVE_DATA_PATHS } from './fixed-live-data-source'
import type { ObjectCapabilityProfile } from './object-capabilities'
import {
  buildSemanticLiveDataBinding,
  defaultSemanticLiveDataPath,
  semanticLiveDataBindingTargets,
  upsertSemanticLiveDataBinding,
} from './semantic-live-data-bindings'

const tankProfile: ObjectCapabilityProfile = {
  nodeId: 'assembly_tank',
  nodeType: 'assembly',
  label: 'Product tank farm',
  sources: ['manual', 'semantic-assembly'],
  capabilities: [],
  editableParts: [],
  ports: [],
  dataBindings: [],
  recipeId: 'factory:storage-tank',
  profileId: 'refinery.product_storage_tank',
  equipmentFamily: 'tank',
}

describe('semantic live data bindings', () => {
  test('suggests a tank level binding from fixed live data fields', () => {
    const target = semanticLiveDataBindingTargets(tankProfile)[0]

    expect(target).toMatchObject({
      id: 'tank-level',
      type: 'level',
      semanticType: 'tank',
    })
    expect(defaultSemanticLiveDataPath(target!, FIXED_FACTORY_LIVE_DATA_PATHS)).toBe(
      'refinery.tank.level',
    )
  })

  test('builds stable dynamic binding ids for semantic targets', () => {
    const target = semanticLiveDataBindingTargets(tankProfile)[0]!
    const binding = buildSemanticLiveDataBinding({
      profile: tankProfile,
      target,
      path: 'refinery.tank.level',
    })

    expect(binding).toMatchObject({
      id: 'semantic_live_assembly_tank_tank-level',
      type: 'level',
      path: 'refinery.tank.level',
      inputRange: [0, 100],
      outputRange: [0, 1],
    })
  })

  test('upserts metadata dynamic bindings without duplicating the semantic target', () => {
    const target = semanticLiveDataBindingTargets(tankProfile)[0]!
    const node = AssemblyNode.parse({
      id: 'assembly_tank',
      type: 'assembly',
      metadata: {
        dynamicBindings: [
          buildSemanticLiveDataBinding({
            profile: tankProfile,
            target,
            path: 'machine.temperature',
          }),
        ],
      },
    }) as AnyNode

    const patch = upsertSemanticLiveDataBinding({
      node,
      profile: tankProfile,
      target,
      path: 'refinery.tank.level',
    })
    const metadata = patch.metadata as Record<string, unknown>
    const dynamicBindings = metadata.dynamicBindings as Array<Record<string, unknown>>

    expect(metadata.semanticType).toBe('tank')
    expect(metadata.liveDataBindingSource).toBe('fixed-factory-demo')
    expect(dynamicBindings).toHaveLength(1)
    expect(dynamicBindings[0]).toMatchObject({
      id: 'semantic_live_assembly_tank_tank-level',
      type: 'level',
      path: 'refinery.tank.level',
    })
  })
})
