import {
  composePartPrimitives,
  type PartComposeInput,
  type PartComposePartInput,
} from './part-compose'
import type { PrimitiveGeometryBrief, PrimitiveShapeInput, Vec3 } from './primitive-compose'
import { composeRobotArmPrimitives, type RobotArmComposeInput } from './robot-arm-compose'

export type PrimitiveRecipeId =
  | 'gear.spur'
  | 'vehicle.sedan'
  | 'vehicle.suv'
  | 'vehicle.sports'
  | 'vehicle.van'
  | 'vehicle.truck'
  | 'valve.gate'
  | 'valve.ball'
  | 'robotArm.threeAxis'

export interface PrimitiveRecipeParams {
  name?: string
  color?: string
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  darkColor?: string
  metalColor?: string
  size?: 'tiny' | 'small' | 'medium' | 'large' | string
  sizeScale?: number
  length?: number
  width?: number
  height?: number
  detail?: 'low' | 'medium' | 'high' | string
  highFidelity?: boolean
  enhanceVisualDetails?: boolean
  style?: string
  vehicleStyle?: string
  valveStyle?: string
  handleStyle?: string
  axisCount?: number
  baseShape?: 'round' | 'square' | 'pedestal' | string
  endEffector?: 'gripper' | 'suction' | 'tool-flange' | string
  pose?: 'rest' | 'reach-forward' | 'work-ready' | string
  reach?: number
  teeth?: number
  module?: number
  outerDiameter?: number
  pitchDiameter?: number
  rootDiameter?: number
  thickness?: number
  boreDiameter?: number
  keywayWidth?: number
  keywayDepth?: number
  position?: Vec3
}

export interface ComposeRecipeInput extends PrimitiveRecipeParams {
  recipeId?: PrimitiveRecipeId | string
  recipe?: PrimitiveRecipeId | string
  id?: PrimitiveRecipeId | string
  params?: PrimitiveRecipeParams
  geometryBrief?: PrimitiveGeometryBrief
}

export interface PrimitiveRecipeDefinition {
  id: PrimitiveRecipeId
  label: string
  aliases: string[]
  compose: (input: ComposeRecipeInput) => PrimitiveShapeInput[]
  geometryBrief: (input: ComposeRecipeInput) => PrimitiveGeometryBrief
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recipeParams(input: ComposeRecipeInput): PrimitiveRecipeParams {
  return isRecord(input.params) ? { ...input, ...input.params } : input
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function normalizeRecipeId(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_-]+/g, '.')
        .toLowerCase()
    : ''
}

