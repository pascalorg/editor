import { describe, expect, test } from 'bun:test'
import { createBoxCustomMeshTopology } from '@pascal-app/core'
import {
  assignCustomMeshMaterial,
  customMeshMaterialSelection,
  customMeshMaterialSlotIds,
  removeUnusedCustomMeshMaterialSlots,
  selectCustomMeshFacesByMaterialSlot,
  unusedCustomMeshMaterialSlotIds,
} from './material-slots'

describe('custom mesh material slots', () => {
  test('lists body, persisted, and face-referenced slots in stable order', () => {
    const topology = createBoxCustomMeshTopology()
    topology.faces[0] = { ...topology.faces[0], materialSlot: 'orphaned' }

    expect(
      customMeshMaterialSlotIds(topology, {
        accent: 'scene:accent',
        body: 'scene:body',
      }),
    ).toEqual(['body', 'accent', 'orphaned'])
  })

  test('reports single and mixed face assignments using the active face', () => {
    const topology = createBoxCustomMeshTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }

    expect(customMeshMaterialSelection(topology, ['f-bottom'], 'f-bottom')).toEqual({
      kind: 'single',
      slotId: 'body',
      activeSlotId: 'body',
    })
    expect(customMeshMaterialSelection(topology, ['f-bottom', 'f-top'], 'f-top')).toEqual({
      kind: 'mixed',
      activeSlotId: 'accent',
    })
    expect(customMeshMaterialSelection(topology, [], null)).toEqual({
      kind: 'empty',
      activeSlotId: null,
    })
  })

  test('selects and deselects every face assigned to a slot without replacing other selection', () => {
    const topology = createBoxCustomMeshTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }
    topology.faces[2] = { ...topology.faces[2], materialSlot: 'accent' }

    expect(selectCustomMeshFacesByMaterialSlot(topology, ['f-bottom'], 'accent', 'select')).toEqual(
      ['f-bottom', 'f-top', 'f-front'],
    )
    expect(
      selectCustomMeshFacesByMaterialSlot(
        topology,
        ['f-bottom', 'f-top', 'f-front'],
        'accent',
        'deselect',
      ),
    ).toEqual(['f-bottom'])
  })

  test('removes only unused object slots while preserving body and face references', () => {
    const topology = createBoxCustomMeshTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }
    const slots = {
      body: 'scene:body',
      accent: 'scene:accent',
      discarded: 'scene:shared',
    }

    expect(unusedCustomMeshMaterialSlotIds(topology, slots)).toEqual(['discarded'])
    expect(removeUnusedCustomMeshMaterialSlots(topology, slots)).toEqual({
      slots: {
        body: 'scene:body',
        accent: 'scene:accent',
      },
      removedSlotIds: ['discarded'],
      changed: true,
    })
    expect(topology.faces[1].materialSlot).toBe('accent')
  })

  test('keeps slot identity on cleanup no-op and collapses an empty mapping', () => {
    const topology = createBoxCustomMeshTopology()
    const slots = { body: 'scene:body' }
    const noOp = removeUnusedCustomMeshMaterialSlots(topology, slots)

    expect(noOp).toEqual({ slots, removedSlotIds: [], changed: false })
    expect(noOp.slots).toBe(slots)
    expect(removeUnusedCustomMeshMaterialSlots(topology, { discarded: 'scene:shared' })).toEqual({
      slots: undefined,
      removedSlotIds: ['discarded'],
      changed: true,
    })
  })

  test('assigns an existing slot to all selected faces in one immutable result', () => {
    const topology = createBoxCustomMeshTopology()
    const slots = { accent: 'scene:accent' }
    const result = assignCustomMeshMaterial(topology, slots, ['f-bottom', 'f-top'], {
      kind: 'slot',
      slotId: 'accent',
    })

    expect(result.changed).toBe(true)
    expect(result.slots).toBe(slots)
    expect(result.topology.faces.slice(0, 2).map((face) => face.materialSlot)).toEqual([
      'accent',
      'accent',
    ])
    expect(topology.faces[0].materialSlot).toBe('body')
  })

  test('reuses a slot by material identity and allocates only when needed', () => {
    const topology = createBoxCustomMeshTopology()
    const existing = assignCustomMeshMaterial(topology, { accent: 'scene:accent' }, ['f-top'], {
      kind: 'material',
      materialRef: 'scene:accent',
    })
    expect(existing.slotId).toBe('accent')
    expect(existing.slots).toEqual({ accent: 'scene:accent' })

    const added = assignCustomMeshMaterial(existing.topology, existing.slots, ['f-front'], {
      kind: 'material',
      materialRef: 'library:oak',
    })
    expect(added.slotId).toBe('material-1')
    expect(added.slots).toEqual({
      accent: 'scene:accent',
      'material-1': 'library:oak',
    })
  })

  test('prefers the canonical body slot when duplicate bindings already exist', () => {
    const topology = createBoxCustomMeshTopology()
    const result = assignCustomMeshMaterial(
      topology,
      { accent: 'scene:shared', body: 'scene:shared' },
      ['f-top'],
      { kind: 'material', materialRef: 'scene:shared' },
    )

    expect(result.slotId).toBe('body')
    expect(result.changed).toBe(false)
  })

  test('does not allocate or mutate for an empty or no-op assignment', () => {
    const topology = createBoxCustomMeshTopology()
    const empty = assignCustomMeshMaterial(topology, undefined, [], {
      kind: 'material',
      materialRef: 'scene:accent',
    })
    expect(empty).toEqual({
      topology,
      slots: undefined,
      slotId: 'material-1',
      changed: false,
    })

    const noOp = assignCustomMeshMaterial(topology, undefined, ['f-top'], {
      kind: 'slot',
      slotId: 'body',
    })
    expect(noOp.changed).toBe(false)
    expect(noOp.topology).toBe(topology)
  })
})
