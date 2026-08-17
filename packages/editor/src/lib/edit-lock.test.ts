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

function def(
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
      icon: { kind: 'iconify', name: 'lucide:square' },
      ...(paletteSection ? { paletteSection } : {}),
    },
  } as AnyNodeDefinition
}

const RACK = 'n_rack' as AnyNodeId
const WALL = 'n_wall' as AnyNodeId
const ROUTE = 'n_route' as AnyNodeId

beforeEach(() => {
  nodeRegistry._reset()
  registerNode(def('warehouse:pallet-rack', 'furnish'))
  registerNode(def('wall', 'structure', 'structure'))
  registerNode(def('route', 'site', 'site'))
  useScene.setState({
    nodes: {
      [RACK]: { id: RACK, type: 'warehouse:pallet-rack' },
      [WALL]: { id: WALL, type: 'wall' },
      [ROUTE]: { id: ROUTE, type: 'route' },
    },
  } as never)
  useViewer.setState({ sceneLocked: false, lockedCategories: new Set() })
})

afterEach(() => {
  nodeRegistry._reset()
  useViewer.setState({ sceneLocked: false, lockedCategories: new Set() })
})

describe('edit-lock delete gating', () => {
  test('nothing locked → every id stays deletable', () => {
    expect(filterEditableIds([RACK, WALL])).toEqual([RACK, WALL])
    expect(isNodeIdEditLocked(RACK)).toBe(false)
  })

  test('a locked category is dropped from the delete set, others survive', () => {
    useViewer.getState().setCategoryLocked('furnish', true)

    expect(isNodeIdEditLocked(RACK)).toBe(true)
    expect(isNodeIdEditLocked(WALL)).toBe(false)
    expect(filterEditableIds([RACK, WALL])).toEqual([WALL])
  })

  test('scene lock drops everything', () => {
    useViewer.getState().setSceneLocked(true)

    expect(filterEditableIds([RACK, WALL, ROUTE])).toEqual([])
    expect(isNodeEditLocked({ id: RACK, type: 'warehouse:pallet-rack' } as never)).toBe(true)
    expect(isNodeEditLocked({ id: WALL, type: 'wall' } as never)).toBe(true)
  })
})

// filterEditableIds is the shared filter behind Cut's root set (group-actions),
// the command-palette delete, and every move / rotate participant list (3D +
// 2D floorplan). These assert the mixed-set semantics those paths depend on.
describe('edit-lock cut / move / rotate participant filter', () => {
  test('a mixed root/participant set keeps only the unlocked members', () => {
    useViewer.getState().setCategoryLocked('furnish', true)

    // e.g. a Cut whose promoted roots span a locked rack + an unlocked wall + route:
    // only the locked rack is withheld from the delete / move set.
    expect(filterEditableIds([RACK, WALL, ROUTE])).toEqual([WALL, ROUTE])
  })

  test('locking two categories withholds both, leaving the third editable', () => {
    useViewer.getState().setCategoryLocked('furnish', true)
    useViewer.getState().setCategoryLocked('site', true)

    expect(filterEditableIds([RACK, WALL, ROUTE])).toEqual([WALL])
  })

  test('order is preserved for the surviving members', () => {
    useViewer.getState().setCategoryLocked('structure', true)

    expect(filterEditableIds([ROUTE, WALL, RACK])).toEqual([ROUTE, RACK])
  })
})
