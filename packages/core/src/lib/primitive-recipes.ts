import { radialExtrudeRotationInHorizontalPlane } from './orientation-utils'
import type { PrimitiveGeometryBrief, PrimitiveShapeInput, Vec3 } from './primitive-compose'
import { composeRobotArmPrimitives, type RobotArmComposeInput } from './robot-arm-compose'

export type PrimitiveRecipeId =
  | 'gear.spur'
  | 'sprocket.chain'
  | 'pipe.flange'
  | 'pipe.elbow90'
  | 'fastener.hexBolt'
  | 'bearing.pillowBlock'
  | 'coupling.flexible'
  | 'plate.perforated'
  | 'valve.gate'
  | 'valve.ball'
  | 'robotArm.threeAxis'
  | 'mixer.impeller'
  | 'motor.servo'

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
  depth?: number
  diameter?: number
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
  bladeCount?: number
  bladeLength?: number
  bladeWidth?: number
  bladeThickness?: number
  bladeTilt?: number
  shaftDiameter?: number
  shaftLength?: number
  hubRadius?: number
  bendRadius?: number
  angle?: number
  jawCount?: number
  rows?: number
  columns?: number
  holeCount?: number
  holeDiameter?: number
  boltSpacing?: number
  nominalDiameter?: number
  boltCircleDiameter?: number
  boltCount?: number
  headHeight?: number
  headDiameter?: number
  shankLength?: number
  threadLength?: number
  radius?: number
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

function recipeIdMatchesAlias(id: string, recipe: PrimitiveRecipeDefinition): boolean {
  return recipe.aliases.some((alias) => normalizeRecipeId(alias) === id)
}

function readRecipeId(input: ComposeRecipeInput): string {
  return normalizeRecipeId(input.recipeId ?? input.recipe ?? input.id)
}

function recipeIdAlias(_value: string): PrimitiveRecipeId | undefined {
  return undefined
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

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  const resolved = value ?? fallback
  return Math.max(min, Math.min(max, resolved))
}

function integerValue(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.round(clampNumber(value, fallback, min, max))
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

function detailFor(params: PrimitiveRecipeParams): PrimitiveRecipeParams['detail'] {
  return stringValue(
    params.detail,
    params.highFidelity ? 'high' : undefined,
  ) as PrimitiveRecipeParams['detail']
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

function chainSprocketRecipe(): PrimitiveRecipeDefinition {
  const id = 'sprocket.chain' as PrimitiveRecipeId
  const aliases = ['chain sprocket', 'roller chain sprocket', 'sprocket', '链轮', '鏈輪']
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const teeth = integerValue(numberValue(params.teeth), 18, 8, 96)
    const pitch = clampNumber(numberValue(params.module, params.pitchDiameter), 0.012, 0.004, 0.08)
    const pitchDiameter =
      numberValue(params.pitchDiameter) ?? pitch / Math.sin(Math.PI / Math.max(teeth, 3))
    const outerRadius = (numberValue(params.outerDiameter) ?? pitchDiameter + pitch * 1.25) / 2
    const rootRadius =
      (numberValue(params.rootDiameter) ?? Math.max(pitchDiameter - pitch * 1.15, pitch)) / 2
    const thickness = clampNumber(
      numberValue(params.thickness, params.height),
      pitch * 1.35,
      0.006,
      0.18,
    )
    const boreRadius = (numberValue(params.boreDiameter) ?? pitchDiameter * 0.22) / 2
    const hubRadius = clampNumber(
      numberValue(params.hubRadius),
      boreRadius * 1.85,
      boreRadius * 1.25,
      outerRadius * 0.72,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'roller chain sprocket')
    const metal = {
      properties: { color: colorFor(params, '#71717a'), roughness: 0.36, metalness: 0.9 },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#111827') ?? '#111827',
        roughness: 0.52,
        metalness: 0.35,
      },
    }
    const profile: [number, number][] = []
    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const base = (tooth / teeth) * Math.PI * 2
      for (const [offset, radius] of [
        [0, rootRadius],
        [0.18, outerRadius * 0.96],
        [0.5, outerRadius],
        [0.82, outerRadius * 0.96],
        [1, rootRadius],
      ] as const) {
        profile.push(polarPoint(radius, base + (offset / teeth) * Math.PI * 2))
      }
    }

    return [
      {
        kind: 'extrude',
        name: `${name} toothed sprocket plate`,
        semanticRole: 'chain_sprocket',
        position: [origin[0], origin[1] + thickness / 2, origin[2]],
        rotation: [Math.PI / 2, 0, 0],
        profile,
        holes: [circleProfile(boreRadius, Math.max(32, Math.min(96, teeth * 2)))],
        depth: thickness,
        bevelSize: Math.min(thickness * 0.04, outerRadius * 0.012),
        bevelThickness: Math.min(thickness * 0.04, outerRadius * 0.012),
        bevelSegments: 1,
        material: metal,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} central hub`,
        semanticRole: 'sprocket_hub',
        position: [origin[0], origin[1] + thickness + thickness * 0.32, origin[2]],
        axis: 'y',
        radius: hubRadius,
        height: thickness * 0.64,
        wallThickness: Math.max(hubRadius - boreRadius, 0.003),
        radialSegments: 48,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} dark shaft bore`,
        semanticRole: 'sprocket_bore',
        position: [origin[0], origin[1] + thickness + thickness * 0.66, origin[2]],
        axis: 'y',
        radius: boreRadius,
        height: Math.max(thickness * 0.04, 0.002),
        radialSegments: 32,
        material: dark,
      },
    ]
  }

  return {
    id,
    label: 'Chain sprocket',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      return {
        category: 'chain_sprocket',
        units: 'm',
        coordinateConvention: '+Y sprocket axis; y=0 is bottom face',
        requiredRoles: ['chain_sprocket', 'sprocket_hub', 'sprocket_bore'],
        validationTargets: [
          `${integerValue(numberValue(params.teeth), 18, 8, 96)} roller-chain teeth`,
          'central bore',
          'raised hub for shaft mounting',
        ],
      }
    },
  }
}

