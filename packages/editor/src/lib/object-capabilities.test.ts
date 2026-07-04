import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { AssemblyNode, BoxNode, TankNode } from '@pascal-app/core/schema'
import { resolveObjectCapabilities, resolveSelectionCapabilities } from './object-capabilities'

const ASSEMBLY_ID = 'assembly_storage_tank' as AnyNodeId

function capabilitiesOf(profile: NonNullable<ReturnType<typeof resolveObjectCapabilities>>) {
  return new Set(profile.capabilities.map((capability) => capability.id))
}

function sourceSet(profile: NonNullable<ReturnType<typeof resolveObjectCapabilities>>) {
  return new Set(profile.sources)
}

function semanticTankNodes() {
  const assembly = AssemblyNode.parse({
    id: ASSEMBLY_ID,
    type: 'assembly',
    name: 'Crude tank A',
    children: ['box_shell', 'box_liquid'],
    metadata: {
      processDomain: 'refinery',
      equipmentAssembly: {
        kind: 'semantic-assembly',
        recipeId: 'factory:storage-tank',
        profileId: 'refinery.crude_storage_tank',
        equipmentFamily: 'tank',
        editableParams: [{ key: 'liquidLevel', kind: 'number' }],
        editablePartRoles: ['vessel_shell', 'liquid_volume'],
        ports: [
          { id: 'inlet', medium: 'crude', side: 'west' },
          { id: 'outlet', medium: 'crude', side: 'east' },
        ],
      },
    },
  })
  const shell = BoxNode.parse({
    id: 'box_shell',
    type: 'box',
    parentId: ASSEMBLY_ID,
    metadata: {
      generatedBy: 'ai-geometry',
      semanticRole: 'vessel_shell',
      sourcePartKind: 'cylindrical_tank',
    },
  })
  const liquid = BoxNode.parse({
    id: 'box_liquid',
    type: 'box',
    parentId: ASSEMBLY_ID,
    metadata: {
      semanticRole: 'liquid_volume',
      sourcePartKind: 'liquid_fill',
    },
  })

  return {
    [assembly.id]: assembly,
    [shell.id]: shell,
    [liquid.id]: liquid,
  } as Record<string, AnyNode>
}

describe('object capabilities', () => {
  test('describes built-in tank controls for inspector and AI use', () => {
    const tank = TankNode.parse({
      id: 'tank_vertical',
      type: 'tank',
      kind: 'vertical',
      liquidLevel: 0.6,
    })

    const profile = resolveObjectCapabilities(tank as AnyNode)

    expect(profile?.nodeType).toBe('tank')
    expect(sourceSet(profile!).has('builtin-node')).toBe(true)
    expect(capabilitiesOf(profile!).has('tank.kind')).toBe(true)
    expect(capabilitiesOf(profile!).has('tank.liquidLevel')).toBe(true)
    expect(capabilitiesOf(profile!).has('material.opacity')).toBe(true)
  })

  test('describes semantic assemblies with editable parts, params, and ports', () => {
    const nodes = semanticTankNodes()
    const profile = resolveObjectCapabilities(nodes[ASSEMBLY_ID], nodes)

    expect(profile?.recipeId).toBe('factory:storage-tank')
    expect(profile?.profileId).toBe('refinery.crude_storage_tank')
    expect(profile?.equipmentFamily).toBe('tank')
    expect(sourceSet(profile!).has('semantic-assembly')).toBe(true)
    expect(sourceSet(profile!).has('industry-pack')).toBe(true)
    expect(capabilitiesOf(profile!).has('semantic.parts')).toBe(true)
    expect(capabilitiesOf(profile!).has('semantic.params')).toBe(true)
    expect(capabilitiesOf(profile!).has('ports')).toBe(true)
    expect(profile?.editableParts.map((part) => part.semanticRole).sort()).toEqual([
      'liquid_volume',
      'vessel_shell',
    ])
    expect(profile?.ports.map((port) => port.id)).toEqual(['inlet', 'outlet'])
  })

  test('uses the same resolver for AI selection snapshots', () => {
    const nodes = semanticTankNodes()
    const profiles = resolveSelectionCapabilities({
      nodes,
      selectedIds: [ASSEMBLY_ID, 'box_shell'],
    })

    expect(profiles).toHaveLength(2)
    expect(profiles[0]?.capabilities.some((capability) => capability.id === 'semantic.parts')).toBe(
      true,
    )
    expect(sourceSet(profiles[1]!).has('ai-geometry')).toBe(true)
    expect(profiles[1]?.editableParts[0]?.semanticRole).toBe('vessel_shell')
  })
})
