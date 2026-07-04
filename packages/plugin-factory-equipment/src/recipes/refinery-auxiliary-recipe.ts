import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEditableParam,
  SemanticRecipePort,
} from '@pascal-app/core'
import { numberParam, stringParam, type FactorySemanticRecipePart } from './common'

export const REFINERY_AUXILIARY_UNIT_RECIPE_ID = 'factory:refinery-auxiliary-unit'

type RefineryAuxiliaryVariant = 'flare' | 'pipe-rack' | 'boiler'

type AuxiliaryRoles = {
  variant: RefineryAuxiliaryVariant
  primaryRole: string
  vesselRole?: string
  pipeRole?: string
  stackRole?: string
  frameRole?: string
  controlRole?: string
}

export const REFINERY_AUXILIARY_UNIT_EDITABLE_PART_ROLES = [
  'flare_stack',
  'knockout_drum',
  'relief_gas_inlet',
  'main_pipe_header',
  'parallel_pipe_run',
  'pipe_rack_support_frame',
  'boiler_body',
  'steam_drum',
  'mud_drum',
  'boiler_tube_bank',
  'boiler_stack',
  'steam_header',
  'boiler_control_box',
] as const

export const REFINERY_AUXILIARY_UNIT_CORE_PART_ROLES = [
  'flare_stack',
  'knockout_drum',
  'main_pipe_header',
  'pipe_rack_support_frame',
  'boiler_body',
  'steam_header',
] as const

function vec3(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z]
}

function auxiliaryVariant(
  profileId: string | undefined,
  params: Record<string, EquipmentParamValue> | undefined,
): RefineryAuxiliaryVariant {
  const explicit = params?.variant
  if (explicit === 'flare' || explicit === 'pipe-rack' || explicit === 'boiler') return explicit
  const profile = profileId ?? ''
  if (/flare/i.test(profile)) return 'flare'
  if (/pipe[_-]?rack|rack/i.test(profile)) return 'pipe-rack'
  if (/boiler|utility/i.test(profile)) return 'boiler'
  return 'pipe-rack'
}

function auxiliaryRoles(
  profileId: string | undefined,
  params: Record<string, EquipmentParamValue> | undefined,
): AuxiliaryRoles {
  const variant = auxiliaryVariant(profileId, params)
  if (variant === 'flare') {
    return {
      variant,
      primaryRole: stringParam(params, 'primaryRole', 'flare_stack'),
      vesselRole: stringParam(params, 'vesselRole', 'knockout_drum'),
      pipeRole: stringParam(params, 'pipeRole', 'relief_gas_inlet'),
    }
  }
  if (variant === 'boiler') {
    return {
      variant,
      primaryRole: stringParam(params, 'primaryRole', 'boiler_body'),
      vesselRole: stringParam(params, 'vesselRole', 'steam_drum'),
      pipeRole: stringParam(params, 'pipeRole', 'steam_header'),
      stackRole: stringParam(params, 'stackRole', 'boiler_stack'),
      controlRole: stringParam(params, 'controlRole', 'boiler_control_box'),
    }
  }
  return {
    variant,
    primaryRole: stringParam(params, 'primaryRole', 'main_pipe_header'),
    pipeRole: stringParam(params, 'pipeRole', 'parallel_pipe_run'),
    frameRole: stringParam(params, 'frameRole', 'pipe_rack_support_frame'),
  }
}

function colorParam(input: {
  key: string
  label: string
  role: string
  color: string
}): SemanticRecipeEditableParam {
  return {
    key: input.key,
    label: input.label,
    kind: 'color',
    defaultValue: input.color,
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-material', partRole: input.role, property: 'color' },
    ],
  }
}

