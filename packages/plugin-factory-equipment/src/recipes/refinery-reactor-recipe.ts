import type {
  EquipmentParamValue,
  SemanticRecipeDefinition,
  SemanticRecipeEditableParam,
  SemanticRecipePort,
} from '@pascal-app/core'
import { numberParam, stringParam, type FactorySemanticRecipePart } from './common'

export const REFINERY_REACTOR_UNIT_RECIPE_ID = 'factory:refinery-reactor-unit'

type RefineryReactorVariant = 'fcc' | 'hydrotreating' | 'reformer' | 'sulfur'

type ReactorRoles = {
  variant: RefineryReactorVariant
  primaryRole: string
  secondaryRole?: string
  heaterRole?: string
  exchangerRole?: string
  separatorRole?: string
  pipeRole?: string
  stackRole?: string
  cycloneRole?: string
}

export const REFINERY_REACTOR_UNIT_EDITABLE_PART_ROLES = [
  'fcc_reactor',
  'catalyst_regenerator',
  'main_fractionator',
  'riser_pipe',
  'cyclone_separator',
  'flue_gas_stack',
  'hydrotreater_reactor',
  'high_pressure_separator',
  'hydrogen_header',
  'reformer_reactor_train',
  'reformer_fired_heater',
  'reformer_separator',
  'hydrogen_rich_gas_header',
  'claus_reactor',
  'tail_gas_stack',
  'heat_exchanger_shell',
] as const

export const REFINERY_REACTOR_UNIT_CORE_PART_ROLES = [
  'fcc_reactor',
  'catalyst_regenerator',
  'riser_pipe',
  'cyclone_separator',
] as const

function vec3(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z]
}

function reactorVariant(
  profileId: string | undefined,
  params: Record<string, EquipmentParamValue> | undefined,
): RefineryReactorVariant {
  const explicit = params?.variant
  if (explicit === 'fcc' || explicit === 'hydrotreating' || explicit === 'reformer' || explicit === 'sulfur') {
    return explicit
  }
  const profile = profileId ?? ''
  if (/fluid_catalytic_cracking|fcc/i.test(profile)) return 'fcc'
  if (/hydrotreat/i.test(profile)) return 'hydrotreating'
  if (/reformer/i.test(profile)) return 'reformer'
  if (/sulfur|claus/i.test(profile)) return 'sulfur'
  return 'hydrotreating'
}

function reactorRoles(
  profileId: string | undefined,
  params: Record<string, EquipmentParamValue> | undefined,
): ReactorRoles {
  const variant = reactorVariant(profileId, params)
  if (variant === 'fcc') {
    return {
      variant,
      primaryRole: stringParam(params, 'primaryRole', 'fcc_reactor'),
      secondaryRole: stringParam(params, 'secondaryRole', 'catalyst_regenerator'),
      separatorRole: stringParam(params, 'separatorRole', 'main_fractionator'),
      pipeRole: stringParam(params, 'pipeRole', 'riser_pipe'),
      stackRole: stringParam(params, 'stackRole', 'flue_gas_stack'),
      cycloneRole: stringParam(params, 'cycloneRole', 'cyclone_separator'),
    }
  }
  if (variant === 'reformer') {
    return {
      variant,
      primaryRole: stringParam(params, 'primaryRole', 'reformer_reactor_train'),
      heaterRole: stringParam(params, 'heaterRole', 'reformer_fired_heater'),
      exchangerRole: stringParam(params, 'exchangerRole', 'heat_exchanger_shell'),
      separatorRole: stringParam(params, 'separatorRole', 'reformer_separator'),
      pipeRole: stringParam(params, 'pipeRole', 'hydrogen_rich_gas_header'),
    }
  }
  if (variant === 'sulfur') {
    return {
      variant,
      primaryRole: stringParam(params, 'primaryRole', 'claus_reactor'),
      exchangerRole: stringParam(params, 'exchangerRole', 'heat_exchanger_shell'),
      stackRole: stringParam(params, 'stackRole', 'tail_gas_stack'),
    }
  }
  return {
    variant,
    primaryRole: stringParam(params, 'primaryRole', 'hydrotreater_reactor'),
    exchangerRole: stringParam(params, 'exchangerRole', 'heat_exchanger_shell'),
    separatorRole: stringParam(params, 'separatorRole', 'high_pressure_separator'),
    pipeRole: stringParam(params, 'pipeRole', 'hydrogen_header'),
  }
}

