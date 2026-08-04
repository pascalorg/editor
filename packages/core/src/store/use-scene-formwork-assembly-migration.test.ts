import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, FormworkAssemblyNode } from '../schema'
import useScene from './use-scene'

type WallNode = Extract<AnyNode, { type: 'wall' }>

function legacyScene(formwork: Record<string, unknown> = {}): Record<string, AnyNode> {
  return {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_test'],
    },
    level_test: {
      object: 'node',
      id: 'level_test',
      type: 'level',
      parentId: 'site_test',
      visible: true,
      metadata: {},
      children: ['wall_test'],
      level: 0,
    },
    wall_test: {
      object: 'node',
      id: 'wall_test',
      type: 'wall',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: ['formwork-system_abc'],
      start: [0, 0],
      end: [4, 0],
      formworkType: 'wall-panel',
    },
    'formwork-system_abc': {
      object: 'node',
      id: 'formwork-system_abc',
      type: 'formwork-system',
      parentId: 'wall_test',
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      panelWidth: 0.75,
      ...formwork,
    },
  } as unknown as Record<string, AnyNode>
}

function resetScene() {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
  } as never)
  useScene.temporal.getState().clear()
}

describe('formwork-system → formwork-assembly migration', () => {
  beforeEach(resetScene)

  test('renames the kind, rewrites the id, and repoints the host wall', () => {
    useScene.getState().setScene(legacyScene(), ['site_test'] as never)

    const nodes = useScene.getState().nodes
    expect(nodes['formwork-system_abc' as keyof typeof nodes]).toBeUndefined()

    const assembly = nodes['formwork-assembly_abc' as keyof typeof nodes] as FormworkAssemblyNode
    expect(assembly).toBeDefined()
    expect(assembly.type).toBe('formwork-assembly')
    expect(assembly.id).toBe('formwork-assembly_abc')
    expect(assembly.parentId).toBe('wall_test')
    // Fields that already existed survive the rename.
    expect(assembly.panelWidth).toBe(0.75)

    const wall = nodes.wall_test as WallNode
    expect(wall.children).toEqual(['formwork-assembly_abc'])
  })

  test('defaults describe what the legacy kind actually was: one shutter, one lift', () => {
    useScene.getState().setScene(legacyScene(), ['site_test'] as never)

    const assembly = useScene.getState().nodes[
      'formwork-assembly_abc' as never
    ] as FormworkAssemblyNode
    expect(assembly.segmentIndex).toBe(0)
    expect(assembly.liftIndex).toBe(0)
    expect(assembly.fillerPosition).toBe('middle')
    expect(assembly.avoidedPanelIds).toEqual([])
    expect(assembly.designOverrides).toEqual({})
    expect(assembly.partOverrides).toEqual({})
  })

  // `setScene` does not run the schema over migrated nodes — validation happens
  // at save (`save-scene.ts`) and on patch application. A migration that
  // produced an unparseable node would therefore load fine and fail later, so
  // the assertion has to be explicit here.
  test('the migrated node satisfies its own schema', () => {
    useScene.getState().setScene(legacyScene(), ['site_test'] as never)

    const assembly = useScene.getState().nodes['formwork-assembly_abc' as never]
    const parsed = FormworkAssemblyNode.safeParse(assembly)
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })
})