function pipeFlangeRecipe(): PrimitiveRecipeDefinition {
  const id = 'pipe.flange' as PrimitiveRecipeId
  const aliases = [
    'pipe flange',
    'standard flange',
    'ansi flange',
    'weld neck flange',
    '法兰',
    '管法兰',
  ]
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const nominalDiameter = clampNumber(
      numberValue(params.nominalDiameter, params.boreDiameter, params.diameter),
      0.12 * scale,
      0.03,
      1.2,
    )
    const boreRadius = nominalDiameter / 2
    const outerRadius =
      clampNumber(
        numberValue(params.outerDiameter),
        nominalDiameter * 2.15,
        nominalDiameter * 1.35,
        3,
      ) / 2
    const thickness = clampNumber(
      numberValue(params.thickness, params.height),
      Math.max(nominalDiameter * 0.22, 0.025 * scale),
      0.012,
      0.45,
    )
    const boltCount = integerValue(numberValue(params.boltCount), 8, 4, 24)
    const boltCircleRadius =
      clampNumber(
        numberValue(params.boltCircleDiameter),
        outerRadius * 1.52,
        boreRadius * 2.25,
        outerRadius * 1.84,
      ) / 2
    const boltHoleRadius = clampNumber(
      numberValue(params.radius),
      Math.max(nominalDiameter * 0.055, 0.008 * scale),
      0.004,
      outerRadius * 0.12,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'standard pipe flange')
    const metal = {
      properties: { color: colorFor(params, '#9ca3af'), roughness: 0.34, metalness: 0.86 },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#111827') ?? '#111827',
        roughness: 0.52,
        metalness: 0.32,
      },
    }
    const gasket = {
      properties: {
        color: stringValue(params.accentColor, '#334155') ?? '#334155',
        roughness: 0.68,
        metalness: 0.05,
      },
    }
    const center: Vec3 = [origin[0], origin[1] + thickness / 2, origin[2]]
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'hollow-cylinder',
        name: `${name} raised face flange ring`,
        semanticRole: 'flange_body',
        position: center,
        axis: 'y',
        radius: outerRadius,
        height: thickness,
        wallThickness: Math.max(outerRadius - boreRadius, 0.004),
        radialSegments: 72,
        material: metal,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} raised face boss`,
        semanticRole: 'raised_face',
        position: [origin[0], origin[1] + thickness + thickness * 0.08, origin[2]],
        axis: 'y',
        radius: boreRadius * 1.42,
        height: thickness * 0.16,
        wallThickness: Math.max(boreRadius * 0.42, 0.004),
        radialSegments: 64,
        material: metal,
      },
      {
        kind: 'torus',
        name: `${name} dark gasket line`,
        semanticRole: 'gasket',
        position: [origin[0], origin[1] + thickness + thickness * 0.18, origin[2]],
        axis: 'y',
        majorRadius: boreRadius * 1.08,
        tubeRadius: Math.max(thickness * 0.035, 0.002),
        tubularSegments: 64,
        radialSegments: 10,
        material: gasket,
      },
    ]

    for (let index = 0; index < boltCount; index += 1) {
      const angle = (index / boltCount) * Math.PI * 2
      shapes.push({
        kind: 'cylinder',
        name: `${name} bolt hole ${index + 1}`,
        semanticRole: 'flange_bolt_hole',
        position: [
          origin[0] + Math.cos(angle) * boltCircleRadius,
          origin[1] + thickness + 0.001,
          origin[2] + Math.sin(angle) * boltCircleRadius,
        ],
        axis: 'y',
        radius: boltHoleRadius,
        height: Math.max(thickness * 0.06, 0.003),
        radialSegments: 24,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Pipe flange',
    aliases,
    compose,
    geometryBrief: (input) => input.geometryBrief ?? pipeFlangeBrief(input),
  }
}

function pipeFlangeBrief(input: ComposeRecipeInput): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  const boltCount = integerValue(numberValue(params.boltCount), 8, 4, 24)
  return {
    category: 'pipe_flange',
    units: 'm',
    coordinateConvention: '+Y flange axis; y=0 is bottom face',
    expectedDimensions: {
      diameter: numberValue(params.outerDiameter),
      thickness: numberValue(params.thickness, params.height),
      boreDiameter: numberValue(params.nominalDiameter, params.boreDiameter, params.diameter),
    },
    requiredRoles: ['flange_body', 'raised_face', 'gasket', 'flange_bolt_hole'],
    validationTargets: [
      'annular flange body with central bore',
      'raised face around the bore',
      `${boltCount} evenly spaced bolt holes on a bolt circle`,
    ],
  }
}

function pipeElbow90Recipe(): PrimitiveRecipeDefinition {
  const id = 'pipe.elbow90' as PrimitiveRecipeId
  const aliases = ['90 degree elbow', 'pipe elbow', 'elbow fitting', '90 elbow', '弯头', '90度弯头']
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const nominalDiameter = clampNumber(
      numberValue(params.nominalDiameter, params.diameter, params.boreDiameter),
      0.12 * scale,
      0.025,
      1.2,
    )
    const tubeRadius = nominalDiameter / 2
    const bendRadius = clampNumber(
      numberValue(params.bendRadius, params.radius),
      nominalDiameter * 1.5,
      nominalDiameter * 0.9,
      nominalDiameter * 6,
    )
    const angle = clampNumber(numberValue(params.angle), 90, 15, 180) * (Math.PI / 180)
    const wallThickness = clampNumber(
      numberValue(params.thickness),
      nominalDiameter * 0.08,
      nominalDiameter * 0.025,
      nominalDiameter * 0.18,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, '90 degree pipe elbow')
    const metal = {
      properties: { color: colorFor(params, '#94a3b8'), roughness: 0.35, metalness: 0.84 },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#0f172a') ?? '#0f172a',
        roughness: 0.55,
        metalness: 0.25,
      },
    }
    const endX: Vec3 = [origin[0] + bendRadius, origin[1], origin[2]]
    const endY: Vec3 = [
      origin[0] + Math.cos(angle) * bendRadius,
      origin[1] + Math.sin(angle) * bendRadius,
      origin[2],
    ]

    return [
      {
        kind: 'torus',
        name: `${name} curved elbow body`,
        semanticRole: 'pipe_elbow_body',
        position: origin,
        majorRadius: bendRadius,
        tubeRadius,
        arc: angle,
        tubularSegments: 64,
        radialSegments: 20,
        material: metal,
      },
      {
        kind: 'torus',
        name: `${name} inner bore shadow`,
        semanticRole: 'pipe_elbow_bore',
        position: origin,
        majorRadius: bendRadius,
        tubeRadius: Math.max(tubeRadius - wallThickness, tubeRadius * 0.68),
        arc: angle,
        tubularSegments: 64,
        radialSegments: 16,
        material: dark,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} inlet end collar`,
        semanticRole: 'elbow_inlet',
        position: endX,
        axis: 'x',
        radius: tubeRadius * 1.08,
        height: Math.max(nominalDiameter * 0.22, 0.012),
        wallThickness: Math.max(wallThickness, tubeRadius * 0.08),
        radialSegments: 32,
        material: metal,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} outlet end collar`,
        semanticRole: 'elbow_outlet',
        position: endY,
        rotation: [0, 0, angle],
        axis: 'x',
        radius: tubeRadius * 1.08,
        height: Math.max(nominalDiameter * 0.22, 0.012),
        wallThickness: Math.max(wallThickness, tubeRadius * 0.08),
        radialSegments: 32,
        material: metal,
      },
    ]
  }

  return {
    id,
    label: '90 degree pipe elbow',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      return {
        category: 'pipe_elbow',
        units: 'm',
        coordinateConvention: 'elbow arc lies in X/Y plane; +Y up',
        expectedDimensions: {
          diameter: numberValue(params.nominalDiameter, params.diameter, params.boreDiameter),
          bendRadius: numberValue(params.bendRadius, params.radius),
        },
        requiredRoles: ['pipe_elbow_body', 'pipe_elbow_bore', 'elbow_inlet', 'elbow_outlet'],
        validationTargets: [
          `${Math.round(numberValue(params.angle, 90) ?? 90)} degree elbow arc`,
          'visible wall thickness / bore shadow',
          'two aligned end collars',
        ],
      }
    },
  }
}

function hexBoltRecipe(): PrimitiveRecipeDefinition {
  const id = 'fastener.hexBolt' as PrimitiveRecipeId
  const aliases = ['hex bolt', 'hex head bolt', 'standard bolt', 'bolt', '螺栓', '六角螺栓']
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const diameter = clampNumber(
      numberValue(params.nominalDiameter, params.shaftDiameter, params.diameter),
      0.016 * scale,
      0.004,
      0.12,
    )
    const radius = diameter / 2
    const shankLength = clampNumber(
      numberValue(params.shankLength, params.length, params.height),
      diameter * 5,
      diameter * 1.5,
      diameter * 18,
    )
    const threadLength = clampNumber(
      numberValue(params.threadLength),
      shankLength * 0.45,
      diameter * 0.8,
      shankLength,
    )
    const headHeight = clampNumber(
      numberValue(params.headHeight),
      diameter * 0.62,
      diameter * 0.28,
      diameter * 1.1,
    )
    const headRadius =
      clampNumber(
        numberValue(params.headDiameter),
        diameter * 1.55,
        diameter * 1.2,
        diameter * 2.4,
      ) / 2
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'standard hex bolt')
    const metal = {
      properties: { color: colorFor(params, '#cbd5e1'), roughness: 0.28, metalness: 0.9 },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#475569') ?? '#475569',
        roughness: 0.42,
        metalness: 0.72,
      },
    }
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'cylinder',
        name: `${name} cylindrical shank`,
        semanticRole: 'bolt_shank',
        position: [origin[0], origin[1] + shankLength / 2, origin[2]],
        axis: 'y',
        radius,
        height: shankLength,
        radialSegments: 32,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} hex head`,
        semanticRole: 'hex_head',
        position: [origin[0], origin[1] + shankLength + headHeight / 2, origin[2]],
        axis: 'y',
        radius: headRadius,
        height: headHeight,
        radialSegments: 6,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} circular head chamfer`,
        semanticRole: 'head_chamfer',
        position: [origin[0], origin[1] + shankLength + headHeight * 0.92, origin[2]],
        axis: 'y',
        radius: headRadius * 0.88,
        height: Math.max(headHeight * 0.08, 0.001),
        radialSegments: 6,
        material: dark,
      },
    ]

    const ringCount = Math.max(
      4,
      Math.min(16, Math.round(threadLength / Math.max(diameter * 0.32, 0.002))),
    )
    for (let index = 0; index < ringCount; index += 1) {
      const y = origin[1] + diameter * 0.35 + (index / Math.max(ringCount - 1, 1)) * threadLength
      shapes.push({
        kind: 'torus',
        name: `${name} thread crest ${index + 1}`,
        semanticRole: 'thread_crest',
        position: [origin[0], y, origin[2]],
        axis: 'y',
        majorRadius: radius * 0.96,
        tubeRadius: Math.max(radius * 0.06, 0.0006),
        tubularSegments: 28,
        radialSegments: 8,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Hex bolt',
    aliases,
    compose,
    geometryBrief: (input) => input.geometryBrief ?? hexBoltBrief(input),
  }
}

function hexBoltBrief(input: ComposeRecipeInput): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  return {
    category: 'fastener',
    units: 'm',
    coordinateConvention: '+Y bolt axis; y=0 is threaded tip',
    expectedDimensions: {
      diameter: numberValue(params.nominalDiameter, params.shaftDiameter, params.diameter),
      length: numberValue(params.shankLength, params.length, params.height),
      headHeight: numberValue(params.headHeight),
    },
    requiredRoles: ['bolt_shank', 'hex_head', 'thread_crest'],
    validationTargets: [
      'cylindrical shank',
      'six-sided hex head',
      'visible thread crests near the threaded end',
    ],
  }
}

function pillowBlockBearingRecipe(): PrimitiveRecipeDefinition {
  const id = 'bearing.pillowBlock' as PrimitiveRecipeId
  const aliases = [
    'pillow block bearing',
    'plummer block bearing',
    'bearing block',
    'mounted bearing',
    '轴承座',
    '带座轴承',
  ]
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const shaftDiameter = clampNumber(
      numberValue(params.shaftDiameter, params.nominalDiameter, params.boreDiameter),
      0.08 * scale,
      0.018,
      0.42,
    )
    const boreRadius = shaftDiameter / 2
    const housingRadius = clampNumber(
      numberValue(params.radius),
      boreRadius * 2.1,
      boreRadius * 1.55,
      boreRadius * 3.2,
    )
    const width = clampNumber(
      numberValue(params.width, params.thickness),
      shaftDiameter * 1.2,
      shaftDiameter * 0.65,
      shaftDiameter * 3.2,
    )
    const baseLength = clampNumber(
      numberValue(params.length),
      housingRadius * 4.2,
      housingRadius * 2.8,
      housingRadius * 6.4,
    )
    const baseWidth = clampNumber(
      numberValue(params.depth),
      width * 1.45,
      width * 1.05,
      width * 2.4,
    )
    const baseHeight = clampNumber(
      numberValue(params.height),
      housingRadius * 0.55,
      housingRadius * 0.28,
      housingRadius * 0.9,
    )
    const boltSpacing = clampNumber(
      numberValue(params.boltSpacing),
      baseLength * 0.62,
      housingRadius * 1.8,
      baseLength * 0.82,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'pillow block bearing')
    const body = {
      properties: { color: colorFor(params, '#475569'), roughness: 0.42, metalness: 0.68 },
    }
    const metal = {
      properties: {
        color: stringValue(params.metalColor, '#cbd5e1') ?? '#cbd5e1',
        roughness: 0.28,
        metalness: 0.88,
      },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#0f172a') ?? '#0f172a',
        roughness: 0.58,
        metalness: 0.24,
      },
    }
    const y = origin[1] + baseHeight
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'box',
        name: `${name} foot base`,
        semanticRole: 'pillow_block_base',
        position: [origin[0], origin[1] + baseHeight / 2, origin[2]],
        length: baseLength,
        width: baseWidth,
        height: baseHeight,
        material: body,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} arched bearing housing`,
        semanticRole: 'bearing_housing',
        position: [origin[0], y + housingRadius * 0.7, origin[2]],
        axis: 'x',
        radius: housingRadius,
        height: width,
        wallThickness: Math.max(housingRadius - boreRadius, 0.006),
        radialSegments: 48,
        material: body,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} shiny bearing insert`,
        semanticRole: 'bearing_insert',
        position: [origin[0], y + housingRadius * 0.7, origin[2]],
        axis: 'x',
        radius: boreRadius * 1.45,
        height: width * 1.05,
        wallThickness: Math.max(boreRadius * 0.45, 0.004),
        radialSegments: 48,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} dark shaft bore`,
        semanticRole: 'bearing_bore',
        position: [origin[0] + width * 0.54, y + housingRadius * 0.7, origin[2]],
        axis: 'x',
        radius: boreRadius,
        height: Math.max(width * 0.05, 0.003),
        radialSegments: 32,
        material: dark,
      },
      {
        kind: 'cylinder',
        name: `${name} grease nipple`,
        semanticRole: 'grease_nipple',
        position: [origin[0], y + housingRadius * 1.72, origin[2]],
        axis: 'y',
        radius: boreRadius * 0.16,
        height: boreRadius * 0.42,
        radialSegments: 16,
        material: metal,
      },
    ]

    for (const x of [-boltSpacing / 2, boltSpacing / 2]) {
      shapes.push({
        kind: 'cylinder',
        name: `${name} mounting bolt hole ${x < 0 ? 'left' : 'right'}`,
        semanticRole: 'mounting_hole',
        position: [origin[0] + x, origin[1] + baseHeight + 0.001, origin[2]],
        axis: 'y',
        radius: boreRadius * 0.34,
        height: Math.max(baseHeight * 0.08, 0.004),
        radialSegments: 24,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Pillow block bearing',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      return {
        category: 'pillow_block_bearing',
        units: 'm',
        coordinateConvention: '+X shaft axis, +Y up; y=0 is base bottom',
        expectedDimensions: {
          shaftDiameter: numberValue(
            params.shaftDiameter,
            params.nominalDiameter,
            params.boreDiameter,
          ),
          length: numberValue(params.length),
          width: numberValue(params.width, params.thickness),
        },
        requiredRoles: [
          'pillow_block_base',
          'bearing_housing',
          'bearing_insert',
          'bearing_bore',
          'mounting_hole',
        ],
        validationTargets: [
          'base foot with two mounting holes',
          'arched bearing housing',
          'concentric bearing insert and shaft bore',
        ],
      }
    },
  }
}