function materialColorParam(input: {
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

function editableParamsForRoles(roles: ReactorRoles): readonly SemanticRecipeEditableParam[] {
  const params: SemanticRecipeEditableParam[] = [
    materialColorParam({
      key: 'primaryVesselColor',
      label: 'Primary vessel color',
      role: roles.primaryRole,
      color: '#d1d5db',
    }),
  ]
  if (roles.secondaryRole) {
    params.push(
      materialColorParam({
        key: 'secondaryVesselColor',
        label: 'Secondary vessel color',
        role: roles.secondaryRole,
        color: '#bfc7d5',
      }),
    )
  }
  if (roles.heaterRole) {
    params.push(
      materialColorParam({
        key: 'heaterColor',
        label: 'Heater color',
        role: roles.heaterRole,
        color: '#9ca3af',
      }),
    )
  }
  if (roles.exchangerRole) {
    params.push(
      materialColorParam({
        key: 'exchangerColor',
        label: 'Exchanger color',
        role: roles.exchangerRole,
        color: '#94a3b8',
      }),
    )
  }
  if (roles.pipeRole) {
    params.push(
      materialColorParam({
        key: 'pipeColor',
        label: 'Pipe/header color',
        role: roles.pipeRole,
        color: '#64748b',
      }),
    )
  }
  if (roles.stackRole) {
    params.push(
      materialColorParam({
        key: 'stackColor',
        label: 'Stack color',
        role: roles.stackRole,
        color: '#cbd5e1',
      }),
    )
  }
  return params
}

export const REFINERY_REACTOR_UNIT_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] =
  editableParamsForRoles({
    variant: 'fcc',
    primaryRole: 'fcc_reactor',
    secondaryRole: 'catalyst_regenerator',
    pipeRole: 'riser_pipe',
    stackRole: 'flue_gas_stack',
    cycloneRole: 'cyclone_separator',
  })

function verticalVessel(input: {
  id: string
  role: string
  x: number
  z: number
  height: number
  radius: number
  color: string
}): FactorySemanticRecipePart {
  return {
    id: input.id,
    kind: 'cylindrical_tank',
    semanticRole: input.role,
    axis: 'y',
    height: input.height,
    length: input.height,
    radius: input.radius,
    position: vec3(input.x, input.height / 2 + input.radius * 0.18, input.z),
    primaryColor: input.color,
    material: {
      properties: { color: input.color, roughness: 0.46, metalness: 0.35 },
    },
  }
}

function horizontalVessel(input: {
  id: string
  role: string
  x: number
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
    position: vec3(input.x, input.radius * 1.18, input.z),
    primaryColor: input.color,
    material: {
      properties: { color: input.color, roughness: 0.46, metalness: 0.35 },
    },
  }
}

function heatExchangerPart(input: {
  x: number
  z: number
  length: number
  radius: number
  color: string
}): FactorySemanticRecipePart {
  return {
    id: 'exchanger',
    kind: 'heat_exchanger',
    semanticRole: 'heat_exchanger_shell',
    axis: 'x',
    position: vec3(input.x, Math.max(0.58, input.radius * 1.65), input.z),
    length: input.length,
    radius: input.radius,
    primaryColor: input.color,
    material: {
      properties: { color: input.color, roughness: 0.42, metalness: 0.48 },
    },
  }
}

function buildFccParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: ReactorRoles
}): FactorySemanticRecipePart[] {
  const primaryColor = stringParam(input.params, 'primaryVesselColor', '#d1d5db')
  const secondaryColor = stringParam(input.params, 'secondaryVesselColor', '#bfc7d5')
  const pipeColor = stringParam(input.params, 'pipeColor', '#64748b')
  const stackColor = stringParam(input.params, 'stackColor', '#cbd5e1')
  const reactorHeight = Math.max(3.8, numberParam(input.params, 'reactorHeight', input.height * 0.8))
  const regeneratorHeight = Math.max(3.4, numberParam(input.params, 'regeneratorHeight', input.height * 0.72))
  const fractionatorHeight = Math.max(4, input.height * 0.86)
  const primaryRole = input.roles.primaryRole
  const secondaryRole = input.roles.secondaryRole ?? 'catalyst_regenerator'
  const separatorRole = input.roles.separatorRole ?? 'main_fractionator'
  const pipeRole = input.roles.pipeRole ?? 'riser_pipe'
  const stackRole = input.roles.stackRole ?? 'flue_gas_stack'
  const cycloneRole = input.roles.cycloneRole ?? 'cyclone_separator'
  return [
    verticalVessel({
      id: 'reactor',
      role: primaryRole,
      x: -input.length * 0.28,
      z: -input.width * 0.12,
      height: reactorHeight,
      radius: Math.max(0.42, input.width * 0.14),
      color: primaryColor,
    }),
    verticalVessel({
      id: 'regenerator',
      role: secondaryRole,
      x: -input.length * 0.02,
      z: input.width * 0.12,
      height: regeneratorHeight,
      radius: Math.max(0.5, input.width * 0.17),
      color: secondaryColor,
    }),
    verticalVessel({
      id: 'fractionator',
      role: separatorRole,
      x: input.length * 0.28,
      z: -input.width * 0.1,
      height: fractionatorHeight,
      radius: Math.max(0.38, input.width * 0.12),
      color: '#d9dee8',
    }),
    {
      id: 'riser',
      kind: 'pipe_run',
      semanticRole: pipeRole,
      axis: 'y',
      position: vec3(-input.length * 0.17, reactorHeight * 0.48, 0),
      length: Math.max(2.1, input.height * 0.46),
      radius: Math.max(0.07, input.width * 0.02),
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.36, metalness: 0.5 } },
    },
    {
      id: 'cyclone',
      kind: 'cyclone_separator_unit',
      semanticRole: cycloneRole,
      position: vec3(-input.length * 0.03, regeneratorHeight * 0.76, input.width * 0.04),
      height: Math.max(1.0, input.height * 0.18),
      radius: Math.max(0.22, input.width * 0.055),
      primaryColor: '#cbd5e1',
    },
    {
      id: 'stack',
      kind: 'chimney_stack',
      semanticRole: stackRole,
      position: vec3(input.length * 0.04, regeneratorHeight + input.height * 0.24, input.width * 0.3),
      height: Math.max(3.2, input.height * 0.72),
      radius: Math.max(0.18, input.width * 0.055),
      primaryColor: stackColor,
      material: { properties: { color: stackColor, roughness: 0.52, metalness: 0.22 } },
    },
    {
      id: 'platform',
      kind: 'service_platform',
      semanticRole: 'service_platform',
      position: vec3(-input.length * 0.16, input.height * 0.52, input.width * 0.24),
      length: Math.max(1.4, input.length * 0.26),
      width: Math.max(0.8, input.width * 0.22),
      height: Math.max(2.4, input.height * 0.42),
    },
    {
      id: 'feed_inlet',
      kind: 'inlet_port',
      semanticRole: 'vacuum_gas_oil_inlet',
      position: vec3(-input.length * 0.42, input.height * 0.18, -input.width * 0.12),
      axis: 'x',
      radius: Math.max(0.08, input.width * 0.025),
    },
    {
      id: 'product_outlet',
      kind: 'outlet_port',
      semanticRole: 'cracked_product_outlet',
      position: vec3(input.length * 0.42, input.height * 0.38, -input.width * 0.1),
      axis: 'x',
      radius: Math.max(0.08, input.width * 0.025),
    },
  ]
}

function buildHydrotreatingParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: ReactorRoles
}): FactorySemanticRecipePart[] {
  const primaryColor = stringParam(input.params, 'primaryVesselColor', '#cbd5e1')
  const exchangerColor = stringParam(input.params, 'exchangerColor', '#94a3b8')
  const pipeColor = stringParam(input.params, 'pipeColor', '#38bdf8')
  const separatorRole = input.roles.separatorRole ?? 'high_pressure_separator'
  const pipeRole = input.roles.pipeRole ?? 'hydrogen_header'
  return [
    verticalVessel({
      id: 'reactor',
      role: input.roles.primaryRole,
      x: -input.length * 0.26,
      z: -input.width * 0.14,
      height: Math.max(2.8, input.height * 0.88),
      radius: Math.max(0.34, input.width * 0.15),
      color: primaryColor,
    }),
    heatExchangerPart({
      x: input.length * 0.05,
      z: -input.width * 0.26,
      length: Math.max(1.6, input.length * 0.38),
      radius: Math.max(0.22, input.width * 0.09),
      color: exchangerColor,
    }),
    horizontalVessel({
      id: 'separator',
      role: separatorRole,
      x: input.length * 0.25,
      z: input.width * 0.22,
      length: Math.max(1.8, input.length * 0.45),
      radius: Math.max(0.3, input.width * 0.13),
      color: '#dbe3ee',
    }),
    {
      id: 'hydrogen_header',
      kind: 'pipe_manifold',
      semanticRole: pipeRole,
      position: vec3(0, input.height * 0.4, input.width * 0.3),
      length: Math.max(2, input.length * 0.5),
      radius: Math.max(0.055, input.width * 0.02),
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
    { id: 'hydrogen_inlet', kind: 'inlet_port', semanticRole: 'hydrogen_inlet', side: 'back' },
    { id: 'product_outlet', kind: 'outlet_port', semanticRole: 'treated_product_outlet', side: 'right' },
  ]
}

function buildReformerParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: ReactorRoles
}): FactorySemanticRecipePart[] {
  const primaryColor = stringParam(input.params, 'primaryVesselColor', '#d1d5db')
  const heaterColor = stringParam(input.params, 'heaterColor', '#9ca3af')
  const exchangerColor = stringParam(input.params, 'exchangerColor', '#94a3b8')
  const pipeColor = stringParam(input.params, 'pipeColor', '#38bdf8')
  const heaterRole = input.roles.heaterRole ?? 'reformer_fired_heater'
  const separatorRole = input.roles.separatorRole ?? 'reformer_separator'
  const pipeRole = input.roles.pipeRole ?? 'hydrogen_rich_gas_header'
  return [
    verticalVessel({
      id: 'reactor_train',
      role: input.roles.primaryRole,
      x: -input.length * 0.28,
      z: -input.width * 0.14,
      height: Math.max(2.6, input.height * 0.86),
      radius: Math.max(0.3, input.width * 0.13),
      color: primaryColor,
    }),
    {
      id: 'heater',
      kind: 'generic_body',
      semanticRole: heaterRole,
      position: vec3(0, Math.max(0.9, input.height * 0.24), input.width * 0.22),
      length: Math.max(1.4, input.length * 0.25),
      width: Math.max(0.78, input.width * 0.25),
      height: Math.max(1.3, input.height * 0.45),
      primaryColor: heaterColor,
      material: { properties: { color: heaterColor, roughness: 0.62, metalness: 0.24 } },
    },
    heatExchangerPart({
      x: input.length * 0.16,
      z: -input.width * 0.26,
      length: Math.max(1.6, input.length * 0.32),
      radius: Math.max(0.2, input.width * 0.085),
      color: exchangerColor,
    }),
    horizontalVessel({
      id: 'separator',
      role: separatorRole,
      x: input.length * 0.3,
      z: input.width * 0.2,
      length: Math.max(1.6, input.length * 0.36),
      radius: Math.max(0.28, input.width * 0.12),
      color: '#dbe3ee',
    }),
    {
      id: 'hydrogen_header',
      kind: 'pipe_manifold',
      semanticRole: pipeRole,
      position: vec3(input.length * 0.14, input.height * 0.78, input.width * 0.28),
      length: Math.max(2.0, input.length * 0.42),
      radius: Math.max(0.05, input.width * 0.018),
      primaryColor: pipeColor,
      material: { properties: { color: pipeColor, roughness: 0.34, metalness: 0.55 } },
    },
    { id: 'naphtha_inlet', kind: 'inlet_port', semanticRole: 'naphtha_inlet', side: 'left' },
    { id: 'reformate_outlet', kind: 'outlet_port', semanticRole: 'reformate_outlet', side: 'right' },
  ]
}

