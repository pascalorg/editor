import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEditableParam,
  SemanticRecipePort,
} from '@pascal-app/core'
import { stringParam, type FactorySemanticRecipePart } from './common'

export const CENTRIFUGAL_PUMP_RECIPE_ID = 'factory:centrifugal-pump'
export const CENTRIFUGAL_PUMP_PROFILE_ID = 'generic.centrifugal_pump'

export const CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES = [
  'support_base',
  'drive_motor',
  'volute_casing',
  'inlet_port',
  'outlet_port',
  'inlet_flange',
  'outlet_flange',
] as const

export const CENTRIFUGAL_PUMP_CORE_PART_ROLES = [
  'support_base',
  'drive_motor',
  'volute_casing',
  'inlet_port',
  'outlet_port',
] as const

export const CENTRIFUGAL_PUMP_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] = [
  {
    key: 'casingColor',
    label: '\u6cf5\u58f3\u989c\u8272',
    kind: 'color',
    defaultValue: '#4f7f93',
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-material', partRole: 'volute_casing', property: 'color' },
    ],
  },
  {
    key: 'motorColor',
    label: '\u7535\u673a\u989c\u8272',
    kind: 'color',
    defaultValue: '#4f7f93',
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-material', partRole: 'drive_motor', property: 'color' },
    ],
  },
  {
    key: 'motorPower',
    label: '\u7535\u673a\u529f\u7387',
    kind: 'number',
    min: 0.5,
    max: 500,
    step: 0.5,
    precision: 1,
    unit: 'kW',
    defaultValue: 15,
    effects: [{ kind: 'set-param' }],
  },
] as const

export function buildCentrifugalPumpProfileParts(
  input: {
    params?: Record<string, EquipmentParamValue>
    primaryColor?: string
    metalColor?: string
  } = {},
): FactorySemanticRecipePart[] {
  const primaryColor = input.primaryColor ?? stringParam(input.params, 'casingColor', '#4f7f93')
  const motorColor = stringParam(input.params, 'motorColor', primaryColor)
  const metalColor = input.metalColor ?? '#cbd5e1'
  return [
    { id: 'base', kind: 'skid_base', semanticRole: 'support_base' },
    {
      id: 'motor',
      kind: 'ribbed_motor_body',
      semanticRole: 'drive_motor',
      position: [-0.28, 0.42, 0],
      length: 0.55,
      primaryColor: motorColor,
      metalColor,
    },
    {
      id: 'volute',
      kind: 'volute_casing',
      semanticRole: 'volute_casing',
      position: [0.24, 0.42, 0.04],
      radius: 0.22,
      depth: 0.16,
      primaryColor,
      metalColor,
    },
    {
      id: 'inlet',
      kind: 'inlet_port',
      semanticRole: 'inlet_port',
      position: [0.24, 0.42, 0.28],
      axis: 'z',
      radius: 0.07,
      metalColor,
    },
    {
      id: 'outlet',
      kind: 'outlet_port',
      semanticRole: 'outlet_port',
      position: [0.49, 0.5, 0.04],
      axis: 'x',
      radius: 0.06,
      metalColor,
    },
    {
      id: 'flange_in',
      kind: 'flange_ring',
      semanticRole: 'inlet_flange',
      connectTo: 'inlet',
      connectPoint: 'open',
      metalColor,
    },
    {
      id: 'flange_out',
      kind: 'flange_ring',
      semanticRole: 'outlet_flange',
      connectTo: 'outlet',
      connectPoint: 'open',
      metalColor,
    },
    {
      id: 'control',
      kind: 'control_box',
      semanticRole: 'control_box',
      position: [-0.28, 0.62, 0.2],
    },
  ]
}

export function buildCentrifugalPumpPorts(
  input: {
    height?: number
    medium?: string
  } = {},
): SemanticRecipePort[] {
  const height = input.height ?? 1.4
  const medium = input.medium ?? 'water'
  return [
    { id: 'inlet', role: 'process-inlet', medium, side: 'left', height: height * 0.5, offset: 0 },
    { id: 'outlet', role: 'process-outlet', medium, side: 'right', height: height * 0.45, offset: 0 },
  ]
}

export const centrifugalPumpRecipe: SemanticRecipeDefinition = {
  id: CENTRIFUGAL_PUMP_RECIPE_ID,
  label: 'Centrifugal pump',
  family: 'pump',
  acceptsProfiles: ['pump', 'centrifugal_pump', CENTRIFUGAL_PUMP_PROFILE_ID],
  paramSchema: {
    fields: [
      'pumpType',
      'flowRate',
      'motorPower',
      'skidMounted',
      'length',
      'width',
      'height',
      'inletDiameter',
      'outletDiameter',
      'casingColor',
    ],
  },
  defaultEnvelope: { length: 1.4, width: 0.8, height: 1.4 },
  editableParams: CENTRIFUGAL_PUMP_EDITABLE_PARAMS,
  editablePartRoles: CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES,
  corePartRoles: CENTRIFUGAL_PUMP_CORE_PART_ROLES,
  compose: ({ params, envelope, medium }) => {
    const height = envelope?.height ?? 1.4
    return {
      parts: buildCentrifugalPumpProfileParts({ params }),
      ports: buildCentrifugalPumpPorts({ height, medium }),
      envelope: {
        length: envelope?.length ?? 1.4,
        width: envelope?.width ?? 0.8,
        height,
        tolerance: envelope?.tolerance,
      },
      editableParams: CENTRIFUGAL_PUMP_EDITABLE_PARAMS,
      editablePartRoles: CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES,
      corePartRoles: CENTRIFUGAL_PUMP_CORE_PART_ROLES,
      primarySemanticRole: 'volute_casing',
    }
  },
}
