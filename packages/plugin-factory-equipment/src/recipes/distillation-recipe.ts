import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEditableParam,
  SemanticRecipePort,
} from '@pascal-app/core'
import { numberParam, stringParam, type FactorySemanticRecipePart } from './common'

export const DISTILLATION_UNIT_RECIPE_ID = 'factory:distillation-unit'

export const DISTILLATION_UNIT_EDITABLE_PART_ROLES = [
  'distillation_column_shell',
  'vacuum_column_shell',
  'heat_exchanger_shell',
  'fired_heater',
  'vacuum_heater',
  'side_draw_manifold',
  'service_platform',
  'helical_ladder_tread',
  'helical_ladder_guard_rail',
  'helical_ladder_stringer',
  'helical_ladder_landing',
] as const

export const DISTILLATION_UNIT_CORE_PART_ROLES = [
  'distillation_column_shell',
  'heat_exchanger_shell',
  'fired_heater',
  'side_draw_manifold',
] as const

function distillationRoles(profileId: string | undefined, params: Record<string, EquipmentParamValue> | undefined) {
  const vacuum = /vacuum/i.test(profileId ?? '') || params?.columnKind === 'vacuum'
  return {
    columnRole: stringParam(
      params,
      'columnRole',
      vacuum ? 'vacuum_column_shell' : 'distillation_column_shell',
    ),
    exchangerRole: stringParam(
      params,
      'exchangerRole',
      'heat_exchanger_shell',
    ),
    heaterRole: stringParam(params, 'heaterRole', vacuum ? 'vacuum_heater' : 'fired_heater'),
    manifoldRole: stringParam(params, 'manifoldRole', vacuum ? 'vacuum_line' : 'side_draw_manifold'),
    vacuum,
  }
}

function editableParamsForRoles(input: {
  columnRole: string
  exchangerRole: string
  heaterRole: string
  manifoldRole: string
}): readonly SemanticRecipeEditableParam[] {
  return [
    {
      key: 'columnColor',
      label: 'Column color',
      kind: 'color',
      defaultValue: '#d1d5db',
      effects: [
        { kind: 'set-param' },
        { kind: 'set-part-material', partRole: input.columnRole, property: 'color' },
      ],
    },
    {
      key: 'columnOpacity',
      label: 'Column opacity',
      kind: 'number',
      min: 0.18,
      max: 1,
      step: 0.01,
      precision: 2,
      defaultValue: 1,
      effects: [
        { kind: 'set-param' },
        {
          kind: 'set-part-material',
          partRole: input.columnRole,
          property: 'opacity',
          transparentWhenBelowOne: true,
        },
      ],
    },
    {
      key: 'heaterColor',
      label: 'Heater color',
      kind: 'color',
      defaultValue: '#9ca3af',
      effects: [
        { kind: 'set-param' },
        { kind: 'set-part-material', partRole: input.heaterRole, property: 'color' },
      ],
    },
    {
      key: 'exchangerColor',
      label: 'Exchanger color',
      kind: 'color',
      defaultValue: '#94a3b8',
      effects: [
        { kind: 'set-param' },
        { kind: 'set-part-material', partRole: input.exchangerRole, property: 'color' },
      ],
    },
    {
      key: 'manifoldColor',
      label: 'Manifold color',
      kind: 'color',
      defaultValue: '#64748b',
      effects: [
        { kind: 'set-param' },
        { kind: 'set-part-material', partRole: input.manifoldRole, property: 'color' },
      ],
    },
  ] as const
}

export const DISTILLATION_UNIT_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] =
  editableParamsForRoles({
    columnRole: 'distillation_column_shell',
    exchangerRole: 'heat_exchanger_shell',
    heaterRole: 'fired_heater',
    manifoldRole: 'side_draw_manifold',
  })

function vec3(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z]
}