function buildSulfurParts(input: {
  length: number
  width: number
  height: number
  params?: Record<string, EquipmentParamValue>
  roles: ReactorRoles
}): FactorySemanticRecipePart[] {
  const primaryColor = stringParam(input.params, 'primaryVesselColor', '#9ca3af')
  const exchangerColor = stringParam(input.params, 'exchangerColor', '#94a3b8')
  const stackColor = stringParam(input.params, 'stackColor', '#cbd5e1')
  const stackRole = input.roles.stackRole ?? 'tail_gas_stack'
  return [
    horizontalVessel({
      id: 'reactor',
      role: input.roles.primaryRole,
      x: -input.length * 0.18,
      z: -input.width * 0.14,
      length: Math.max(1.8, input.length * 0.42),
      radius: Math.max(0.3, input.width * 0.16),
      color: primaryColor,
    }),
    heatExchangerPart({
      x: input.length * 0.22,
      z: -input.width * 0.14,
      length: Math.max(1.4, input.length * 0.34),
      radius: Math.max(0.2, input.width * 0.1),
      color: exchangerColor,
    }),
    {
      id: 'stack',
      kind: 'chimney_stack',
      semanticRole: stackRole,
      position: vec3(input.length * 0.28, input.height * 0.42, input.width * 0.24),
      height: Math.max(2.8, input.height * 0.82),
      radius: Math.max(0.12, input.width * 0.06),
      primaryColor: stackColor,
      material: { properties: { color: stackColor, roughness: 0.52, metalness: 0.22 } },
    },
    { id: 'acid_gas_inlet', kind: 'inlet_port', semanticRole: 'acid_gas_inlet', side: 'left' },
    { id: 'sulfur_outlet', kind: 'outlet_port', semanticRole: 'sulfur_outlet', side: 'right' },
  ]
}