function readRecipeId(input: ComposeRecipeInput): string {
  return normalizeRecipeId(input.recipeId ?? input.recipe ?? input.id)
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function boolValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function sizeScaleFor(params: PrimitiveRecipeParams): number | undefined {
  const explicit = numberValue(params.sizeScale)
  if (explicit != null) return explicit
  switch (textOf(params.size)) {
    case 'tiny':
    case 'mini':
    case 'micro':
      return 0.62
    case 'small':
    case 'compact':
    case 'little':
    case '小':
    case '小型':
      return 0.8
    case 'large':
    case 'big':
    case '大型':
      return 1.18
    default:
      return undefined
  }
}

function nameFor(input: ComposeRecipeInput, fallback: string): string {
  const params = recipeParams(input)
  return stringValue(params.name, input.name, fallback) ?? fallback
}

function colorFor(params: PrimitiveRecipeParams, fallback: string): string {
  return stringValue(params.primaryColor, params.color, fallback) ?? fallback
}

function detailFor(params: PrimitiveRecipeParams): PartComposeInput['detail'] {
  return stringValue(
    params.detail,
    params.highFidelity ? 'high' : undefined,
  ) as PartComposeInput['detail']
}

function positionFor(params: PrimitiveRecipeParams, input: ComposeRecipeInput): Vec3 | undefined {
  return params.position ?? input.position
}

function polarPoint(radius: number, angle: number): [number, number] {
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

function circleProfile(radius: number, segments: number, startAngle = 0): [number, number][] {
  return Array.from({ length: segments }, (_, index) =>
    polarPoint(radius, startAngle + (index / segments) * Math.PI * 2),
  )
}

function spurGearRecipe(): PrimitiveRecipeDefinition {
  const id = 'gear.spur' as PrimitiveRecipeId
  const aliases = ['spur gear', 'gear', 'toothed gear', '直齿齿轮', '齿轮']
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const teeth = Math.max(6, Math.min(160, Math.round(numberValue(params.teeth, 20) ?? 20)))
    const moduleMeters =
      numberValue(params.module) != null ? (numberValue(params.module) as number) / 1000 : undefined
    const pitchDiameter =
      numberValue(params.pitchDiameter) ?? (moduleMeters ? moduleMeters * teeth : undefined)
    const outerDiameter =
      numberValue(params.outerDiameter) ??
      (moduleMeters ? moduleMeters * (teeth + 2) : undefined) ??
      0.099
    const thickness = numberValue(params.thickness, params.height, params.width) ?? 0.02
    const outerRadius = outerDiameter / 2
    const rootRadius =
      (numberValue(params.rootDiameter) ??
        (pitchDiameter ? pitchDiameter - (moduleMeters ?? 0) * 2.5 : undefined)) != null
        ? (numberValue(params.rootDiameter) ??
            (pitchDiameter as number) - (moduleMeters ?? 0) * 2.5)! / 2
        : outerRadius * 0.795
    const boreRadius = (numberValue(params.boreDiameter) ?? 0.025) / 2
    const keywayWidth = numberValue(params.keywayWidth) ?? 0
    const keywayDepth = numberValue(params.keywayDepth) ?? (keywayWidth > 0 ? keywayWidth * 0.5 : 0)

    const profile: [number, number][] = []
    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const base = (tooth / teeth) * Math.PI * 2
      for (const [offset, radius] of [
        [0, rootRadius],
        [0.25, outerRadius],
        [0.75, outerRadius],
        [1, rootRadius],
      ] as const) {
        profile.push(polarPoint(radius, base + (offset / teeth) * Math.PI * 2))
      }
    }

    const boreSegments = Math.max(24, Math.min(96, teeth * 2))
    const bore = circleProfile(boreRadius, boreSegments)
    if (keywayWidth > 0 && keywayDepth > 0) {
      const half = keywayWidth / 2
      const top = boreRadius + keywayDepth
      bore.push([half, boreRadius], [half, top], [-half, top], [-half, boreRadius])
    }

    return [
      {
        kind: 'extrude',
        name: nameFor(input, 'spur gear'),
        semanticRole: 'spur_gear',
        position: positionFor(params, input) ?? [0, thickness / 2, 0],
        rotation: [Math.PI / 2, 0, 0],
        profile,
        holes: [bore],
        depth: thickness,
        bevelSize: Math.min(thickness * 0.03, outerRadius * 0.01),
        bevelThickness: Math.min(thickness * 0.03, outerRadius * 0.01),
        bevelSegments: 1,
        material: {
          properties: {
            color: colorFor(params, '#6B6B6B'),
            roughness: 0.35,
            metalness: 0.9,
          },
        },
      },
    ]
  }

  return {
    id,
    label: 'Spur gear',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      return {
        category: 'gear',
        units: 'm',
        coordinateConvention: '+Y up; extrude lies on ground after rotation',
        requiredRoles: ['spur_gear'],
        validationTargets: [
          `${Math.round(numberValue(params.teeth, 20) ?? 20)} teeth`,
          'outer toothed profile',
          'bore/keyway holes when requested',
        ],
      }
    },
  }
}

