import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { filterEditableIds, isNodeEditLocked, isNodeIdEditLocked } from './edit-lock'

function makeDef(
  kind: string,
  category: AnyNodeDefinition['category'],
  paletteSection?: 'site' | 'structure' | 'furnish',
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: {} as never,
    category,
    defaults: () => ({}) as never,
    capabilities: {},
    presentation: {
      label: kind,
      icon: { kind: 'iconify', name: 'lucide:box' },
      ...(paletteSection ? { paletteSection } : {}),
    },
  } as AnyNodeDefinition
}

// 21 Warehouse FEM/EN and architectural standard node types
const WAREHOUSE_NODES = [
  { id: 'w_pallet_rack' as AnyNodeId, kind: 'warehouse:pallet-rack', category: 'furnish' },
  { id: 'w_drive_in' as AnyNodeId, kind: 'warehouse:drive-in', category: 'furnish' },
  { id: 'w_cantilever' as AnyNodeId, kind: 'warehouse:cantilever', category: 'furnish' },
  { id: 'w_asrs' as AnyNodeId, kind: 'warehouse:asrs', category: 'furnish' },
  { id: 'w_mezzanine' as AnyNodeId, kind: 'warehouse:mezzanine', category: 'structure' },
  { id: 'w_dock_leveler' as AnyNodeId, kind: 'warehouse:dock-leveler', category: 'structure' },
  { id: 'w_agv_path' as AnyNodeId, kind: 'warehouse:agv-path', category: 'site' },
  { id: 'w_bollard' as AnyNodeId, kind: 'warehouse:bollard', category: 'site' },
  { id: 'w_column_guard' as AnyNodeId, kind: 'warehouse:column-guard', category: 'site' },
  { id: 'w_conveyor' as AnyNodeId, kind: 'warehouse:conveyor', category: 'furnish' },
  { id: 'w_spiral_conveyor' as AnyNodeId, kind: 'warehouse:spiral-conveyor', category: 'furnish' },
  { id: 'w_vlm' as AnyNodeId, kind: 'warehouse:vlm', category: 'furnish' },
  { id: 'w_flow_rack' as AnyNodeId, kind: 'warehouse:flow-rack', category: 'furnish' },
  { id: 'w_push_back' as AnyNodeId, kind: 'warehouse:push-back', category: 'furnish' },
  { id: 'w_shuttle' as AnyNodeId, kind: 'warehouse:shuttle', category: 'furnish' },
  { id: 'w_safety_barrier' as AnyNodeId, kind: 'warehouse:safety-barrier', category: 'site' },
  { id: 'w_pedestrian_gate' as AnyNodeId, kind: 'warehouse:pedestrian-gate', category: 'site' },
  { id: 'w_guardrail' as AnyNodeId, kind: 'warehouse:guardrail', category: 'site' },
  { id: 'w_mesh_deck' as AnyNodeId, kind: 'warehouse:mesh-deck', category: 'furnish' },
  { id: 'w_pallet_flow' as AnyNodeId, kind: 'warehouse:pallet-flow', category: 'furnish' },
  { id: 'w_wire_deck' as AnyNodeId, kind: 'warehouse:wire-deck', category: 'furnish' },
] as const