export function buildRefineryReactorUnitProfileParts(input: {
  length: number
  width: number
  height: number
  profileId?: string
  params?: Record<string, EquipmentParamValue>
}): FactorySemanticRecipePart[] {
  const roles = reactorRoles(input.profileId, input.params)
  if (roles.variant === 'fcc') return buildFccParts({ ...input, roles })
  if (roles.variant === 'reformer') return buildReformerParts({ ...input, roles })
  if (roles.variant === 'sulfur') return buildSulfurParts({ ...input, roles })
  return buildHydrotreatingParts({ ...input, roles })
}

export function buildRefineryReactorUnitPorts(input: {
  variant?: RefineryReactorVariant
  height?: number
  medium?: string
} = {}): SemanticRecipePort[] {
  const height = input.height ?? 4.8
  const medium = input.medium ?? 'material'
  if (input.variant === 'fcc') {
    return [
      { id: 'vacuum_gas_oil_in', role: 'process-inlet', medium, side: 'left', height: height * 0.18, offset: -0.3 },
      { id: 'cracked_product_out', role: 'process-outlet', medium, side: 'right', height: height * 0.44, offset: 0 },
      { id: 'rich_gas_out', role: 'process-outlet', medium: 'gas', side: 'top', height: height * 0.9, offset: 0.25 },
      { id: 'flue_gas_out', role: 'process-outlet', medium: 'gas', side: 'top', height: height * 0.95, offset: -0.25 },
    ]
  }
  if (input.variant === 'reformer') {
    return [
      { id: 'naphtha_in', role: 'process-inlet', medium, side: 'left', height: height * 0.22, offset: 0 },
      { id: 'reformate_out', role: 'process-outlet', medium, side: 'right', height: height * 0.2, offset: 0 },
      { id: 'hydrogen_rich_gas_out', role: 'process-outlet', medium: 'hydrogen', side: 'top', height: height * 0.84, offset: 0.25 },
    ]
  }
  if (input.variant === 'sulfur') {
    return [
      { id: 'acid_gas_in', role: 'process-inlet', medium: 'gas', side: 'left', height: height * 0.25, offset: 0 },
      { id: 'sulfur_out', role: 'process-outlet', medium, side: 'right', height: height * 0.18, offset: 0 },
      { id: 'tail_gas_out', role: 'process-outlet', medium: 'gas', side: 'top', height: height * 0.9, offset: 0 },
    ]
  }
  return [
    { id: 'hydrotreater_feed_in', role: 'process-inlet', medium, side: 'left', height: height * 0.2, offset: 0 },
    { id: 'hydrogen_in', role: 'process-inlet', medium: 'hydrogen', side: 'back', height: height * 0.4, offset: 0.4 },
    { id: 'treated_product_out', role: 'process-outlet', medium, side: 'right', height: height * 0.22, offset: 0 },
    { id: 'acid_gas_out', role: 'process-outlet', medium: 'gas', side: 'top', height: height * 0.96, offset: 0 },
  ]
}

