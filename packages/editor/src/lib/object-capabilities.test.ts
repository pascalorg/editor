import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { AssemblyNode, BoxNode, TankNode } from '@pascal-app/core/schema'
import {
  buildSelectionCapabilityContext,
  formatSelectionCapabilities,
  resolveObjectCapabilities,
  resolveSelectionCapabilities,
} from './object-capabilities'

const ASSEMBLY_ID = 'assembly_storage_tank' as AnyNodeId

function node(input: Record<string, unknown>): AnyNode {
  return {
    object: 'node',
    visible: true,
    parentId: null,
    metadata: {},
    ...input,
  } as unknown as AnyNode
}

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
      stationId: 'crude_storage',
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
      dynamicBindings: [
        {
          id: 'semantic_live_assembly_storage_tank_tank-level',
          type: 'level',
          path: 'refinery.tank.level',
        },
      ],
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
  const feedRoute = {
    id: 'pipe_feed',
    type: 'pipe',
    metadata: {
      fromStationId: 'feed_pump',
      fromPortId: 'outlet',
      toStationId: 'crude_storage',
      toPortId: 'inlet',
      medium: 'crude',
    },
  } as AnyNode

  return {
    [assembly.id]: assembly,
    [shell.id]: shell,
    [liquid.id]: liquid,
    [feedRoute.id]: feedRoute,
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
    expect(capabilitiesOf(profile!).has('data-binding')).toBe(true)
    expect(profile?.dataBindings).toMatchObject([
      {
        id: 'semantic_live_assembly_storage_tank_tank-level',
        type: 'level',
        path: 'refinery.tank.level',
      },
    ])
    expect(profile?.editableParts.map((part) => part.semanticRole).sort()).toEqual([
      'liquid_volume',
      'vessel_shell',
    ])
    expect(profile?.ports.map((port) => port.id)).toEqual(['inlet', 'outlet'])
    expect(profile?.ports.find((port) => port.id === 'inlet')?.connections).toMatchObject([
      {
        nodeId: 'pipe_feed',
        direction: 'incoming',
        connectedStationId: 'feed_pump',
        connectedPortId: 'outlet',
        medium: 'crude',
      },
    ])
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

  test('reads standard asset source metadata for image-generated assets', () => {
    const item = node({
      id: 'item_image_pump',
      type: 'item',
      name: 'Image pump',
      asset: {
        id: 'image-to-3d-pump',
        category: 'equipment',
        name: 'Image pump',
        thumbnail: '/items/image-to-3d-pump/thumbnail.png',
        src: '/items/image-to-3d-pump/model.glb',
      },
      metadata: {
        assetSource: {
          kind: 'image-to-3d',
          assetId: 'image-to-3d-pump',
          provider: 'fal',
          prompt: 'make a pump from this image',
        },
        semanticType: 'pump',
        equipmentContract: {
          profileId: 'generated-model.pump',
          equipmentFamily: 'pump',
          primarySemanticRole: 'pump_body',
          ports: [
            { id: 'inlet', medium: 'fluid', side: 'west' },
            { id: 'outlet', medium: 'fluid', side: 'east' },
          ],
        },
      },
    })

    const profile = resolveObjectCapabilities(item)

    expect(sourceSet(profile!).has('image-to-3d')).toBe(true)
    expect(sourceSet(profile!).has('semantic-assembly')).toBe(true)
    expect(sourceSet(profile!).has('catalog-item')).toBe(true)
    expect(capabilitiesOf(profile!).has('catalog.asset')).toBe(true)
    expect(capabilitiesOf(profile!).has('ports')).toBe(true)
    expect(profile?.equipmentFamily).toBe('pump')
    expect(profile?.profileId).toBe('generated-model.pump')
  })

  test('formats selected capabilities for AI-safe edit context', () => {
    const nodes = semanticTankNodes()
    const context = buildSelectionCapabilityContext({
      nodes,
      selectedIds: [ASSEMBLY_ID],
    })

    expect(context?.profiles).toHaveLength(1)
    expect(context?.summary).toContain('Selected object capability profiles:')
    expect(context?.summary).toContain('Crude tank A [assembly] id=assembly_storage_tank')
    expect(context?.summary).toContain('semantic.params:editable@assembly')
    expect(context?.summary).toContain('vessel_shell#box_shell')
    expect(context?.summary).toContain('liquid_volume#box_liquid')
    expect(context?.summary).toContain('inlet(crude/west)')
    expect(context?.summary).toContain('incoming->feed_pump:outlet')
    expect(context?.summary).toContain('level<-refinery.tank.level')
    expect(context?.summary).toContain('Prefer editable semantic parts/params')
  })

  test('empty selected capability formatting is explicit', () => {
    expect(formatSelectionCapabilities([])).toBe('No selected object capability profile.')
  })
})