function vehicleRecipe(
  style: 'sedan' | 'suv' | 'sports' | 'van' | 'truck',
): PrimitiveRecipeDefinition {
  const id = `vehicle.${style}` as PrimitiveRecipeId
  const label = `Vehicle ${style}`
  const aliases =
    style === 'sedan'
      ? ['car', 'sedan', 'auto', 'vehicle', '小汽车', '轿车', '汽车']
      : [style, `vehicle ${style}`]

  const partInput = (input: ComposeRecipeInput): PartComposeInput => {
    const params = recipeParams(input)
    const color = colorFor(params, '#ef4444')
    const sizeScale = sizeScaleFor(params)
    const highFidelity = boolValue(params.highFidelity, params.enhanceVisualDetails) !== false
    const body: PartComposePartInput = {
      kind: 'vehicle_body',
      primaryColor: color,
      vehicleStyle: stringValue(params.vehicleStyle, params.style, style) ?? style,
      ...(sizeScale != null ? { sizeScale } : {}),
      ...(numberValue(params.length) != null ? { length: numberValue(params.length) } : {}),
      ...(numberValue(params.width) != null ? { width: numberValue(params.width) } : {}),
      ...(numberValue(params.height) != null ? { height: numberValue(params.height) } : {}),
      cornerRadius: numberValue(params.detail === 'low' ? undefined : 0.16) ?? 0.16,
      cornerSegments: params.detail === 'low' ? 5 : 8,
      cabinTopScale: style === 'sports' ? 0.72 : style === 'suv' ? 0.88 : 0.82,
    }

    return {
      name: nameFor(input, label),
      geometryBrief: input.geometryBrief ?? vehicleBrief(input, style),
      position: positionFor(params, input),
      detail: detailFor(params) ?? 'high',
      primaryColor: color,
      darkColor: stringValue(params.darkColor, '#111827'),
      accentColor: stringValue(params.accentColor, '#1e3a8a'),
      metalColor: stringValue(params.metalColor, '#d1d5db'),
      enhanceVisualDetails: highFidelity,
      parts: [
        body,
        { kind: 'vehicle_wheels' },
        { kind: 'vehicle_windows' },
        { kind: 'headlights' },
        { kind: 'bumper' },
      ],
    }
  }

  return {
    id,
    label,
    aliases,
    compose: (input) => composePartPrimitives(partInput(input)),
    geometryBrief: (input) => input.geometryBrief ?? vehicleBrief(input, style),
  }
}

function vehicleBrief(input: ComposeRecipeInput, style: string): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  return {
    category: 'vehicle',
    units: 'm',
    coordinateConvention: '+X length/front-back, +Y up, +Z width; y=0 is ground',
    expectedDimensions: {
      length: numberValue(params.length),
      width: numberValue(params.width),
      height: numberValue(params.height),
    },
    requiredRoles: [
      'vehicle_body',
      'vehicle_tire',
      'vehicle_window',
      'headlight',
      'front_bumper',
      'rear_bumper',
    ],
    validationTargets: ['four tires', 'separate cabin/windows', `${style} proportions`],
  }
}

function valveRecipe(kind: 'gate' | 'ball'): PrimitiveRecipeDefinition {
  const id = `valve.${kind}` as PrimitiveRecipeId
  const label = kind === 'ball' ? 'Ball valve' : 'Gate valve'
  const aliases =
    kind === 'ball'
      ? ['ball valve', 'quarter turn valve', '球阀']
      : ['valve', 'gate valve', 'industrial valve', '阀门', '闸阀']

  const partInput = (input: ComposeRecipeInput): PartComposeInput => {
    const params = recipeParams(input)
    const valveStyle = kind === 'ball' ? 'ball' : stringValue(params.valveStyle, 'gate')
    return {
      name: nameFor(input, label),
      geometryBrief: input.geometryBrief ?? valveBrief(kind),
      position: positionFor(params, input),
      detail: detailFor(params),
      primaryColor: colorFor(params, '#64748b'),
      secondaryColor: stringValue(params.secondaryColor, '#475569'),
      metalColor: stringValue(params.metalColor, '#cbd5e1'),
      darkColor: stringValue(params.darkColor, '#1f2937'),
      enhanceVisualDetails: boolValue(params.highFidelity, params.enhanceVisualDetails) === true,
      parts: [
        { kind: 'valve_body', valveStyle },
        {
          kind: 'handwheel',
          handleStyle: kind === 'ball' ? 'lever' : stringValue(params.handleStyle),
        },
      ],
    }
  }

  return {
    id,
    label,
    aliases,
    compose: (input) => composePartPrimitives(partInput(input)),
    geometryBrief: (input) => input.geometryBrief ?? valveBrief(kind),
  }
}