export function buildDistillationUnitProfileParts(input: {
  length: number
  width: number
  height: number
  profileId?: string
  params?: Record<string, EquipmentParamValue>
}): FactorySemanticRecipePart[] {
  const roles = distillationRoles(input.profileId, input.params)
  const columnHeight = Math.max(3.2, numberParam(input.params, 'columnHeight', input.height * 0.96))
  const radius = Math.max(0.36, numberParam(input.params, 'columnRadius', Math.min(input.width, input.length) * 0.13))
  const columnX = roles.vacuum ? -input.length * 0.2 : -input.length * 0.26
  const columnColor = stringParam(input.params, 'columnColor', roles.vacuum ? '#cbd5e1' : '#d1d5db')
  const columnOpacity = Math.max(0.18, Math.min(1, numberParam(input.params, 'columnOpacity', 1)))
  const exchangerColor = stringParam(input.params, 'exchangerColor', '#94a3b8')
  const heaterColor = stringParam(input.params, 'heaterColor', '#9ca3af')
  const manifoldColor = stringParam(input.params, 'manifoldColor', '#64748b')
  const metalColor = '#94a3b8'
  const yBase = radius * 0.25
  const columnCenterY = columnHeight / 2 + yBase
  const bandRadius = radius * 1.08
  const bandYs = roles.vacuum
    ? [0.24, 0.44, 0.64, 0.82]
    : [0.18, 0.34, 0.5, 0.66, 0.82]
  return [
    {
      id: 'column',
      kind: 'cylindrical_tank',
      semanticRole: roles.columnRole,
      axis: 'y',
      position: vec3(columnX, columnCenterY, 0),
      height: columnHeight,
      length: columnHeight,
      radius,
      primaryColor: columnColor,
      metalColor,
      material: {
        properties: {
          color: columnColor,
          roughness: 0.46,
          metalness: 0.38,
          opacity: columnOpacity,
          transparent: columnOpacity < 1,
        },
      },
    },
    ...bandYs.map((fraction, index) => ({
      id: `tray_band_${index + 1}`,
      kind: 'flange_ring' as const,
      semanticRole: 'tray_band',
      axis: 'y',
      radius: bandRadius,
      tubeRadius: Math.max(0.035, radius * 0.06),
      includeBolts: false,
      position: vec3(columnX, yBase + columnHeight * fraction, 0),
      metalColor,
    })),
    {
      id: 'exchanger',
      kind: 'heat_exchanger',
      semanticRole: roles.exchangerRole,
      axis: 'x',
      position: vec3(input.length * 0.22, Math.max(0.68, input.height * 0.09), -input.width * 0.23),
      length: Math.max(1.5, input.length * 0.28),
      radius: Math.max(0.22, radius * 0.38),
      primaryColor: exchangerColor,
      metalColor,
      material: { properties: { color: exchangerColor, roughness: 0.45, metalness: 0.45 } },
    },
    {
      id: 'heater',
      kind: 'generic_body',
      semanticRole: roles.heaterRole,
      position: vec3(input.length * 0.24, Math.max(1.0, input.height * 0.14), input.width * 0.2),
      length: Math.max(1.3, input.length * 0.22),
      width: Math.max(0.75, input.width * 0.22),
      height: Math.max(1.3, input.height * 0.2),
      primaryColor: heaterColor,
      material: { properties: { color: heaterColor, roughness: 0.62, metalness: 0.24 } },
    },
    {
      id: 'manifold',
      kind: roles.vacuum ? 'pipe_run' : 'pipe_manifold',
      semanticRole: roles.manifoldRole,
      position: vec3(columnX + radius * 1.2, yBase + columnHeight * 0.52, input.width * 0.28),
      length: Math.max(1.3, input.length * 0.32),
      radius: Math.max(0.08, radius * 0.12),
      ...(roles.vacuum ? {} : { count: 4 }),
      primaryColor: manifoldColor,
      metalColor,
      material: { properties: { color: manifoldColor, roughness: 0.42, metalness: 0.52 } },
    },
    {
      id: 'platform',
      kind: 'service_platform',
      semanticRole: 'service_platform',
      position: vec3(columnX + radius * 1.12, yBase + columnHeight * 0.58, 0),
      length: Math.max(1, radius * 1.6),
      width: Math.max(0.72, radius * 1.05),
      height: Math.max(1.8, input.height * 0.5),
      metalColor,
    },
    {
      id: 'column_access_ladder',
      kind: 'helical_ladder',
      semanticRole: 'external_spiral_ladder',
      sourcePartKind: 'helical_ladder',
      position: vec3(columnX, yBase + columnHeight * 0.5, 0),
      height: Math.min(12, Math.max(5.2, columnHeight * 0.88)),
      innerRadius: radius * 1.18,
      outerRadius: radius * 1.58,
      width: Math.max(0.32, radius * 0.34),
      depth: Math.max(0.18, radius * 0.28),
      sweepAngle: roles.vacuum ? Math.PI * 4.2 : Math.PI * 4.8,
      startAngle: roles.vacuum ? -Math.PI * 0.15 : Math.PI * 0.1,
      stepCount: roles.vacuum ? 30 : 36,
      ringCount: roles.vacuum ? 24 : 28,
      railingHeight: 0.42,
      wireRadius: Math.max(0.012, radius * 0.022),
      metalColor,
    },
    {
      id: 'feed_inlet',
      kind: 'inlet_port',
      semanticRole: 'crude_feed_inlet',
      position: vec3(columnX - radius * 1.1, yBase + columnHeight * 0.32, 0),
      axis: 'x',
      radius: Math.max(0.07, radius * 0.12),
      metalColor,
    },
    {
      id: 'overhead_outlet',
      kind: 'outlet_port',
      semanticRole: 'overhead_product_outlet',
      position: vec3(columnX, yBase + columnHeight * 0.97, radius * 1.08),
      axis: 'z',
      radius: Math.max(0.06, radius * 0.1),
      metalColor,
    },
    {
      id: 'bottoms_outlet',
      kind: 'outlet_port',
      semanticRole: 'bottoms_outlet',
      position: vec3(columnX + radius * 1.1, yBase + columnHeight * 0.12, 0),
      axis: 'x',
      radius: Math.max(0.07, radius * 0.12),
      metalColor,
    },
  ]
}

