import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEditableParam,
  SemanticRecipePort,
} from '@pascal-app/core'
import { type FactorySemanticRecipePart, numberParam, stringParam } from './common'

export const STORAGE_TANK_RECIPE_ID = 'factory:storage-tank'

export const STORAGE_TANK_EDITABLE_PART_ROLES = [
  'vessel_shell',
  'vessel_roof',
  'tank_bottom',
  'vessel_head',
  'liquid_volume',
  'foundation_ring',
  'top_rim',
  'bottom_rim',
  'inlet_port',
  'outlet_port',
  'top_nozzle',
  'manway_flange',
  'access_ladder',
  'sight_glass',
  'support_leg',
  'saddle_support',
] as const

export const STORAGE_TANK_CORE_PART_ROLES = [
  'vessel_shell',
  'inlet_port',
  'outlet_port',
  'access_ladder',
] as const

export const STORAGE_TANK_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] = [
  {
    key: 'liquidLevel',
    label: '\u6db2\u4f4d',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,
    defaultValue: 0.55,
    effects: [
      { kind: 'set-param' },
      {
        kind: 'set-part-dynamic-level',
        partRole: 'liquid_volume',
        geometryRef: 'dynamicLevelGeometry',
        minSize: 0.02,
      },
    ],
  },
  {
    key: 'shellOpacity',
    label: '\u7f50\u4f53\u900f\u660e\u5ea6',
    kind: 'number',
    min: 0.12,
    max: 1,
    step: 0.01,
    precision: 2,
    defaultValue: 0.34,
    effects: [
      { kind: 'set-param' },
      {
        kind: 'set-part-material',
        partRole: 'vessel_shell',
        property: 'opacity',
        transparentWhenBelowOne: true,
      },
    ],
  },
  {
    key: 'liquidOpacity',
    label: '\u6db2\u4f53\u900f\u660e\u5ea6',
    kind: 'number',
    min: 0.08,
    max: 0.92,
    step: 0.01,
    precision: 2,
    defaultValue: 0.58,
    effects: [
      { kind: 'set-param' },
      {
        kind: 'set-part-material',
        partRole: 'liquid_volume',
        property: 'opacity',
        transparentWhenBelowOne: true,
      },
    ],
  },
  {
    key: 'liquidColor',
    label: '\u6db2\u4f53\u989c\u8272',
    kind: 'color',
    defaultValue: '#38bdf8',
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-material', partRole: 'liquid_volume', property: 'color' },
    ],
  },
] as const

export function buildStorageTankProfileParts(input: {
  length: number
  width: number
  height: number
  orientation?: 'vertical' | 'horizontal'
  params?: Record<string, EquipmentParamValue>
  primaryColor?: string
  metalColor?: string
}): FactorySemanticRecipePart[] {
  const orientation =
    input.orientation ??
    (input.height >= Math.max(input.length, input.width) ? 'vertical' : 'horizontal')
  const radius =
    orientation === 'vertical'
      ? Math.max(0.18, Math.min(input.length, input.width) / 2)
      : Math.max(0.18, Math.min(input.width, input.height) / 2)
  const vesselLength = orientation === 'vertical' ? input.height : input.length
  const primaryColor =
    input.primaryColor ??
    stringParam(input.params, 'shellColor', orientation === 'vertical' ? '#cbd5e1' : '#94a3b8')
  const metalColor = input.metalColor ?? '#cbd5e1'
  const shellOpacity = Math.max(0.12, Math.min(1, numberParam(input.params, 'shellOpacity', 0.34)))
  const liquidLevel = Math.max(0, Math.min(1, numberParam(input.params, 'liquidLevel', 0.55)))
  const liquidHeight = Math.max(0.02, vesselLength * liquidLevel)
  const liquidColor = stringParam(input.params, 'liquidColor', '#38bdf8')
  const liquidOpacity = Math.max(
    0.08,
    Math.min(0.92, numberParam(input.params, 'liquidOpacity', 0.58)),
  )
  const bottomLift = orientation === 'vertical' ? radius * 0.22 : radius * 1.18
  return [
    {
      id: 'shell',
      kind: orientation === 'vertical' ? 'storage_tank_shell' : 'cylindrical_tank',
      semanticRole: 'vessel_shell',
      sourcePartKind: orientation === 'vertical' ? 'storage_tank_shell' : 'cylindrical_tank',
      axis: orientation === 'vertical' ? 'y' : 'x',
      position:
        orientation === 'vertical' ? [0, vesselLength / 2 + bottomLift, 0] : [0, bottomLift, 0],
      length: vesselLength,
      height: vesselLength,
      radius,
      primaryColor,
      metalColor,
      material: {
        properties: {
          color: primaryColor,
          roughness: 0.48,
          metalness: 0.42,
          opacity: shellOpacity,
          transparent: shellOpacity < 1,
        },
      },
    },
    {
      id: 'liquid',
      kind: 'liquid_volume',
      semanticRole: 'liquid_volume',
      axis: orientation === 'vertical' ? 'y' : 'x',
      position:
        orientation === 'vertical'
          ? [0, liquidHeight / 2 + bottomLift, 0]
          : [-(vesselLength - liquidHeight) / 2, bottomLift, 0],
      height: liquidHeight,
      radius: radius * 0.9,
      color: liquidColor,
      opacity: liquidOpacity,
    },
    {
      id: 'feed_inlet',
      kind: 'flanged_nozzle',
      semanticRole: 'inlet_port',
      side: 'left',
      radius: Math.max(0.04, radius * 0.08),
      length: Math.max(0.16, radius * 0.18),
      metalColor,
    },
    {
      id: 'product_outlet',
      kind: 'flanged_nozzle',
      semanticRole: 'outlet_port',
      side: 'right',
      radius: Math.max(0.04, radius * 0.075),
      length: Math.max(0.16, radius * 0.18),
      metalColor,
    },
    {
      id: 'access_ladder',
      kind: orientation === 'vertical' ? 'helical_ladder' : 'platform_ladder',
      semanticRole: 'access_ladder',
      sourcePartKind: orientation === 'vertical' ? 'helical_ladder' : 'platform_ladder',
      position:
        orientation === 'vertical'
          ? [0, bottomLift + vesselLength * 0.5, 0]
          : [0, Math.max(0.65, input.height * 0.62), radius * 1.08],
      length: Math.max(0.6, radius * 0.72),
      width: Math.max(0.34, radius * 0.38),
      height: Math.max(0.9, input.height * 0.76),
      innerRadius: radius * 1.04,
      outerRadius: radius * 1.26,
      sweepAngle: Math.PI * 2.25,
      startAngle: -Math.PI * 0.2,
      stepCount: 18,
      ringCount: 16,
      railingHeight: 0.34,
      wireRadius: Math.max(0.012, radius * 0.018),
      metalColor,
    },
    {
      id: 'level_glass',
      kind: 'sight_glass',
      semanticRole: 'sight_glass',
      side: 'front',
      length: Math.max(0.18, radius * 0.16),
      height: Math.max(0.55, input.height * 0.46),
      opacity: 0.42,
      color: '#60a5fa',
      metalColor,
    },
    {
      id: 'instrument',
      kind: 'instrument_port',
      semanticRole: 'instrument_port',
      side: 'top',
      radius: Math.max(0.035, radius * 0.055),
      metalColor,
    },
  ]
}