function flexibleCouplingRecipe(): PrimitiveRecipeDefinition {
  const id = 'coupling.flexible' as PrimitiveRecipeId
  const aliases = [
    'flexible coupling',
    'jaw coupling',
    'shaft coupling',
    'motor coupling',
    '联轴器',
    '弹性联轴器',
  ]
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const shaftDiameter = clampNumber(
      numberValue(params.shaftDiameter, params.nominalDiameter, params.boreDiameter),
      0.06 * scale,
      0.012,
      0.34,
    )
    const boreRadius = shaftDiameter / 2
    const outerRadius =
      clampNumber(
        numberValue(params.outerDiameter, params.diameter),
        shaftDiameter * 1.85,
        shaftDiameter * 1.25,
        shaftDiameter * 3.4,
      ) / 2
    const length = clampNumber(
      numberValue(params.length),
      shaftDiameter * 3.6,
      shaftDiameter * 2.1,
      shaftDiameter * 8,
    )
    const jawCount = integerValue(numberValue(params.jawCount, params.teeth), 6, 3, 12)
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'flexible jaw coupling')
    const hubMat = {
      properties: { color: colorFor(params, '#64748b'), roughness: 0.34, metalness: 0.86 },
    }
    const elastomer = {
      properties: {
        color: stringValue(params.accentColor, '#f97316') ?? '#f97316',
        roughness: 0.7,
        metalness: 0.02,
      },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#111827') ?? '#111827',
        roughness: 0.56,
        metalness: 0.24,
      },
    }
    const hubLength = length * 0.42
    const gap = length * 0.08
    const y = origin[1] + outerRadius
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'hollow-cylinder',
        name: `${name} left hub`,
        semanticRole: 'coupling_hub_left',
        position: [origin[0] - (hubLength + gap) / 2, y, origin[2]],
        axis: 'x',
        radius: outerRadius,
        height: hubLength,
        wallThickness: Math.max(outerRadius - boreRadius, 0.004),
        radialSegments: 40,
        material: hubMat,
      },
      {
        kind: 'hollow-cylinder',
        name: `${name} right hub`,
        semanticRole: 'coupling_hub_right',
        position: [origin[0] + (hubLength + gap) / 2, y, origin[2]],
        axis: 'x',
        radius: outerRadius,
        height: hubLength,
        wallThickness: Math.max(outerRadius - boreRadius, 0.004),
        radialSegments: 40,
        material: hubMat,
      },
      {
        kind: 'cylinder',
        name: `${name} elastomer spider insert`,
        semanticRole: 'elastomer_spider',
        position: [origin[0], y, origin[2]],
        axis: 'x',
        radius: outerRadius * 0.82,
        height: gap * 1.35,
        radialSegments: jawCount,
        material: elastomer,
      },
    ]

    for (const x of [origin[0] - length * 0.31, origin[0] + length * 0.31]) {
      shapes.push({
        kind: 'cylinder',
        name: `${name} dark shaft bore ${x < origin[0] ? 'left' : 'right'}`,
        semanticRole: 'coupling_bore',
        position: [x, y, origin[2]],
        axis: 'x',
        radius: boreRadius,
        height: Math.max(length * 0.025, 0.004),
        radialSegments: 28,
        material: dark,
      })
    }

    for (let index = 0; index < 2; index += 1) {
      const x = index === 0 ? origin[0] - length * 0.28 : origin[0] + length * 0.28
      shapes.push({
        kind: 'cylinder',
        name: `${name} radial set screw ${index + 1}`,
        semanticRole: 'set_screw',
        position: [x, y + outerRadius * 0.86, origin[2]],
        axis: 'y',
        radius: outerRadius * 0.08,
        height: outerRadius * 0.24,
        radialSegments: 16,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Flexible shaft coupling',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      return {
        category: 'shaft_coupling',
        units: 'm',
        coordinateConvention: '+X shaft axis; +Y up; y=0 touches floor',
        expectedDimensions: {
          shaftDiameter: numberValue(
            params.shaftDiameter,
            params.nominalDiameter,
            params.boreDiameter,
          ),
          outerDiameter: numberValue(params.outerDiameter, params.diameter),
          length: numberValue(params.length),
        },
        requiredRoles: [
          'coupling_hub_left',
          'coupling_hub_right',
          'elastomer_spider',
          'coupling_bore',
        ],
        validationTargets: [
          'two coaxial metal hubs',
          'central elastomer spider insert',
          'visible bores and set screws',
        ],
      }
    },
  }
}

