import { describe, expect, test } from 'bun:test'
import { createBoxBlockTopology } from '@pascal-app/core'
import {
  assignBlockMaterial,
  blockMaterialSelection,
  blockMaterialSlotIds,
  createAssignedBlockMaterialSlot,
  createBlockMaterialSlot,
  removeBlockMaterialSlot,
  renameBlockMaterialSlot,
  setBlockMaterialSlot,
  unpaintedBlockMaterialSlotIds,
} from './material-slots'

describe('block material slots', () => {
  test('lists body, persisted, and face-referenced slots in stable order', () => {
    const topology = createBoxBlockTopology()
    topology.faces[0] = { ...topology.faces[0], materialSlot: 'orphaned' }

    expect(
      blockMaterialSlotIds(topology, {
        accent: 'scene:accent',
        body: 'scene:body',
      }),
    ).toEqual(['body', 'accent', 'orphaned'])
  })

  test('creates and renames an unbound slot independently from its material', () => {
    const topology = createBoxBlockTopology()
    const created = createBlockMaterialSlot(topology, {}, { body: 'Body' })

    expect(created).toEqual({
      slotId: 'slot-1',
      slotNames: { body: 'Body', 'slot-1': 'Slot 1' },
    })
    expect(
      renameBlockMaterialSlot(topology, {}, created.slotNames, created.slotId, ' Trim '),
    ).toEqual({ body: 'Body', 'slot-1': 'Trim' })
  })

  test('creates a slot and assigns it to the selected faces in one operation', () => {
    const topology = createBoxBlockTopology()
    const result = createAssignedBlockMaterialSlot(
      topology,
      undefined,
      { body: 'Body' },
      ['f-top', 'f-front'],
      'scene:block-accent',
    )

    expect(result.changed).toBe(true)
    expect(result.slotId).toBe('slot-1')
    expect(result.slotNames).toEqual({ body: 'Body', 'slot-1': 'Slot 1' })
    expect(result.slots).toEqual({ 'slot-1': 'scene:block-accent' })
    expect(result.topology.faces.map((face) => face.materialSlot)).toEqual([
      'body',
      'slot-1',
      'slot-1',
      'body',
      'body',
      'body',
    ])
  })

  test('does not create an empty slot when no faces are selected', () => {
    const topology = createBoxBlockTopology()
    const slotNames = { body: 'Body' }
    const result = createAssignedBlockMaterialSlot(
      topology,
      undefined,
      slotNames,
      [],
      'scene:block-accent',
    )

    expect(result.changed).toBe(false)
    expect(result.topology).toBe(topology)
    expect(result.slotNames).toBe(slotNames)
  })

  test('updates a slot material without changing face assignments', () => {
    const slots = { body: 'library:wood' }
    expect(setBlockMaterialSlot(slots, 'body', 'library:metal-steel')).toEqual({
      slots: { body: 'library:metal-steel' },
      changed: true,
    })
    expect(setBlockMaterialSlot(slots, 'body', undefined)).toEqual({
      slots: undefined,
      changed: true,
    })
  })

  test('identifies unpainted non-body slots for the edit-mode tint', () => {
    const topology = createBoxBlockTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }

    expect(
      unpaintedBlockMaterialSlotIds(
        topology,
        { body: 'library:wood', painted: 'library:metal-steel' },
        { accent: 'Accent', painted: 'Painted' },
      ),
    ).toEqual(['accent'])
  })

  test('reports single and mixed face assignments using the active face', () => {
    const topology = createBoxBlockTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }

    expect(blockMaterialSelection(topology, ['f-bottom'], 'f-bottom')).toEqual({
      kind: 'single',
      slotId: 'body',
      activeSlotId: 'body',
    })
    expect(blockMaterialSelection(topology, ['f-bottom', 'f-top'], 'f-top')).toEqual({
      kind: 'mixed',
      activeSlotId: 'accent',
    })
    expect(blockMaterialSelection(topology, [], null)).toEqual({
      kind: 'empty',
      activeSlotId: null,
    })
  })

  test('removes a material slot and remaps all of its faces to the first slot', () => {
    const topology = createBoxBlockTopology()
    topology.faces[1] = { ...topology.faces[1], materialSlot: 'accent' }
    topology.faces[2] = { ...topology.faces[2], materialSlot: 'accent' }

    const result = removeBlockMaterialSlot(
      topology,
      { body: 'scene:body', accent: 'scene:accent', trim: 'scene:trim' },
      'accent',
      { body: 'Body', accent: 'Accent', trim: 'Trim' },
    )

    expect(result.changed).toBe(true)
    expect(result.fallbackSlotId).toBe('body')
    expect(result.topology.faces.slice(1, 3).map((face) => face.materialSlot)).toEqual([
      'body',
      'body',
    ])
    expect(result.slots).toEqual({ body: 'scene:body', trim: 'scene:trim' })
    expect(result.slotNames).toEqual({ body: 'Body', trim: 'Trim' })
    expect(topology.faces[1].materialSlot).toBe('accent')
  })

  test('removes an unused slot but never removes the first body slot', () => {
    const topology = createBoxBlockTopology()
    const slots = { body: 'scene:body', accent: 'scene:accent' }

    const removed = removeBlockMaterialSlot(topology, slots, 'accent')
    expect(removed).toEqual({
      topology,
      slots: { body: 'scene:body' },
      fallbackSlotId: 'body',
      changed: true,
    })

    const body = removeBlockMaterialSlot(topology, slots, 'body')
    expect(body).toEqual({ topology, slots, fallbackSlotId: 'body', changed: false })
    expect(body.topology).toBe(topology)
    expect(body.slots).toBe(slots)
  })

  test('assigns an existing slot to all selected faces in one immutable result', () => {
    const topology = createBoxBlockTopology()
    const slots = { accent: 'scene:accent' }
    const result = assignBlockMaterial(topology, slots, ['f-bottom', 'f-top'], {
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

  test('does not mutate for an empty or no-op assignment', () => {
    const topology = createBoxBlockTopology()
    const empty = assignBlockMaterial(topology, undefined, [], {
      kind: 'slot',
      slotId: 'body',
    })
    expect(empty).toEqual({
      topology,
      slots: undefined,
      slotId: 'body',
      changed: false,
    })

    const noOp = assignBlockMaterial(topology, undefined, ['f-top'], {
      kind: 'slot',
      slotId: 'body',
    })
    expect(noOp.changed).toBe(false)
    expect(noOp.topology).toBe(topology)
  })
})