function editableParamsForRoles(roles: AuxiliaryRoles): readonly SemanticRecipeEditableParam[] {
  const params: SemanticRecipeEditableParam[] = [
    colorParam({
      key: 'primaryColor',
      label: 'Primary color',
      role: roles.primaryRole,
      color: roles.variant === 'flare' ? '#e5e7eb' : '#94a3b8',
    }),
  ]
  if (roles.vesselRole) {
    params.push(
      colorParam({
        key: 'vesselColor',
        label: 'Vessel color',
        role: roles.vesselRole,
        color: '#9ca3af',
      }),
    )
  }
  if (roles.pipeRole) {
    params.push(
      colorParam({
        key: 'pipeColor',
        label: 'Pipe color',
        role: roles.pipeRole,
        color: '#64748b',
      }),
    )
  }
  if (roles.stackRole) {
    params.push(
      colorParam({
        key: 'stackColor',
        label: 'Stack color',
        role: roles.stackRole,
        color: '#cbd5e1',
      }),
    )
  }
  if (roles.controlRole) {
    params.push(
      colorParam({
        key: 'controlColor',
        label: 'Control box color',
        role: roles.controlRole,
        color: '#475569',
      }),
    )
  }
  return params
}

export const REFINERY_AUXILIARY_UNIT_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] =
  editableParamsForRoles({
    variant: 'flare',
    primaryRole: 'flare_stack',
    vesselRole: 'knockout_drum',
    pipeRole: 'relief_gas_inlet',
  })

function horizontalVessel(input: {
  id: string
  role: string
  x: number
  y?: number
  z: number
  length: number
  radius: number
  color: string
}): FactorySemanticRecipePart {
  return {
    id: input.id,
    kind: 'cylindrical_tank',
    semanticRole: input.role,
    axis: 'x',
    length: input.length,
    height: input.length,
    radius: input.radius,
    position: vec3(input.x, input.y ?? input.radius * 1.18, input.z),
    primaryColor: input.color,
    material: {
      properties: { color: input.color, roughness: 0.48, metalness: 0.36 },
    },
  }
}

function buildFlareParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: AuxiliaryRoles
}): FactorySemanticRecipePart[] {
  const stackColor = stringParam(input.params, 'primaryColor', '#e5e7eb')
  const vesselColor = stringParam(input.params, 'vesselColor', '#9ca3af')
  const pipeColor = stringParam(input.params, 'pipeColor', '#64748b')
  const stackHeight = Math.max(6, numberParam(input.params, 'stackHeight', input.height * 0.96))
  const stackRole = input.roles.primaryRole
  const vesselRole = input.roles.vesselRole ?? 'knockout_drum'
  const pipeRole = input.roles.pipeRole ?? 'relief_gas_inlet'
  return [
    {
      id: 'flare_stack',
      kind: 'chimney_stack',
      semanticRole: stackRole,
      position: vec3(-input.length * 0.2, stackHeight / 2, 0),
      height: stackHeight,
      radius: Math.max(0.16, input.width * 0.1),
      warningStripes: true,
      primaryColor: stackColor,
      material: { properties: { color: stackColor, roughness: 0.55, metalness: 0.2 } },
    },
    horizontalVessel({
      id: 'knockout_drum',
      role: vesselRole,
      x: input.length * 0.28,
      z: input.width * 0.22,
      length: Math.max(1.6, input.length * 0.5),
      radius: Math.max(0.26, input.width * 0.13),
      color: vesselColor,
    }),
    {
      id: 'relief_gas_inlet',
      kind: 'pipe_run',
      semanticRole: pipeRole,
      axis: 'y',
      position: vec3(input.length * 0.28, Math.max(0.8, input.height * 0.12), input.width * 0.22),
      length: Math.max(1.1, input.height * 0.14),
      radius: Math.max(0.045, input.width * 0.022),
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
    {
      id: 'flare_inlet_header',
      kind: 'pipe_run',
      semanticRole: 'flare_inlet_header',
      axis: 'x',
      position: vec3(input.length * 0.05, Math.max(0.52, input.height * 0.07), input.width * 0.22),
      length: Math.max(1.8, input.length * 0.72),
      radius: Math.max(0.045, input.width * 0.02),
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
  ]
}

function buildPipeRackParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: AuxiliaryRoles
}): FactorySemanticRecipePart[] {
  const headerColor = stringParam(input.params, 'primaryColor', '#94a3b8')
  const pipeColor = stringParam(input.params, 'pipeColor', '#64748b')
  const frameRole = input.roles.frameRole ?? 'pipe_rack_support_frame'
  const pipeRole = input.roles.pipeRole ?? 'parallel_pipe_run'
  return [
    {
      id: 'rack_frame',
      kind: 'structural_tower_frame',
      semanticRole: frameRole,
      position: vec3(0, input.height * 0.48, 0),
      length: input.length,
      width: input.width,
      height: Math.max(1.6, input.height),
      levelCount: 2,
      stairFlights: 0,
      primaryColor: '#64748b',
    },
    {
      id: 'main_header',
      kind: 'pipe_manifold',
      semanticRole: input.roles.primaryRole,
      position: vec3(0, input.height * 0.9, input.width * 0.18),
      length: Math.max(2.4, input.length * 0.86),
      radius: Math.max(0.05, input.width * 0.04),
      count: 6,
      primaryColor: headerColor,
      material: { properties: { color: headerColor, roughness: 0.34, metalness: 0.55 } },
    },
    {
      id: 'parallel_run',
      kind: 'pipe_run',
      semanticRole: pipeRole,
      position: vec3(0, input.height * 0.62, -input.width * 0.18),
      length: Math.max(2.4, input.length * 0.86),
      radius: Math.max(0.04, input.width * 0.035),
      axis: 'x',
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
  ]
}

function buildBoilerParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: AuxiliaryRoles
}): FactorySemanticRecipePart[] {
  const bodyColor = stringParam(input.params, 'primaryColor', '#9ca3af')
  const vesselColor = stringParam(input.params, 'vesselColor', '#cbd5e1')
  const pipeColor = stringParam(input.params, 'pipeColor', '#64748b')
  const stackColor = stringParam(input.params, 'stackColor', '#cbd5e1')
  const controlColor = stringParam(input.params, 'controlColor', '#475569')
  const stackRole = input.roles.stackRole ?? 'boiler_stack'
  const drumRole = input.roles.vesselRole ?? 'steam_drum'
  const pipeRole = input.roles.pipeRole ?? 'steam_header'
  const controlRole = input.roles.controlRole ?? 'boiler_control_box'
  return [
    {
      id: 'boiler_body',
      kind: 'generic_body',
      semanticRole: input.roles.primaryRole,
      position: vec3(-input.length * 0.08, Math.max(0.68, input.height * 0.22), 0),
      length: Math.max(2.2, input.length * 0.74),
      width: Math.max(1.0, input.width * 0.56),
      height: Math.max(1.1, input.height * 0.38),
      primaryColor: bodyColor,
      cornerRadius: 0.08,
      material: { properties: { color: bodyColor, roughness: 0.6, metalness: 0.25 } },
    },
    horizontalVessel({
      id: 'steam_drum',
      role: drumRole,
      x: -input.length * 0.08,
      y: input.height * 0.52,
      z: 0,
      length: Math.max(1.8, input.length * 0.64),
      radius: Math.max(0.18, input.width * 0.11),
      color: vesselColor,
    }),
    horizontalVessel({
      id: 'mud_drum',
      role: 'mud_drum',
      x: -input.length * 0.08,
      y: input.height * 0.18,
      z: -input.width * 0.05,
      length: Math.max(1.6, input.length * 0.58),
      radius: Math.max(0.12, input.width * 0.07),
      color: '#94a3b8',
    }),
    {
      id: 'tube_bank',
      kind: 'pipe_manifold',
      semanticRole: 'boiler_tube_bank',
      position: vec3(-input.length * 0.08, input.height * 0.34, input.width * 0.32),
      length: Math.max(1.8, input.length * 0.62),
      radius: Math.max(0.035, input.width * 0.018),
      count: 7,
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
    {
      id: 'boiler_stack',
      kind: 'chimney_stack',
      semanticRole: stackRole,
      position: vec3(input.length * 0.34, input.height * 0.48, -input.width * 0.34),
      height: Math.max(2.6, input.height),
      radius: Math.max(0.12, input.width * 0.07),
      warningStripes: true,
      primaryColor: stackColor,
      material: { properties: { color: stackColor, roughness: 0.52, metalness: 0.22 } },
    },
    {
      id: 'steam_header',
      kind: 'pipe_manifold',
      semanticRole: pipeRole,
      position: vec3(0, input.height * 0.66, input.width * 0.08),
      length: Math.max(2.0, input.length * 0.68),
      radius: Math.max(0.04, input.width * 0.022),
      count: 3,
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
    {
      id: 'control_box',
      kind: 'control_box',
      semanticRole: controlRole,
      position: vec3(input.length * 0.34, input.height * 0.18, input.width * 0.36),
      length: Math.max(0.46, input.length * 0.13),
      width: Math.max(0.18, input.width * 0.1),
      height: Math.max(0.58, input.height * 0.22),
      primaryColor: controlColor,
      material: { properties: { color: controlColor, roughness: 0.48, metalness: 0.28 } },
    },
  ]
}

export function buildRefineryAuxiliaryUnitProfileParts(input: {
  length: number
  width: number
  height: number
  profileId?: string
  params?: Record<string, EquipmentParamValue>
}): FactorySemanticRecipePart[] {
  const roles = auxiliaryRoles(input.profileId, input.params)
  if (roles.variant === 'flare') return buildFlareParts({ ...input, roles })
  if (roles.variant === 'boiler') return buildBoilerParts({ ...input, roles })
  return buildPipeRackParts({ ...input, roles })
}

export function buildRefineryAuxiliaryUnitPorts(input: {
  variant?: RefineryAuxiliaryVariant
  height?: number
  medium?: string
} = {}): SemanticRecipePort[] {
  const height = input.height ?? 3
  const medium = input.medium ?? 'material'
  if (input.variant === 'flare') {
    return [
      { id: 'relief_gas_in', role: 'process-inlet', medium: 'gas', side: 'left', height: height * 0.12, offset: 0 },
      { id: 'flare_tip', role: 'process-outlet', medium: 'gas', side: 'top', height: height * 0.96, offset: 0 },
    ]
  }
  if (input.variant === 'boiler') {
    return [
      { id: 'fuel_gas_in', role: 'process-inlet', medium: 'gas', side: 'left', height: height * 0.22, offset: 0 },
      { id: 'steam_out', role: 'process-outlet', medium: 'gas', side: 'right', height: height * 0.62, offset: 0 },
    ]
  }
  return [
    { id: 'rack_in', role: 'process-inlet', medium, side: 'left', height: height * 0.72, offset: 0 },
    { id: 'rack_out', role: 'process-outlet', medium, side: 'right', height: height * 0.72, offset: 0 },
  ]
}

export const refineryAuxiliaryUnitRecipe: SemanticRecipeDefinition = {
  id: REFINERY_AUXILIARY_UNIT_RECIPE_ID,
  label: 'Refinery auxiliary unit',
  family: 'refinery_auxiliary',
  acceptsProfiles: [
    'refinery.flare_system',
    'refinery.pipe_rack',
    'refinery.utility_boiler',
  ],
  paramSchema: {
    fields: [
      'length',
      'width',
      'height',
      'variant',
      'primaryRole',
      'vesselRole',
      'pipeRole',
      'stackRole',
      'frameRole',
      'controlRole',
      'primaryColor',
      'vesselColor',
      'pipeColor',
      'stackColor',
      'controlColor',
    ],
  },
  defaultEnvelope: { length: 5, width: 2, height: 4 },
  editableParams: REFINERY_AUXILIARY_UNIT_EDITABLE_PARAMS,
  editablePartRoles: REFINERY_AUXILIARY_UNIT_EDITABLE_PART_ROLES,
  corePartRoles: REFINERY_AUXILIARY_UNIT_CORE_PART_ROLES,
  compose: ({ params, envelope, profileId, medium }) => {
    const length = envelope?.length ?? 5
    const width = envelope?.width ?? 2
    const height = envelope?.height ?? 4
    const roles = auxiliaryRoles(profileId, params)
    const corePartRoles = [
      roles.primaryRole,
      roles.vesselRole,
      roles.pipeRole,
      roles.stackRole,
      roles.frameRole,
      roles.controlRole,
    ].filter((role): role is string => Boolean(role))
    return {
      parts: buildRefineryAuxiliaryUnitProfileParts({ length, width, height, profileId, params }),
      ports: buildRefineryAuxiliaryUnitPorts({ variant: roles.variant, height, medium }),
      envelope: { length, width, height, tolerance: envelope?.tolerance },
      editableParams: editableParamsForRoles(roles),
      editablePartRoles: corePartRoles,
      corePartRoles,
      primarySemanticRole: roles.primaryRole,
    }
  },
}