function perforatedPlateRecipe(): PrimitiveRecipeDefinition {
  const id = 'plate.perforated' as PrimitiveRecipeId
  const aliases = [
    'perforated plate',
    'sieve plate',
    'screen plate',
    'filter plate',
    '孔板',
    '筛板',
    '篩板',
  ]
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const length = clampNumber(numberValue(params.length), 0.8 * scale, 0.12, 4)
    const width = clampNumber(numberValue(params.width), 0.42 * scale, 0.08, 2.4)
    const thickness = clampNumber(
      numberValue(params.thickness, params.height),
      0.025 * scale,
      0.004,
      0.18,
    )
    const rows = integerValue(numberValue(params.rows), 4, 1, 12)
    const columns = integerValue(numberValue(params.columns, params.holeCount), 8, 1, 24)
    const holeDiameter = clampNumber(
      numberValue(params.holeDiameter, params.boreDiameter, params.nominalDiameter),
      Math.min(length / (columns + 1), width / (rows + 1)) * 0.36,
      0.006,
      Math.min(length / (columns + 1), width / (rows + 1)) * 0.72,
    )
    const holeRadius = holeDiameter / 2
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'perforated process plate')
    const plateMat = {
      properties: { color: colorFor(params, '#94a3b8'), roughness: 0.36, metalness: 0.76 },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#0f172a') ?? '#0f172a',
        roughness: 0.58,
        metalness: 0.2,
      },
    }
    const profile: [number, number][] = [
      [-length / 2, -width / 2],
      [length / 2, -width / 2],
      [length / 2, width / 2],
      [-length / 2, width / 2],
    ]
    const holes: [number, number][][] = []
    const holeCenters: [number, number][] = []
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = -length / 2 + ((column + 1) / (columns + 1)) * length
        const z = -width / 2 + ((row + 1) / (rows + 1)) * width
        holes.push(circleProfile(holeRadius, 20).map(([hx, hz]) => [x + hx, z + hz]))
        holeCenters.push([x, z])
      }
    }
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'extrude',
        name: `${name} perforated plate body`,
        semanticRole: 'perforated_plate',
        position: [origin[0], origin[1] + thickness / 2, origin[2]],
        rotation: [Math.PI / 2, 0, 0],
        profile,
        holes,
        depth: thickness,
        bevelSize: Math.min(thickness * 0.08, 0.004),
        bevelThickness: Math.min(thickness * 0.08, 0.004),
        bevelSegments: 1,
        material: plateMat,
      },
    ]

    for (const [x, z] of holeCenters.slice(0, 48)) {
      shapes.push({
        kind: 'cylinder',
        name: `${name} dark perforation`,
        semanticRole: 'perforation_hole',
        position: [origin[0] + x, origin[1] + thickness + 0.001, origin[2] + z],
        axis: 'y',
        radius: holeRadius,
        height: Math.max(thickness * 0.05, 0.002),
        radialSegments: 16,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Perforated plate',
    aliases,
    compose,
    geometryBrief: (input) => {
      const params = recipeParams(input)
      const rows = integerValue(numberValue(params.rows), 4, 1, 12)
      const columns = integerValue(numberValue(params.columns, params.holeCount), 8, 1, 24)
      return {
        category: 'perforated_plate',
        units: 'm',
        coordinateConvention: 'plate lies in X/Z plane with +Y thickness',
        expectedDimensions: {
          length: numberValue(params.length),
          width: numberValue(params.width),
          thickness: numberValue(params.thickness, params.height),
        },
        requiredRoles: ['perforated_plate', 'perforation_hole'],
        validationTargets: [
          `${rows} by ${columns} regular hole grid`,
          'single plate body with actual circular cutouts',
          'dark visible perforation interiors',
        ],
      }
    },
  }
}

function composeValveRecipePrimitives(
  input: ComposeRecipeInput,
  kind: 'gate' | 'ball',
): PrimitiveShapeInput[] {
  const params = recipeParams(input)
  const scale = sizeScaleFor(params) ?? 1
  const length = clampNumber(numberValue(params.length), 0.7 * scale, 0.22, 2.4)
  const bodyRadius = clampNumber(
    numberValue(params.radius, params.height),
    0.14 * scale,
    0.045,
    0.6,
  )
  const flangeRadius = clampNumber(
    numberValue(params.outerDiameter),
    bodyRadius * 1.45,
    bodyRadius,
    1,
  )
  const flangeThickness = clampNumber(numberValue(params.thickness), length * 0.07, 0.012, 0.18)
  const origin = positionFor(params, input) ?? [0, 0, 0]
  const name = nameFor(input, kind === 'ball' ? 'ball valve' : 'gate valve')
  const bodyColor = colorFor(params, '#64748b')
  const darkColor = stringValue(params.darkColor, '#1f2937') ?? '#1f2937'
  const metalColor = stringValue(params.metalColor, '#cbd5e1') ?? '#cbd5e1'
  const body = { properties: { color: bodyColor, roughness: 0.42, metalness: 0.58 } }
  const dark = { properties: { color: darkColor, roughness: 0.55, metalness: 0.25 } }
  const metal = { properties: { color: metalColor, roughness: 0.3, metalness: 0.82 } }
  const centerY = origin[1] + bodyRadius
  const leftX = origin[0] - length / 2
  const rightX = origin[0] + length / 2
  const shapes: PrimitiveShapeInput[] = [
    {
      kind: 'cylinder',
      name: `${name} main valve body`,
      semanticRole: 'valve_body',
      sourcePartKind: 'valve_body',
      position: [origin[0], centerY, origin[2]],
      axis: 'x',
      radius: bodyRadius,
      height: length,
      radialSegments: 40,
      material: body,
    },
    {
      kind: 'hollow-cylinder',
      name: `${name} inlet flange`,
      semanticRole: 'flange_inlet',
      sourcePartKind: 'flange_ring',
      position: [leftX - flangeThickness / 2, centerY, origin[2]],
      axis: 'x',
      radius: flangeRadius,
      height: flangeThickness,
      wallThickness: Math.max(flangeRadius - bodyRadius * 0.62, 0.006),
      radialSegments: 48,
      material: metal,
    },
    {
      kind: 'hollow-cylinder',
      name: `${name} outlet flange`,
      semanticRole: 'flange_outlet',
      sourcePartKind: 'flange_ring',
      position: [rightX + flangeThickness / 2, centerY, origin[2]],
      axis: 'x',
      radius: flangeRadius,
      height: flangeThickness,
      wallThickness: Math.max(flangeRadius - bodyRadius * 0.62, 0.006),
      radialSegments: 48,
      material: metal,
    },
    {
      kind: 'cylinder',
      name: `${name} vertical stem`,
      semanticRole: 'stem',
      sourcePartKind: 'handwheel',
      position: [origin[0], centerY + bodyRadius * 1.25, origin[2]],
      axis: 'y',
      radius: bodyRadius * 0.12,
      height: bodyRadius * 1.5,
      radialSegments: 24,
      material: metal,
    },
  ]

  if (kind === 'ball') {
    shapes.push(
      {
        kind: 'sphere',
        name: `${name} visible ball core`,
        semanticRole: 'valve_ball',
        sourcePartKind: 'valve_body',
        position: [origin[0], centerY, origin[2]],
        radius: bodyRadius * 0.62,
        widthSegments: 32,
        heightSegments: 16,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} dark through bore`,
        semanticRole: 'valve_bore',
        sourcePartKind: 'valve_body',
        position: [origin[0], centerY, origin[2]],
        axis: 'x',
        radius: bodyRadius * 0.25,
        height: length * 0.72,
        radialSegments: 24,
        material: dark,
      },
      {
        kind: 'torus',
        name: `${name} left seat ring`,
        semanticRole: 'seat_ring',
        sourcePartKind: 'valve_body',
        position: [origin[0] - bodyRadius * 0.48, centerY, origin[2]],
        axis: 'x',
        majorRadius: bodyRadius * 0.38,
        tubeRadius: bodyRadius * 0.035,
        radialSegments: 10,
        tubularSegments: 36,
        material: dark,
      },
      {
        kind: 'torus',
        name: `${name} right seat ring`,
        semanticRole: 'seat_ring',
        sourcePartKind: 'valve_body',
        position: [origin[0] + bodyRadius * 0.48, centerY, origin[2]],
        axis: 'x',
        majorRadius: bodyRadius * 0.38,
        tubeRadius: bodyRadius * 0.035,
        radialSegments: 10,
        tubularSegments: 36,
        material: dark,
      },
      {
        kind: 'box',
        name: `${name} quarter-turn lever handle`,
        semanticRole: 'lever_handle',
        sourcePartKind: 'handwheel',
        position: [origin[0] + bodyRadius * 0.55, centerY + bodyRadius * 2.05, origin[2]],
        length: bodyRadius * 1.7,
        width: bodyRadius * 0.12,
        height: bodyRadius * 0.1,
        material: metal,
      },
    )
  } else {
    shapes.push(
      {
        kind: 'cylinder',
        name: `${name} bonnet`,
        semanticRole: 'bonnet',
        sourcePartKind: 'valve_body',
        position: [origin[0], centerY + bodyRadius * 0.85, origin[2]],
        axis: 'y',
        radius: bodyRadius * 0.55,
        height: bodyRadius * 0.7,
        radialSegments: 32,
        material: body,
      },
      {
        kind: 'box',
        name: `${name} internal gate wedge`,
        semanticRole: 'gate_wedge',
        sourcePartKind: 'valve_body',
        position: [origin[0], centerY - bodyRadius * 0.1, origin[2]],
        length: bodyRadius * 0.35,
        width: bodyRadius * 1.0,
        height: bodyRadius * 0.9,
        material: dark,
      },
      {
        kind: 'torus',
        name: `${name} handwheel`,
        semanticRole: 'handwheel',
        sourcePartKind: 'handwheel',
        position: [origin[0], centerY + bodyRadius * 2.18, origin[2]],
        axis: 'y',
        majorRadius: bodyRadius * 0.72,
        tubeRadius: bodyRadius * 0.055,
        radialSegments: 12,
        tubularSegments: 48,
        material: metal,
      },
      {
        kind: 'box',
        name: `${name} yoke bridge`,
        semanticRole: 'yoke',
        sourcePartKind: 'handwheel',
        position: [origin[0], centerY + bodyRadius * 1.7, origin[2]],
        length: bodyRadius * 1.0,
        width: bodyRadius * 0.12,
        height: bodyRadius * 0.18,
        material: metal,
      },
    )
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2
      shapes.push({
        kind: 'cylinder',
        name: `${name} bonnet bolt ${index + 1}`,
        semanticRole: 'bonnet_bolts',
        sourcePartKind: 'bolt_pattern',
        position: [
          origin[0] + Math.cos(angle) * bodyRadius * 0.55,
          centerY + bodyRadius * 1.22,
          origin[2] + Math.sin(angle) * bodyRadius * 0.55,
        ],
        axis: 'y',
        radius: bodyRadius * 0.035,
        height: bodyRadius * 0.08,
        radialSegments: 12,
        material: metal,
      })
    }
  }

  return shapes
}

function valveRecipe(kind: 'gate' | 'ball'): PrimitiveRecipeDefinition {
  const id = `valve.${kind}` as PrimitiveRecipeId
  const label = kind === 'ball' ? 'Ball valve' : 'Gate valve'
  const aliases =
    kind === 'ball'
      ? ['ball valve', 'quarter turn valve', '\u7403\u9600']
      : ['valve', 'gate valve', 'industrial valve', '\u9600\u95e8', '\u95f8\u9600']

  return {
    id,
    label,
    aliases,
    compose: (input) => composeValveRecipePrimitives(input, kind),
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

function taijiHalfBladeProfile(
  length: number,
  rootWidth: number,
  bladeWidth: number,
  longitudinalCurve: number,
  steps: number,
): [number, number][] {
  const profile: [number, number][] = []
  const halfRoot = rootWidth * 0.5
  const maxHalfWidth = bladeWidth * 0.78
  const halfWidthAt = (t: number) => {
    const bulb = Math.sin(Math.PI * t) ** 0.48
    const outerWeight = 0.72 + t * 0.28
    const rootNeck = halfRoot * (1 - t) ** 2.2
    return rootNeck + maxHalfWidth * bulb * outerWeight
  }
  const spineOffset = (t: number) =>
    longitudinalCurve * (Math.sin(Math.PI * (t - 0.06)) + 0.28 * Math.sin(Math.PI * 2 * t))
  const innerCut = (t: number) => longitudinalCurve * 0.72 * Math.sin(Math.PI * t) * (1 - t * 0.35)

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    const x = length * (t - 0.5)
    profile.push([x, spineOffset(t) + halfWidthAt(t) * (0.92 + t * 0.18)])
  }
  for (let step = steps; step >= 0; step -= 1) {
    const t = step / steps
    const x = length * (t - 0.5)
    const width = halfWidthAt(t)
    profile.push([x, spineOffset(t) - width * (0.5 + 0.32 * (1 - t)) + innerCut(t)])
  }
  return profile
}

function composeMixerBladeRecipeShapes(args: {
  name: string
  origin: Vec3
  bladeCenterY: number
  bladeCount: number
  bladeLength: number
  bladeWidth: number
  bladeThickness: number
  bladeTilt: number
  hubRadius: number
  material: PrimitiveShapeInput['material']
  detail?: PrimitiveRecipeParams['detail']
}): PrimitiveShapeInput[] {
  const rootWidth = Math.max(args.bladeThickness * 1.05, args.hubRadius * 0.36)
  const profile = taijiHalfBladeProfile(
    args.bladeLength,
    rootWidth,
    args.bladeWidth,
    args.bladeWidth * 0.38,
    args.detail === 'low' ? 12 : 24,
  )
  return Array.from({ length: args.bladeCount }, (_, index) => {
    const angle = (index * Math.PI * 2) / args.bladeCount
    return {
      kind: 'extrude',
      name: `${args.name} taiji half mixer propeller blade ${index + 1}`,
      semanticRole: 'mixer_blade',
      semanticGroup: 'mixer_blades',
      sourcePartKind: 'mixer_blades',
      position: [
        args.origin[0] + Math.cos(angle) * (args.hubRadius + args.bladeLength * 0.5),
        args.bladeCenterY,
        args.origin[2] + Math.sin(angle) * (args.hubRadius + args.bladeLength * 0.5),
      ],
      rotation: radialExtrudeRotationInHorizontalPlane(angle, args.bladeTilt * 0.55),
      profile,
      depth: args.bladeThickness,
      bevelSize: args.bladeThickness * 0.12,
      bevelThickness: args.bladeThickness * 0.16,
      bevelSegments: 1,
      curveSegments: 16,
      material: args.material,
    } satisfies PrimitiveShapeInput
  })
}

function mixerImpellerRecipe(): PrimitiveRecipeDefinition {
  const id = 'mixer.impeller' as PrimitiveRecipeId
  const aliases = [
    'mixer impeller',
    'mud mixer',
    'mixing paddle',
    'agitator paddle',
    'impeller',
    '\u6ce5\u6d46\u6405\u62cc',
    '\u6405\u62cc\u90e8\u4ef6',
    '\u6405\u62cc\u53f6\u7247',
    '\u53f6\u8f6e',
  ]

  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const bladeCount = integerValue(numberValue(params.bladeCount), 3, 2, 8)
    const sizeScale = sizeScaleFor(params) ?? 1
    const shaftDiameter = clampNumber(
      numberValue(params.shaftDiameter),
      0.07 * sizeScale,
      0.025,
      0.2,
    )
    const shaftRadius = shaftDiameter / 2
    const shaftLength = clampNumber(
      numberValue(params.shaftLength, params.height),
      0.9 * sizeScale,
      0.25,
      2.4,
    )
    const bladeLength = clampNumber(
      numberValue(params.bladeLength, params.length),
      0.34 * sizeScale,
      0.08,
      1.2,
    )
    const bladeWidth = clampNumber(
      numberValue(params.bladeWidth, params.width),
      0.13 * sizeScale,
      0.04,
      0.45,
    )
    const bladeThickness = clampNumber(
      numberValue(params.bladeThickness, params.thickness),
      0.028 * sizeScale,
      0.01,
      0.09,
    )
    const bladeTilt = clampNumber(numberValue(params.bladeTilt), 0, 0, 60) * (Math.PI / 180)
    const hubRadius = clampNumber(
      numberValue(params.hubRadius),
      shaftRadius * 1.45,
      shaftRadius,
      shaftRadius * 3.2,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const shaftCenterY = origin[1] + shaftLength / 2
    const bladeCenterY = origin[1] + Math.max(bladeWidth * 0.42, shaftLength * 0.12)
    const metal = {
      properties: {
        color: colorFor(params, '#9ca3af'),
        roughness: 0.42,
        metalness: 0.62,
      },
    }
    const dark = {
      properties: {
        color: stringValue(params.darkColor, '#1f2937') ?? '#1f2937',
        roughness: 0.58,
        metalness: 0.25,
      },
    }

    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'cylinder',
        name: `${nameFor(input, 'mud mixer impeller')} vertical shaft`,
        semanticRole: 'mixer_shaft',
        sourcePartKind: 'mixer_shaft',
        position: [origin[0], shaftCenterY, origin[2]],
        axis: 'y',
        radius: shaftRadius,
        height: shaftLength,
        radialSegments: 32,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${nameFor(input, 'mud mixer impeller')} lower hub`,
        semanticRole: 'mixer_hub',
        sourcePartKind: 'mixer_hub',
        position: [origin[0], bladeCenterY, origin[2]],
        axis: 'y',
        radius: hubRadius,
        height: Math.max(bladeThickness * 1.6, shaftDiameter * 0.55),
        radialSegments: 32,
        material: metal,
      },
    ]

    shapes.push(
      ...composeMixerBladeRecipeShapes({
        name: nameFor(input, 'mud mixer impeller'),
        origin,
        bladeCenterY,
        bladeCount,
        bladeLength,
        bladeWidth,
        bladeThickness,
        bladeTilt,
        hubRadius,
        material: {
          properties: {
            color: stringValue(params.accentColor, params.secondaryColor, '#64748b') ?? '#64748b',
            roughness: 0.5,
            metalness: 0.45,
          },
        },
        detail: detailFor(params) ?? 'medium',
      }),
    )

    if (detailFor(params) !== 'low') {
      shapes.push({
        kind: 'torus',
        name: `${nameFor(input, 'mud mixer impeller')} hub clamp ring`,
        semanticRole: 'mixer_hub_ring',
        sourcePartKind: 'mixer_hub',
        position: [origin[0], bladeCenterY + bladeThickness * 0.7, origin[2]],
        axis: 'y',
        majorRadius: hubRadius * 0.82,
        tubeRadius: Math.max(bladeThickness * 0.18, 0.006),
        radialSegments: 12,
        tubularSegments: 32,
        material: dark,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Mud mixer impeller',
    aliases,
    compose,
    geometryBrief: (input) => input.geometryBrief ?? mixerImpellerBrief(input),
  }
}

function mixerImpellerBrief(input: ComposeRecipeInput): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  return {
    category: 'mixer',
    units: 'm',
    coordinateConvention:
      '+Y up along shaft; blades are radial in X/Z near the lower shaft end; y=0 is ground',
    expectedDimensions: {
      height: numberValue(params.shaftLength, params.height),
      bladeLength: numberValue(params.bladeLength, params.length),
    },
    requiredRoles: ['mixer_shaft', 'mixer_hub', 'mixer_blades'],
    validationTargets: [
      `${integerValue(numberValue(params.bladeCount), 3, 2, 8)} evenly spaced broad rounded propeller blades`,
      'vertical shaft',
      'lower hub connecting blades to shaft',
      'top-down circular impeller outline with 120-degree spacing for three blades',
      'narrow blade roots at the hub, broad rounded blade bodies, and rounded tips instead of rectangular blocks',
    ],
    assumptions: [
      'Default to 3 evenly spaced blades when count is omitted.',
      'Default visible blade tilt is moderated so the blades read as pitched but mostly horizontal impeller paddles.',
      'Blade geometry uses a taiji-half propeller profile: narrow root, broad rounded body, rounded tip, and a longitudinal spine curve.',
    ],
  }
}

function servoMotorRecipe(): PrimitiveRecipeDefinition {
  const id = 'motor.servo' as PrimitiveRecipeId
  const aliases = [
    'servo motor',
    'industrial servo motor',
    'ac servo',
    'servo drive motor',
    'servo',
    '\u4f3a\u670d\u7535\u673a',
    '\u4f3a\u670d\u9a6c\u8fbe',
  ]
  const compose = (input: ComposeRecipeInput): PrimitiveShapeInput[] => {
    const params = recipeParams(input)
    const scale = sizeScaleFor(params) ?? 1
    const length = clampNumber(numberValue(params.length), 0.72 * scale, 0.28, 1.8)
    const bodyRadius = clampNumber(
      numberValue(params.radius, params.height, params.width),
      0.18 * scale,
      0.07,
      0.46,
    )
    const bodyLength = length * 0.58
    const flangeThickness = Math.max(length * 0.055, 0.025 * scale)
    const encoderLength = Math.max(length * 0.12, 0.055 * scale)
    const shaftDiameter = numberValue(params.shaftDiameter)
    const shaftRadius = clampNumber(
      shaftDiameter != null ? shaftDiameter / 2 : undefined,
      bodyRadius * 0.18,
      bodyRadius * 0.08,
      bodyRadius * 0.32,
    )
    const shaftLength = clampNumber(
      numberValue(params.shaftLength),
      length * 0.22,
      length * 0.08,
      length * 0.42,
    )
    const origin = positionFor(params, input) ?? [0, 0, 0]
    const name = nameFor(input, 'servo motor')
    const bodyColor = colorFor(params, '#64748b')
    const darkColor = stringValue(params.darkColor, '#111827') ?? '#111827'
    const metalColor = stringValue(params.metalColor, '#cbd5e1') ?? '#cbd5e1'
    const accentColor = stringValue(params.accentColor, '#f59e0b') ?? '#f59e0b'
    const body = { properties: { color: bodyColor, roughness: 0.45, metalness: 0.5 } }
    const dark = { properties: { color: darkColor, roughness: 0.58, metalness: 0.28 } }
    const metal = { properties: { color: metalColor, roughness: 0.3, metalness: 0.82 } }
    const accent = { properties: { color: accentColor, roughness: 0.34, metalness: 0.35 } }
    const y = origin[1] + bodyRadius
    const frontX = origin[0] + bodyLength / 2
    const rearX = origin[0] - bodyLength / 2
    const boltOffset = bodyRadius * 0.72
    const shapes: PrimitiveShapeInput[] = [
      {
        kind: 'cylinder',
        name: `${name} ribbed cylindrical servo body`,
        semanticRole: 'servo_body',
        position: [origin[0], y, origin[2]],
        axis: 'x',
        radius: bodyRadius,
        height: bodyLength,
        radialSegments: 40,
        material: body,
      },
      {
        kind: 'cylinder',
        name: `${name} square front mounting flange`,
        semanticRole: 'front_flange',
        position: [frontX + flangeThickness / 2, y, origin[2]],
        axis: 'x',
        radius: bodyRadius * 1.24,
        height: flangeThickness,
        radialSegments: 4,
        rotation: [0, 0, Math.PI / 4],
        material: dark,
      },
      {
        kind: 'cylinder',
        name: `${name} output shaft`,
        semanticRole: 'output_shaft',
        position: [frontX + flangeThickness + shaftLength / 2, y, origin[2]],
        axis: 'x',
        radius: shaftRadius,
        height: shaftLength,
        radialSegments: 32,
        material: metal,
      },
      {
        kind: 'cylinder',
        name: `${name} rear encoder cap`,
        semanticRole: 'encoder_cap',
        position: [rearX - encoderLength / 2, y, origin[2]],
        axis: 'x',
        radius: bodyRadius * 0.82,
        height: encoderLength,
        radialSegments: 36,
        material: dark,
      },
      {
        kind: 'box',
        name: `${name} top terminal box`,
        semanticRole: 'terminal_box',
        position: [origin[0] + bodyLength * 0.05, y + bodyRadius * 0.82, origin[2]],
        length: bodyLength * 0.42,
        width: bodyRadius * 0.62,
        height: bodyRadius * 0.36,
        cornerRadius: bodyRadius * 0.08,
        material: dark,
      },
      {
        kind: 'rounded-panel',
        name: `${name} side rating nameplate`,
        semanticRole: 'nameplate',
        position: [
          origin[0] + bodyLength * 0.06,
          y - bodyRadius * 0.1,
          origin[2] + bodyRadius * 1.01,
        ],
        length: bodyLength * 0.28,
        width: bodyRadius * 0.035,
        height: bodyRadius * 0.22,
        cornerRadius: bodyRadius * 0.025,
        material: accent,
      },
      {
        kind: 'cylinder',
        name: `${name} cable gland`,
        semanticRole: 'cable_gland',
        position: [origin[0] + bodyLength * 0.22, y + bodyRadius * 1.06, origin[2]],
        axis: 'y',
        radius: bodyRadius * 0.12,
        height: bodyRadius * 0.28,
        radialSegments: 20,
        material: metal,
      },
    ]

    for (let index = 0; index < 6; index += 1) {
      shapes.push({
        kind: 'torus',
        name: `${name} cooling fin ${index + 1}`,
        semanticRole: 'cooling_fin',
        position: [rearX + bodyLength * (0.16 + index * 0.11), y, origin[2]],
        axis: 'x',
        majorRadius: bodyRadius * 0.99,
        tubeRadius: bodyRadius * 0.018,
        radialSegments: 10,
        tubularSegments: 36,
        material: metal,
      })
    }

    for (const [dy, dz] of [
      [boltOffset, boltOffset],
      [boltOffset, -boltOffset],
      [-boltOffset, boltOffset],
      [-boltOffset, -boltOffset],
    ] as const) {
      shapes.push({
        kind: 'cylinder',
        name: `${name} flange mounting bolt`,
        semanticRole: 'flange_bolt',
        position: [frontX + flangeThickness + bodyRadius * 0.012, y + dy, origin[2] + dz],
        axis: 'x',
        radius: bodyRadius * 0.045,
        height: bodyRadius * 0.04,
        radialSegments: 16,
        material: metal,
      })
    }

    return shapes
  }

  return {
    id,
    label: 'Servo motor',
    aliases,
    compose,
    geometryBrief: (input) => input.geometryBrief ?? servoMotorBrief(input),
  }
}

function servoMotorBrief(input: ComposeRecipeInput): PrimitiveGeometryBrief {
  const params = recipeParams(input)
  return {
    category: 'motor',
    units: 'm',
    coordinateConvention: '+X motor axis/output shaft direction, +Y up, y=0 is floor',
    expectedDimensions: {
      length: numberValue(params.length),
      radius: numberValue(params.radius, params.height, params.width),
    },
    requiredRoles: [
      'servo_body',
      'front_flange',
      'output_shaft',
      'encoder_cap',
      'terminal_box',
      'nameplate',
    ],
    validationTargets: [
      'ribbed cylindrical servo body',
      'square front mounting flange with four bolts',
      'projecting output shaft',
      'rear encoder cap',
      'terminal box, cable gland, and nameplate',
    ],
  }
}

const PRIMITIVE_RECIPES: PrimitiveRecipeDefinition[] = [
  spurGearRecipe(),
  chainSprocketRecipe(),
  pipeFlangeRecipe(),
  pipeElbow90Recipe(),
  hexBoltRecipe(),
  pillowBlockBearingRecipe(),
  flexibleCouplingRecipe(),
  perforatedPlateRecipe(),
  valveRecipe('gate'),
  valveRecipe('ball'),
  robotArmThreeAxisRecipe(),
  mixerImpellerRecipe(),
  servoMotorRecipe(),
]

export function listPrimitiveRecipes(): PrimitiveRecipeDefinition[] {
  return PRIMITIVE_RECIPES
}

export function findPrimitiveRecipe(
  input: ComposeRecipeInput,
): PrimitiveRecipeDefinition | undefined {
  const id = readRecipeId(input)
  if (id) {
    const mappedAlias = recipeIdAlias(id)
    if (mappedAlias) {
      return PRIMITIVE_RECIPES.find((recipe) => recipe.id === mappedAlias)
    }
    const exact = PRIMITIVE_RECIPES.find((recipe) => normalizeRecipeId(recipe.id) === id)
    if (exact) return exact
    const alias = PRIMITIVE_RECIPES.find((recipe) => recipeIdMatchesAlias(id, recipe))
    if (alias) return alias
  }

  const text = textOf([
    input.name,
    input.recipeId,
    input.recipe,
    input.id,
    input.params,
    input.geometryBrief,
  ])
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
  const { geometryBrief: _ignoredGeometryBrief, ...recipeInput } = input
  return findPrimitiveRecipe(input)?.geometryBrief(recipeInput)
}

export function composeRecipePrimitives(input: ComposeRecipeInput = {}): PrimitiveShapeInput[] {
  return findPrimitiveRecipe(input)?.compose(input) ?? []
}
