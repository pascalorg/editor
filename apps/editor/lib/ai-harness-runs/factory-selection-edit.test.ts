import { describe, expect, test } from 'bun:test'
import {
  composeSelectionColorEdit,
  composeSelectionDeleteEdit,
  composeSelectionEdit,
  composeSelectionGeometryEdit,
  composeSelectionMoveEdit,
  composeSelectionReplaceEdit,
  composeSelectionRotateEdit,
  resolveSelectionEditColor,
  resolveSelectionGeometryDimension,
  resolveSelectionGeometryFactor,
  resolveSelectionReplacement,
  resolveSelectionTankKind,
} from './factory-selection-edit'

describe('factory selection edit composer', () => {
  test('resolves requested Chinese color keywords', () => {
    expect(
      resolveSelectionEditColor('\u628a\u8fd9\u4e2a\u7269\u54c1\u6539\u6210\u7ea2\u8272'),
    ).toBe('#ef4444')
  })

  test('recolors editable descendants when an assembly is selected', () => {
    const result = composeSelectionColorEdit({
      prompt: '\u628a\u8fd9\u4e2a\u7269\u54c1\u6539\u6210\u84dd\u8272',
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            {
              id: 'assembly_1',
              type: 'assembly',
              name: 'Pump assembly',
              children: ['box_1', 'tank_1', 'pipe_1'],
            },
            {
              id: 'box_1',
              type: 'box',
              name: 'skid',
              materialPreset: 'metal',
            },
            {
              id: 'tank_1',
              type: 'tank',
              name: 'buffer tank',
              shellColor: '#94a3b8',
            },
            {
              id: 'pipe_1',
              type: 'pipe',
              name: 'process pipe',
              color: '#b0b8c0',
            },
          ],
        },
      },
    })

    expect(result?.nodeIds).toEqual(['box_1', 'tank_1', 'pipe_1'])
    expect(result?.patches).toEqual([
      {
        op: 'update',
        id: 'box_1',
        data: {
          material: {
            preset: 'custom',
            properties: {
              color: '#3b82f6',
              roughness: 0.55,
              metalness: 0,
              opacity: 1,
              transparent: false,
              side: 'front',
            },
          },
          materialPreset: null,
        },
      },
      { op: 'update', id: 'tank_1', data: { shellColor: '#3b82f6' } },
      { op: 'update', id: 'pipe_1', data: { color: '#3b82f6' } },
    ])
  })

  test('returns a required missing reason when nothing is selected', () => {
    const result = composeSelectionColorEdit({
      prompt: 'change this object to a different color',
      context: { selection: { selectedIds: [], nodes: [] } },
    })

    expect(result?.patches).toEqual([])
    expect(result?.missingReason).toContain('No canvas object is selected')
  })

  test('resolves requested tank orientation keywords', () => {
    expect(resolveSelectionTankKind('\u628a\u8fd9\u4e2a\u50a8\u7f50\u6539\u6210\u5367\u5f0f')).toBe(
      'horizontal',
    )
    expect(resolveSelectionTankKind('make this tank vertical')).toBe('vertical')
  })

  test('changes editable tank descendants when an assembly is selected', () => {
    const result = composeSelectionEdit({
      prompt: '\u628a\u8fd9\u4e2a\u50a8\u7f50\u6539\u6210\u5367\u5f0f',
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            {
              id: 'assembly_1',
              type: 'assembly',
              name: 'Tank skid',
              children: ['tank_1', 'box_1'],
            },
            {
              id: 'tank_1',
              type: 'tank',
              name: 'buffer tank',
              kind: 'vertical',
            },
            {
              id: 'box_1',
              type: 'box',
              name: 'skid',
            },
          ],
        },
      },
    })

    expect(result?.nodeIds).toEqual(['tank_1'])
    expect(result?.patches).toEqual([{ op: 'update', id: 'tank_1', data: { kind: 'horizontal' } }])
  })

  test('resolves selected subpart geometry scale intent', () => {
    expect(
      resolveSelectionGeometryDimension('\u628a\u8fd9\u7247\u6868\u53f6\u52a0\u957f\u4e00\u70b9'),
    ).toBe('length')
    expect(
      resolveSelectionGeometryFactor('\u628a\u8fd9\u7247\u6868\u53f6\u52a0\u957f\u4e00\u70b9'),
    ).toBeCloseTo(1.15)
    expect(resolveSelectionGeometryFactor('make this selected blade 20% longer')).toBeCloseTo(1.2)
  })

  test('scales only the selected generated fan blade subpart', () => {
    const result = composeSelectionGeometryEdit({
      prompt: '\u628a\u8fd9\u7247\u6868\u53f6\u52a0\u957f\u4e00\u70b9',
      context: {
        selection: {
          selectedIds: ['blade_1'],
          nodes: [
            {
              id: 'blade_1',
              type: 'box',
              name: 'fan blade 1',
              length: 0.8,
              width: 0.08,
              height: 0.04,
              metadata: {
                semanticRole: 'fan_blade',
                editableHints: { primaryDimension: 'length', canScale: ['length'] },
                generatedShape: {
                  selector: { index: 0, semanticRole: 'fan_blade' },
                  label: 'fan blade 1',
                },
              },
            },
            {
              id: 'blade_2',
              type: 'box',
              name: 'fan blade 2',
              length: 0.8,
              width: 0.08,
              height: 0.04,
              metadata: {
                semanticRole: 'fan_blade',
                generatedShape: {
                  selector: { index: 1, semanticRole: 'fan_blade' },
                  label: 'fan blade 2',
                },
              },
            },
          ],
        },
      },
    })

    expect(result?.nodeIds).toEqual(['blade_1'])
    expect(result?.patches[0]?.op).toBe('update')
    expect(result?.patches[0]?.id).toBe('blade_1')
    expect(result?.patches[0]?.data.length).toBeCloseTo(0.92)
  })

  test('filters assembly geometry edits to named generated subparts', () => {
    const result = composeSelectionGeometryEdit({
      prompt: '\u628a\u6240\u6709\u6868\u53f6\u52a0\u957f\u4e00\u70b9',
      context: {
        selection: {
          selectedIds: ['fan_assembly'],
          nodes: [
            {
              id: 'fan_assembly',
              type: 'assembly',
              name: 'fan',
              children: ['blade_1', 'blade_2', 'hub_1'],
            },
            {
              id: 'blade_1',
              type: 'box',
              name: 'fan blade 1',
              length: 0.8,
              metadata: {
                semanticRole: 'fan_blade',
                generatedShape: { selector: { index: 0, semanticRole: 'fan_blade' } },
              },
            },
            {
              id: 'blade_2',
              type: 'box',
              name: 'fan blade 2',
              length: 0.8,
              metadata: {
                semanticRole: 'fan_blade',
                generatedShape: { selector: { index: 1, semanticRole: 'fan_blade' } },
              },
            },
            {
              id: 'hub_1',
              type: 'cylinder',
              name: 'fan hub',
              radius: 0.2,
              height: 0.16,
              metadata: {
                semanticRole: 'hub',
                generatedShape: { selector: { index: 2, semanticRole: 'hub' } },
              },
            },
          ],
        },
      },
    })

    expect(result?.nodeIds).toEqual(['blade_1', 'blade_2'])
    expect(result?.patches.map((patch) => patch.data)).toEqual([
      { length: expect.closeTo(0.92) },
      { length: expect.closeTo(0.92) },
    ])
  })

  test('moves the selected assembly root instead of every child', () => {
    const result = composeSelectionMoveEdit({
      prompt: 'move left 1m',
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            {
              id: 'assembly_1',
              type: 'assembly',
              name: 'pump skid',
              position: [2, 0, 3],
              children: ['box_1'],
            },
            {
              id: 'box_1',
              type: 'box',
              name: 'pump body',
              position: [0, 0, 0],
            },
          ],
        },
      },
    })

    expect(result?.patches).toEqual([
      { op: 'update', id: 'assembly_1', data: { position: [1, 0, 3] } },
    ])
    expect(result?.summary).toEqual(['pump skid: position [2, 0, 3] -> [1, 0, 3]'])
  })

  test('rotates the selected object by requested degrees', () => {
    const result = composeSelectionRotateEdit({
      prompt: 'rotate 90 degrees',
      context: {
        selection: {
          selectedIds: ['equipment_1'],
          nodes: [{ id: 'equipment_1', type: 'assembly', name: 'robot', rotation: [0, 0, 0] }],
        },
      },
    })

    expect(result?.patches[0]?.op).toBe('update')
    expect(result?.patches[0]?.id).toBe('equipment_1')
    expect((result?.patches[0] as any)?.data.rotation[1]).toBeCloseTo(Math.PI / 2)
    expect(result?.summary?.[0]).toContain('rotation [0, 0, 0] -> [0, 1.571, 0]')
  })

  test('deletes selected object roots', () => {
    const result = composeSelectionDeleteEdit({
      prompt: 'delete this',
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            { id: 'assembly_1', type: 'assembly', name: 'fan', children: ['blade_1'] },
            { id: 'blade_1', type: 'box', name: 'fan blade' },
          ],
        },
      },
    })

    expect(result?.patches).toEqual([{ op: 'delete', id: 'assembly_1' }])
    expect(result?.summary).toEqual(['fan: deleted'])
  })

  test('replaces robot end effector metadata when requested', () => {
    expect(resolveSelectionReplacement('change end effector to gripper')).toEqual({
      target: 'end_effector',
      kind: 'gripper',
    })

    const result = composeSelectionReplaceEdit({
      prompt: 'change end effector to gripper',
      context: {
        selection: {
          selectedIds: ['robot_1'],
          nodes: [
            {
              id: 'robot_1',
              type: 'assembly',
              name: 'six axis robot',
              children: ['tool_1'],
            },
            {
              id: 'tool_1',
              type: 'box',
              name: 'end effector',
              metadata: {
                semanticRole: 'end_effector',
                generatedShape: { selector: { semanticRole: 'end_effector' } },
              },
            },
          ],
        },
      },
    })

    expect(result?.nodeIds).toEqual(['tool_1'])
    expect((result?.patches[0] as any)?.data.metadata.endEffectorKind).toBe('gripper')
    expect(result?.summary).toEqual(['end effector: endEffector none -> gripper'])
  })
})