describe('Edit-Lock Coverage Guard Tests (21 Warehouse FEM/EN Standard Kinds)', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    const sceneNodes: Record<string, { id: string; type: string }> = {}

    for (const item of WAREHOUSE_NODES) {
      registerNode(makeDef(item.kind, item.category as AnyNodeDefinition['category']))
      sceneNodes[item.id] = { id: item.id, type: item.kind }
    }

    useScene.setState({ nodes: sceneNodes } as never)
    useViewer.setState({ sceneLocked: false, lockedCategories: new Set() })
  })

  afterEach(() => {
    nodeRegistry._reset()
    useViewer.setState({ sceneLocked: false, lockedCategories: new Set() })
  })

  test('Guard 1: Standard Pallet Rack is editable when unlocked and locked under furnish category lock', () => {
    const rack = WAREHOUSE_NODES[0]
    expect(isNodeIdEditLocked(rack.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(rack.id)).toBe(true)
  })

  test('Guard 2: Drive-In Rack respects furnish category lock', () => {
    const driveIn = WAREHOUSE_NODES[1]
    expect(isNodeIdEditLocked(driveIn.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(driveIn.id)).toBe(true)
  })

  test('Guard 3: Cantilever Rack respects furnish category lock', () => {
    const cantilever = WAREHOUSE_NODES[2]
    expect(isNodeIdEditLocked(cantilever.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(cantilever.id)).toBe(true)
  })

  test('Guard 4: ASRS Stacker Crane respects furnish category lock', () => {
    const asrs = WAREHOUSE_NODES[3]
    expect(isNodeIdEditLocked(asrs.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(asrs.id)).toBe(true)
  })

  test('Guard 5: Mezzanine Platform respects structure category lock', () => {
    const mezzanine = WAREHOUSE_NODES[4]
    expect(isNodeIdEditLocked(mezzanine.id)).toBe(false)
    useViewer.getState().setCategoryLocked('structure', true)
    expect(isNodeIdEditLocked(mezzanine.id)).toBe(true)
  })

  test('Guard 6: Dock Leveler respects structure category lock', () => {
    const dockLeveler = WAREHOUSE_NODES[5]
    expect(isNodeIdEditLocked(dockLeveler.id)).toBe(false)
    useViewer.getState().setCategoryLocked('structure', true)
    expect(isNodeIdEditLocked(dockLeveler.id)).toBe(true)
  })

  test('Guard 7: AGV Guide Path respects site category lock', () => {
    const agv = WAREHOUSE_NODES[6]
    expect(isNodeIdEditLocked(agv.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(agv.id)).toBe(true)
  })

  test('Guard 8: Safety Bollard respects site category lock', () => {
    const bollard = WAREHOUSE_NODES[7]
    expect(isNodeIdEditLocked(bollard.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(bollard.id)).toBe(true)
  })

  test('Guard 9: Column Protector respects site category lock', () => {
    const colGuard = WAREHOUSE_NODES[8]
    expect(isNodeIdEditLocked(colGuard.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(colGuard.id)).toBe(true)
  })

  test('Guard 10: Conveyor Line respects furnish category lock', () => {
    const conveyor = WAREHOUSE_NODES[9]
    expect(isNodeIdEditLocked(conveyor.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(conveyor.id)).toBe(true)
  })

  test('Guard 11: Spiral Conveyor respects furnish category lock', () => {
    const spiral = WAREHOUSE_NODES[10]
    expect(isNodeIdEditLocked(spiral.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(spiral.id)).toBe(true)
  })

  test('Guard 12: Vertical Lift Module (VLM) respects furnish category lock', () => {
    const vlm = WAREHOUSE_NODES[11]
    expect(isNodeIdEditLocked(vlm.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(vlm.id)).toBe(true)
  })

  test('Guard 13: Flow Rack respects furnish category lock', () => {
    const flowRack = WAREHOUSE_NODES[12]
    expect(isNodeIdEditLocked(flowRack.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(flowRack.id)).toBe(true)
  })

  test('Guard 14: Push-Back Rack respects furnish category lock', () => {
    const pushBack = WAREHOUSE_NODES[13]
    expect(isNodeIdEditLocked(pushBack.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(pushBack.id)).toBe(true)
  })

  test('Guard 15: Pallet Shuttle System respects furnish category lock', () => {
    const shuttle = WAREHOUSE_NODES[14]
    expect(isNodeIdEditLocked(shuttle.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(shuttle.id)).toBe(true)
  })

  test('Guard 16: Safety Barrier respects site category lock', () => {
    const barrier = WAREHOUSE_NODES[15]
    expect(isNodeIdEditLocked(barrier.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(barrier.id)).toBe(true)
  })

  test('Guard 17: Pedestrian Safety Gate respects site category lock', () => {
    const gate = WAREHOUSE_NODES[16]
    expect(isNodeIdEditLocked(gate.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(gate.id)).toBe(true)
  })

  test('Guard 18: Guardrail respects site category lock', () => {
    const guardrail = WAREHOUSE_NODES[17]
    expect(isNodeIdEditLocked(guardrail.id)).toBe(false)
    useViewer.getState().setCategoryLocked('site', true)
    expect(isNodeIdEditLocked(guardrail.id)).toBe(true)
  })

  test('Guard 19: Mesh Decking respects furnish category lock', () => {
    const meshDeck = WAREHOUSE_NODES[18]
    expect(isNodeIdEditLocked(meshDeck.id)).toBe(false)
    useViewer.getState().setCategoryLocked('furnish', true)
    expect(isNodeIdEditLocked(meshDeck.id)).toBe(true)
  })

  test('Guard 20: Scene-wide lock locks all 21 warehouse node types at once', () => {
    useViewer.getState().setSceneLocked(true)
    for (const item of WAREHOUSE_NODES) {
      expect(isNodeIdEditLocked(item.id)).toBe(true)
    }
    const allIds = WAREHOUSE_NODES.map((n) => n.id)
    expect(filterEditableIds(allIds)).toEqual([])
  })

  test('Guard 21: Multi-category selective filter retains exact ordered un-locked subset across warehouse kinds', () => {
    useViewer.getState().setCategoryLocked('furnish', true)
    useViewer.getState().setCategoryLocked('site', true)

    // Only structure nodes (Mezzanine, Dock Leveler) should survive
    const allIds = WAREHOUSE_NODES.map((n) => n.id)
    const editable = filterEditableIds(allIds)
    expect(editable).toEqual(['w_mezzanine' as AnyNodeId, 'w_dock_leveler' as AnyNodeId])
  })
})