function valveBrief(kind: 'gate' | 'ball'): PrimitiveGeometryBrief {
  return {
    category: 'valve',
    units: 'm',
    coordinateConvention: '+X inlet/outlet axis, +Y up, +Z width; y=0 is ground',
    requiredRoles:
      kind === 'ball'
        ? ['flange_inlet', 'flange_outlet', 'valve_ball', 'valve_bore', 'seat_ring', 'stem']
        : ['flange_inlet', 'flange_outlet', 'bonnet', 'stem', 'gate_wedge', 'bonnet_bolts', 'yoke'],
    validationTargets:
      kind === 'ball'
        ? ['flanged ends', 'visible valve ball/bore', 'quarter-turn lever']
        : ['flanged ends', 'bonnet/stem/yoke', 'gate wedge'],
  }
}

function robotArmThreeAxisRecipe(): PrimitiveRecipeDefinition {
  const id = 'robotArm.threeAxis'
  const aliases = [
    'robot arm',
    'robotic arm',
    'manipulator',
    '3-axis robot arm',
    '机器臂',
    '机械臂',
  ]
  const robotInput = (input: ComposeRecipeInput): RobotArmComposeInput => {
    const params = recipeParams(input)
    return {
      name: nameFor(input, '3-axis robot arm'),
      position: positionFor(params, input),
      style: stringValue(params.style, 'industrial'),
      pose: stringValue(params.pose, 'work-ready'),
      axisCount: numberValue(params.axisCount, 3),
      baseShape: stringValue(params.baseShape, 'round'),
      endEffector: stringValue(params.endEffector, 'gripper'),
      reach: numberValue(params.reach, params.length),
      detail: stringValue(params.detail, params.highFidelity ? 'high' : 'medium'),
    }
  }

  return {
    id,
    label: '3-axis robot arm',
    aliases,
    compose: (input) => composeRobotArmPrimitives(robotInput(input)),
    geometryBrief: (input) => input.geometryBrief ?? robotArmBrief(input),
  }
}

function robotArmBrief(input: ComposeRecipeInput): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  return {
    category: 'robot_arm',
    units: 'm',
    coordinateConvention: '+X right, +Y up, +Z forward; y=0 is ground',
    expectedDimensions: {
      length: numberValue(params.reach, params.length),
    },
    requiredRoles: [
      'robot_base',
      'base_joint',
      'shoulder_joint',
      'upper_arm',
      'elbow_joint',
      'forearm',
      'end_effector',
    ],
    validationTargets: ['readable base', 'three joint housings', 'separate upper arm and forearm'],
  }
}

const PRIMITIVE_RECIPES: PrimitiveRecipeDefinition[] = [
  spurGearRecipe(),
  vehicleRecipe('sedan'),
  vehicleRecipe('suv'),
  vehicleRecipe('sports'),
  vehicleRecipe('van'),
  vehicleRecipe('truck'),
  valveRecipe('gate'),
  valveRecipe('ball'),
  robotArmThreeAxisRecipe(),
]

export function listPrimitiveRecipes(): PrimitiveRecipeDefinition[] {
  return PRIMITIVE_RECIPES
}

export function findPrimitiveRecipe(
  input: ComposeRecipeInput,
): PrimitiveRecipeDefinition | undefined {
  const id = readRecipeId(input)
  if (id) {
    return PRIMITIVE_RECIPES.find((recipe) => normalizeRecipeId(recipe.id) === id)
  }

  const text = textOf([input.name, input.recipe, input.id, input.params, input.geometryBrief])
  return PRIMITIVE_RECIPES.map((recipe) => ({
    recipe,
    matchLength: Math.max(
      0,
      ...recipe.aliases
        .filter((alias) => text.includes(alias.toLowerCase()))
        .map((alias) => alias.length),
    ),
  }))
    .sort((a, b) => b.matchLength - a.matchLength)
    .find((match) => match.matchLength > 0)?.recipe
}

export function getPrimitiveRecipeGeometryBrief(
  input: ComposeRecipeInput = {},
): PrimitiveGeometryBrief | undefined {
  return input.geometryBrief ?? findPrimitiveRecipe(input)?.geometryBrief(input)
}

export function composeRecipePrimitives(input: ComposeRecipeInput = {}): PrimitiveShapeInput[] {
  return findPrimitiveRecipe(input)?.compose(input) ?? []
}
