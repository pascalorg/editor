import { describe, expect, test } from 'bun:test'
import type { DeviceProfileDefinition } from '@pascal-app/core/lib/device-profile-registry'
import { EDITABLE_SCHEMA_DEFINITIONS } from '@pascal-app/core/lib/device-profile-registry'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  applyProfileEditablePatchToArgs,
  resolveProfileEditablePatch,
} from './profile-editable-patches'

function editableSchema(id: string) {
  const schema = EDITABLE_SCHEMA_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!schema) throw new Error(`Missing editable schema ${id}`)
  return schema
}

const robotProfile: DeviceProfileDefinition = {
  id: 'robotics.six_axis_industrial_robot_arm',
  name: 'Six-axis industrial robot arm',
  aliases: ['six-axis industrial robot arm', 'robot arm'],
  family: 'robot_arm',
  layoutFamily: 'robot_workcell_layout',
  archetypeFamily: 'robotic_workcell',
  parts: [{ kind: 'generic_base', semanticRole: 'robot_base', required: true }],
  primarySemanticRole: 'robot_base',
  editableSchemaRef: 'robot_arm.common',
  resolvedEditableSchema: editableSchema('robot_arm.common'),
  status: 'stable',
  source: 'imported_pack',
  description: 'Robot arm test profile.',
}

const vesselProfile: DeviceProfileDefinition = {
  id: 'fine_chemical.stirred_batch_reactor',
  name: 'Stirred batch reactor',
  aliases: ['stirred reactor'],
  family: 'reactor',
  layoutFamily: 'vessel_layout',
  archetypeFamily: 'process_vessel',
  defaultDimensions: { height: 1.6, diameter: 1 },
  parts: [{ kind: 'agitator_tank', semanticRole: 'reactor_vessel_shell', required: true }],
  primarySemanticRole: 'reactor_vessel_shell',
  resolvedEditableSchema: editableSchema('vessel.common'),
  status: 'stable',
  source: 'imported_pack',
  description: 'Vessel test profile.',
}

const agvProfile: DeviceProfileDefinition = {
  id: 'agv_material_cart',
  name: 'AGV material cart',
  aliases: ['agv'],
  family: 'generic',
  layoutFamily: 'vehicle_layout',
  archetypeFamily: 'material_handling',
  defaultDimensions: { length: 1.4, width: 0.9, height: 0.32 },
  parts: [{ kind: 'mobile_platform_chassis', semanticRole: 'vehicle_body', required: true }],
  primarySemanticRole: 'vehicle_body',
  resolvedEditableSchema: editableSchema('mobile_platform.common'),
  status: 'stable',
  source: 'imported_pack',
  description: 'AGV test profile.',
}

function artifact(sourceArgs: Record<string, unknown>): GeneratedGeometryArtifact {
  return {
    id: 'profile_editable_test',
    title: 'Profile editable test',
    sourceTool: 'compose_parts',
    sourceArgs,
    userPrompt: 'create industrial equipment',
    version: 1,
    createdAt: '2026-06-19T00:00:00.000Z',
    shapes: [],
    transforms: [],
    assemblyName: 'Profile editable test',
    assemblyPosition: [0, 0, 0],
    createdNames: [],
    shapeDetails: '',
  }
}

describe('profile editable patches', () => {
  test('parses robot end-effector edits into schema-backed patches', () => {
    const patch = resolveProfileEditablePatch(
      '\u672b\u7aef\u6539\u6210\u5939\u722a',
      artifact({
        deviceProfile: 'robotics.six_axis_industrial_robot_arm',
        layoutHints: { robotArmDefaults: { endEffector: 'tool-flange', reach: 1.58 } },
      }),
      robotProfile,
    )

    expect(patch).toMatchObject({
      values: { endEffector: 'gripper' },
    })
    expect(
      applyProfileEditablePatchToArgs(
        {
          deviceProfile: 'robotics.six_axis_industrial_robot_arm',
          layoutHints: { robotArmDefaults: { endEffector: 'tool-flange' } },
        },
        patch!,
      ),
    ).toMatchObject({
      endEffector: 'gripper',
      layoutHints: { robotArmDefaults: { endEffector: 'gripper' } },
    })
  })

  test('parses vessel dimension edits and scales existing parts', () => {
    const source = {
      deviceProfile: 'fine_chemical.stirred_batch_reactor',
      height: 1.6,
      width: 1,
      parts: [
        {
          kind: 'agitator_tank',
          semanticRole: 'reactor_vessel_shell',
          height: 1.6,
          radius: 0.5,
          position: [0, 0.8, 0],
          primaryColor: '#94a3b8',
        },
      ],
    }
    const patch = resolveProfileEditablePatch(
      '\u628a\u7f50\u4f53\u52a0\u9ad8\uff0c\u76f4\u5f84\u53d8\u5927\u4e00\u70b9',
      artifact(source),
      vesselProfile,
    )

    expect(patch?.values).toMatchObject({ height: 1.888, diameter: 1.18, radius: 0.59 })
    expect(applyProfileEditablePatchToArgs(source, patch!)).toMatchObject({
      height: 1.888,
      diameter: 1.18,
      parts: [
        expect.objectContaining({
          height: 1.888,
          radius: 0.59,
          position: [0, 0.944, 0],
        }),
      ],
    })
  })

  test('parses mobile platform color and global size edits', () => {
    const source = {
      deviceProfile: 'agv_material_cart',
      length: 1.4,
      width: 0.9,
      height: 0.32,
      parts: [
        {
          kind: 'mobile_platform_chassis',
          semanticRole: 'vehicle_body',
          length: 1.4,
          width: 0.9,
          height: 0.32,
          primaryColor: '#e5e7eb',
        },
      ],
    }
    const patch = resolveProfileEditablePatch(
      '\u6539\u6210\u84dd\u8272\uff0c\u5c0f\u8f66\u518d\u5927\u4e00\u70b9',
      artifact(source),
      agvProfile,
    )

    expect(patch?.values).toMatchObject({
      primaryColor: '#2563eb',
      length: 1.61,
      width: 1.035,
      height: 0.368,
    })
    expect(applyProfileEditablePatchToArgs(source, patch!)).toMatchObject({
      primaryColor: '#2563eb',
      parts: [
        expect.objectContaining({
          length: 1.61,
          width: 1.035,
          height: 0.368,
          primaryColor: '#2563eb',
        }),
      ],
    })
  })
})
