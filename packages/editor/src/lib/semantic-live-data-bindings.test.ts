import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { AssemblyNode } from '@pascal-app/core/schema'
import { FIXED_FACTORY_LIVE_DATA_PATHS } from './fixed-live-data-source'
import type { ObjectCapabilityProfile } from './object-capabilities'
import {
  buildSemanticLiveDataBinding,
  defaultSemanticLiveDataPath,
  formatSemanticLiveDataBindingTargets,
  planSemanticLiveDataBinding,
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

const pumpProfile: ObjectCapabilityProfile = {
  nodeId: 'assembly_pump',
  nodeType: 'assembly',
  label: 'Crude transfer pump',
  sources: ['semantic-assembly'],
  capabilities: [],
  editableParts: [],
  ports: [],
  dataBindings: [],
  recipeId: 'factory:pump',
  profileId: 'refinery.transfer_pump',
  equipmentFamily: 'pump',
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

  test('formats AI-readable binding targets with default paths', () => {
    const summary = formatSemanticLiveDataBindingTargets({
      profiles: [tankProfile],
      paths: FIXED_FACTORY_LIVE_DATA_PATHS,
    })

    expect(summary).toContain('Semantic live data binding targets:')
    expect(summary).toContain('assembly_tank: tank-level')
    expect(summary).toContain('defaultPath=refinery.tank.level')
  })

  test('plans a tank level binding from a natural language request', () => {
    const node = AssemblyNode.parse({
      id: 'assembly_tank',
      type: 'assembly',
    }) as AnyNode
    const plan = planSemanticLiveDataBinding({
      prompt: '把选中储罐的液位绑定到炼油厂 tank level 数据',
      profiles: [tankProfile],
      nodes: { assembly_tank: node },
      paths: FIXED_FACTORY_LIVE_DATA_PATHS,
    })

    expect(plan).toMatchObject({
      nodeId: 'assembly_tank',
      path: 'refinery.tank.level',
      target: { id: 'tank-level' },
    })
    expect((plan?.patch.metadata as Record<string, unknown>).dynamicBindings).toMatchObject([
      {
        id: 'semantic_live_assembly_tank_tank-level',
        type: 'level',
        path: 'refinery.tank.level',
      },
    ])
  })

  test('plans pump flow binding to the refinery flow field', () => {
    const node = AssemblyNode.parse({
      id: 'assembly_pump',
      type: 'assembly',
    }) as AnyNode
    const plan = planSemanticLiveDataBinding({
      prompt: '把泵的流量绑定到 refinery crude flowRate',
      profiles: [pumpProfile],
      nodes: { assembly_pump: node },
      paths: FIXED_FACTORY_LIVE_DATA_PATHS,
    })

    expect(plan).toMatchObject({
      nodeId: 'assembly_pump',
      path: 'refinery.crude.flowRate',
      target: { id: 'pump-flow', type: 'flow' },
    })
  })

  test('plans alarm pulse binding for selected equipment', () => {
    const node = AssemblyNode.parse({
      id: 'assembly_tank',
      type: 'assembly',
    }) as AnyNode
    const plan = planSemanticLiveDataBinding({
      prompt: '报警时让选中设备脉冲闪烁',
      profiles: [tankProfile],
      nodes: { assembly_tank: node },
      paths: FIXED_FACTORY_LIVE_DATA_PATHS,
    })

    expect(plan).toMatchObject({
      nodeId: 'assembly_tank',
      path: 'alarm.count',
      target: { id: 'alarm-pulse', type: 'scale' },
    })
    expect((plan?.patch.metadata as Record<string, unknown>).dynamicBindings).toMatchObject([
      {
        id: 'semantic_live_assembly_tank_alarm-pulse',
        type: 'scale',
        path: 'alarm.count',
        scaleEffect: 'alarmPulse',
      },
    ])
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