export const refineryReactorUnitRecipe: SemanticRecipeDefinition = {
  id: REFINERY_REACTOR_UNIT_RECIPE_ID,
  label: 'Refinery reactor unit',
  family: 'reactor',
  acceptsProfiles: [
    'reactor',
    'refinery.fluid_catalytic_cracking_unit',
    'refinery.hydrotreating_unit',
    'refinery.catalytic_reformer_unit',
    'refinery.sulfur_recovery_unit',
  ],
  paramSchema: {
    fields: [
      'length',
      'width',
      'height',
      'variant',
      'primaryRole',
      'secondaryRole',
      'heaterRole',
      'exchangerRole',
      'separatorRole',
      'pipeRole',
      'stackRole',
      'cycloneRole',
      'primaryVesselColor',
      'secondaryVesselColor',
      'heaterColor',
      'exchangerColor',
      'pipeColor',
      'stackColor',
    ],
  },
  defaultEnvelope: { length: 6.4, width: 3.4, height: 4.8 },
  editableParams: REFINERY_REACTOR_UNIT_EDITABLE_PARAMS,
  editablePartRoles: REFINERY_REACTOR_UNIT_EDITABLE_PART_ROLES,
  corePartRoles: REFINERY_REACTOR_UNIT_CORE_PART_ROLES,
  compose: ({ params, envelope, profileId, medium }) => {
    const length = envelope?.length ?? 6.4
    const width = envelope?.width ?? 3.4
    const height = envelope?.height ?? 4.8
    const roles = reactorRoles(profileId, params)
    const corePartRoles = [
      roles.primaryRole,
      roles.secondaryRole,
      roles.heaterRole,
      roles.exchangerRole,
      roles.separatorRole,
      roles.pipeRole,
      roles.stackRole,
      roles.cycloneRole,
    ].filter((role): role is string => Boolean(role))
    return {
      parts: buildRefineryReactorUnitProfileParts({ length, width, height, profileId, params }),
      ports: buildRefineryReactorUnitPorts({ variant: roles.variant, height, medium }),
      envelope: { length, width, height, tolerance: envelope?.tolerance },
      editableParams: editableParamsForRoles(roles),
      editablePartRoles: [...corePartRoles, 'service_platform'],
      corePartRoles,
      primarySemanticRole: roles.primaryRole,
    }
  },
}