export function buildStorageTankPorts(
  input: { height?: number; medium?: string } = {},
): SemanticRecipePort[] {
  const height = input.height ?? 2.4
  const medium = input.medium ?? 'material'
  return [
    { id: 'inlet', role: 'process-inlet', medium, side: 'left', height: height * 0.58, offset: 0 },
    {
      id: 'outlet',
      role: 'process-outlet',
      medium,
      side: 'right',
      height: height * 0.38,
      offset: 0,
    },
  ]
}

export const storageTankRecipe: SemanticRecipeDefinition = {
  id: STORAGE_TANK_RECIPE_ID,
  label: 'Storage tank',
  family: 'tank',
  acceptsProfiles: [
    'tank',
    'storage_tank',
    'vertical_tank',
    'horizontal_tank',
    'generic.vertical_tank',
    'generic.horizontal_tank',
    'refinery.crude_storage_tank',
    'refinery.product_storage_tank',
    'refinery.intermediate_storage_tank',
  ],
  paramSchema: {
    fields: [
      'length',
      'width',
      'height',
      'diameter',
      'orientation',
      'tankOrientation',
      'capacity',
      'liquidLevel',
      'liquidColor',
      'liquidOpacity',
      'shellOpacity',
      'inletDiameter',
      'outletDiameter',
      'shellColor',
    ],
  },
  defaultEnvelope: { length: 3, width: 3, height: 4 },
  editableParams: STORAGE_TANK_EDITABLE_PARAMS,
  editablePartRoles: STORAGE_TANK_EDITABLE_PART_ROLES,
  corePartRoles: STORAGE_TANK_CORE_PART_ROLES,
  compose: ({ params, envelope, medium }) => {
    const length = envelope?.length ?? 3
    const width = envelope?.width ?? 3
    const height = envelope?.height ?? 4
    const orientation =
      params?.orientation === 'horizontal' || params?.tankOrientation === 'horizontal'
        ? 'horizontal'
        : params?.orientation === 'vertical' || params?.tankOrientation === 'vertical'
          ? 'vertical'
          : undefined
    return {
      parts: buildStorageTankProfileParts({ length, width, height, orientation, params }),
      ports: buildStorageTankPorts({ height, medium }),
      envelope: { length, width, height, tolerance: envelope?.tolerance },
      editableParams: STORAGE_TANK_EDITABLE_PARAMS,
      editablePartRoles: STORAGE_TANK_EDITABLE_PART_ROLES,
      corePartRoles: STORAGE_TANK_CORE_PART_ROLES,
      primarySemanticRole: 'vessel_shell',
    }
  },
}