export function buildDistillationUnitPorts(input: {
  height?: number
  medium?: string
} = {}): SemanticRecipePort[] {
  const height = input.height ?? 9
  const medium = input.medium ?? 'material'
  return [
    { id: 'feed_inlet', role: 'process-inlet', medium, side: 'left', height: height * 0.34, offset: 0 },
    { id: 'overhead_product_outlet', role: 'process-outlet', medium, side: 'top', height: height * 0.96, offset: 0 },
    { id: 'bottoms_outlet', role: 'process-outlet', medium, side: 'right', height: height * 0.16, offset: 0 },
  ]
}

export const distillationUnitRecipe: SemanticRecipeDefinition = {
  id: DISTILLATION_UNIT_RECIPE_ID,
  label: 'Distillation unit',
  family: 'distillation_column',
  acceptsProfiles: [
    'distillation_column',
    'distillation_unit',
    'refinery.atmospheric_distillation_unit',
    'refinery.vacuum_distillation_unit',
  ],
  paramSchema: {
    fields: [
      'length',
      'width',
      'height',
      'columnKind',
      'columnRole',
      'columnHeight',
      'columnRadius',
      'columnColor',
      'columnOpacity',
      'exchangerRole',
      'exchangerColor',
      'heaterRole',
      'heaterColor',
      'manifoldRole',
      'manifoldColor',
    ],
  },
  defaultEnvelope: { length: 6.4, width: 3.4, height: 9.5 },
  editableParams: DISTILLATION_UNIT_EDITABLE_PARAMS,
  editablePartRoles: DISTILLATION_UNIT_EDITABLE_PART_ROLES,
  corePartRoles: DISTILLATION_UNIT_CORE_PART_ROLES,
  compose: ({ params, envelope, profileId, medium }) => {
    const length = envelope?.length ?? 6.4
    const width = envelope?.width ?? 3.4
    const height = envelope?.height ?? 9.5
    const roles = distillationRoles(profileId, params)
    const editableParams = editableParamsForRoles(roles)
    const corePartRoles = [
      roles.columnRole,
      roles.exchangerRole,
      roles.heaterRole,
      roles.manifoldRole,
    ] as const
    return {
      parts: buildDistillationUnitProfileParts({ length, width, height, profileId, params }),
      ports: buildDistillationUnitPorts({ height, medium }),
      envelope: { length, width, height, tolerance: envelope?.tolerance },
      editableParams,
      editablePartRoles: [
        roles.columnRole,
        roles.exchangerRole,
        roles.heaterRole,
        roles.manifoldRole,
        'service_platform',
        'helical_ladder_tread',
        'helical_ladder_guard_rail',
        'helical_ladder_stringer',
        'helical_ladder_landing',
        'tray_band',
      ],
      corePartRoles,
      primarySemanticRole: roles.columnRole,
    }
  },
}
