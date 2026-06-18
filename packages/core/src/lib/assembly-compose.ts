import {
  type AssemblyObjectFamily,
  extractUserGeometryConstraints,
  materialFromColor,
  type UserGeometryConstraints,
} from './assembly-constraints'
import { getFamilyDefinition, normalizeFamilyId } from './family-registry'
import {
  composePartPrimitives,
  type PartComposeInput,
  type PartComposePartInput,
} from './part-compose'
import type { PrimitiveGeometryBrief, PrimitiveShapeInput, Vec3 } from './primitive-compose'
import { composeRobotArmPrimitives } from './robot-arm-compose'

export type AssemblyPartPlanItem = {
  role: string
  capability: string
  partKind: string
  count?: number
}

export type AssemblyComposeInput = {
  name?: string
  prompt?: string
  family?: AssemblyObjectFamily | string
  object?: string
  style?: string
  constraints?: Partial<UserGeometryConstraints>
  parts?: AssemblyPartPlanItem[]
  position?: Vec3
  primaryColor?: string
  secondaryColor?: string
  darkColor?: string
  metalColor?: string
  color?: string
  length?: number
  width?: number
  diameter?: number
  height?: number
  variant?: string
  axisCount?: number
  endEffector?: string
  params?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function colorValue(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
  fallback: string,
) {
  return (
    constraints.primaryColor?.value ??
    input.primaryColor ??
    input.color ??
    stringValue(input.params?.primaryColor, input.params?.color) ??
    fallback
  )
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function normalizeAssemblyFamily(value: unknown): AssemblyObjectFamily | undefined {
  return normalizeFamilyId(value)
}

function familyFor(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): AssemblyObjectFamily {
  const explicitFamily = normalizeAssemblyFamily(input.family)
  if (explicitFamily) return explicitFamily
  const text = `${input.object ?? ''} ${input.name ?? ''} ${input.prompt ?? ''}`
  return (
    extractUserGeometryConstraints(text, input as Record<string, unknown>).family ||
    constraints.family
  )
}

function withInputConstraints(input: AssemblyComposeInput): UserGeometryConstraints {
  const prompt = input.prompt ?? textOf([input.name, input.object, input.style])
  const raw: Record<string, unknown> = { ...input, ...(isRecord(input.params) ? input.params : {}) }
  const extracted = extractUserGeometryConstraints(prompt, raw)
  return { ...extracted, ...input.constraints }
}

function assemblyName(input: AssemblyComposeInput, fallback: string) {
  return input.name ?? input.object ?? input.prompt ?? fallback
}

function partInput(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
  parts: PartComposePartInput[],
): PartComposeInput {
  return {
    name: assemblyName(input, 'assembly'),
    position: input.position,
    detail: 'high',
    primaryColor: colorValue(input, constraints, '#64748b'),
    darkColor: '#111827',
    metalColor: '#cbd5e1',
    accentColor: '#2563eb',
    enhanceVisualDetails: true,
    parts,
  }
}

function dimensionedRegistryPart(
  part: PartComposePartInput,
  index: number,
  constraints: UserGeometryConstraints,
  fallback: { length?: number; width?: number; height?: number },
): PartComposePartInput {
  if (index !== 0) return part
  return {
    ...part,
    length: part.length ?? constraints.length?.value ?? fallback.length,
    width: part.width ?? constraints.width?.value ?? fallback.width,
    height: part.height ?? constraints.height?.value ?? fallback.height,
  }
}

function composeRegistryFamilyAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
  family: AssemblyObjectFamily,
): PrimitiveShapeInput[] {
  const definition = getFamilyDefinition(family)
  if (!definition) return []
  const kinds = Array.from(new Set([...definition.requiredParts, ...definition.optionalParts]))
  if (kinds.length === 0) return []
  const parts = kinds.map((kind, index) =>
    dimensionedRegistryPart(
      { kind, ...(index === 0 ? { semanticRole: definition.primarySemanticRoles[0] } : {}) },
      index,
      constraints,
      definition.defaultDimensions,
    ),
  )
  return composePartPrimitives({
    ...partInput(input, constraints, parts),
    family: definition.id,
    registryPartPlan: true,
    autoComplete: false,
  })
}

function styleText(input: AssemblyComposeInput, constraints: UserGeometryConstraints) {
  return `${input.style ?? ''} ${constraints.style ?? ''} ${input.prompt ?? ''}`.toLowerCase()
}

function vehicleStyle(input: AssemblyComposeInput, constraints: UserGeometryConstraints) {
  const text = styleText(input, constraints)
  if (/suv|offroad|越野/.test(text)) return 'suv'
  if (/truck|pickup|卡车|貨車|货车|皮卡/.test(text)) return 'truck'
  if (/van|mpv|bus|面包车|廂式|商务/.test(text)) return 'van'
  if (/sport|race|跑车|赛车/.test(text)) return 'sports'
  return 'sedan'
}

function sizeScale(input: AssemblyComposeInput): number {
  const raw = String(
    input.params?.size ?? input.style ?? input.name ?? input.prompt ?? '',
  ).toLowerCase()
  if (/compact|small|mini|tiny|小|迷你/.test(raw)) return 0.8
  if (/large|big|long|大型|大号|加长/.test(raw)) return 1.18
  return 1
}

function composeVehicleAssembly(input: AssemblyComposeInput, constraints: UserGeometryConstraints) {
  const style = vehicleStyle(input, constraints)
  const defaultLength = (style === 'truck' ? 5.2 : 4.4) * sizeScale(input)
  const length =
    constraints.length?.value ??
    numberValue(input.length, input.params?.length) ??
    Number(defaultLength.toFixed(3))
  const width =
    constraints.width?.value ??
    numberValue(input.width, input.params?.width) ??
    Number((length * (style === 'suv' || style === 'truck' ? 0.43 : 0.42)).toFixed(3))
  const height =
    constraints.height?.value ??
    numberValue(input.height, input.params?.height) ??
    Number((length * (style === 'sports' ? 0.26 : style === 'suv' ? 0.38 : 0.32)).toFixed(3))
  const color = colorValue(input, constraints, '#64748b')
  return compactVehicleAssemblyShapes(input, style, length, width, height, color)
}

function compactVehicleAssemblyShapes(
  input: AssemblyComposeInput,
  style: string,
  length: number,
  width: number,
  height: number,
  color: string,
): PrimitiveShapeInput[] {
  const name = assemblyName(input, 'vehicle')
  const bodyMat = materialFromColor(color)
  const glassMat = materialFromColor('#60a5fa')
  const darkMat = materialFromColor('#111827')
  const lightMat = materialFromColor('#fde68a')
  const tailLightMat = materialFromColor('#ef4444')
  const hubMat = materialFromColor('#cbd5e1')
  const bodyHeight = height * (style === 'truck' ? 0.42 : 0.38)
  const cabinHeight = height * (style === 'sports' ? 0.34 : 0.4)
  const wheelRadius = Math.max(0.16, Math.min(length * 0.085, height * 0.23))
  const wheelY = wheelRadius
  const bodyY = wheelY + bodyHeight * 0.58
  const deckY = bodyY + bodyHeight * 0.52
  const cabinLength = length * (style === 'truck' ? 0.32 : style === 'sports' ? 0.34 : 0.36)
  const cabinWidth = width * 0.66
  const cabinX = style === 'truck' ? length * 0.11 : -length * 0.03
  const cabinY = deckY + cabinHeight * 0.38
  const axleX = length * 0.34
  const wheelZ = width * 0.5
  const bumperY = wheelY + bodyHeight * 0.16
  const seamY = deckY + bodyHeight * 0.07

  return [
    {
      kind: 'trapezoid-prism',
      name: `${name} vehicle body shell`,
      semanticRole: 'vehicle_body',
      sourcePartKind: 'body_shell',
      position: [0, bodyY, 0],
      length,
      width,
      height: bodyHeight,
      topLengthScale: style === 'van' ? 0.98 : 0.94,
      topWidthScale: style === 'truck' || style === 'suv' ? 0.93 : 0.88,
      cornerRadius: Math.min(length, width, bodyHeight) * 0.08,
      cornerSegments: 5,
      material: bodyMat,
    },
    {
      kind: 'wedge',
      name: `${name} vehicle front deck hood`,
      semanticRole: 'vehicle_deck',
      sourcePartKind: 'body_shell',
      position: [length * 0.24, deckY, 0],
      length: length * 0.32,
      width: width * 0.78,
      height: bodyHeight * 0.08,
      slopeAxis: 'x',
      slopeDirection: 'negative',
      material: bodyMat,
    },
    {
      kind: 'wedge',
      name: `${name} vehicle rear deck trunk`,
      semanticRole: 'vehicle_deck',
      sourcePartKind: 'body_shell',
      position: [-length * 0.32, deckY - bodyHeight * 0.03, 0],
      length: length * 0.24,
      width: width * 0.78,
      height: bodyHeight * 0.075,
      slopeAxis: 'x',
      slopeDirection: 'positive',
      material: bodyMat,
    },
    {
      kind: 'trapezoid-prism',
      name: `${name} vehicle cabin frame`,
      semanticRole: 'vehicle_cabin',
      sourcePartKind: 'body_shell',
      position: [cabinX, cabinY, 0],
      length: cabinLength,
      width: cabinWidth,
      height: cabinHeight,
      topLengthScale: style === 'sports' ? 0.58 : 0.68,
      topWidthScale: 0.72,
      cornerRadius: Math.min(width, cabinHeight) * 0.04,
      cornerSegments: 4,
      material: bodyMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} windshield`,
      semanticRole: 'vehicle_window',
      sourcePartKind: 'window_strip',
      position: [cabinX + cabinLength * 0.33, cabinY + cabinHeight * 0.02, 0],
      rotation: [0, Math.PI / 2, 0],
      length: cabinWidth * 0.62,
      width: cabinHeight * 0.44,
      thickness: 0.018,
      cornerRadius: cabinHeight * 0.05,
      material: glassMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} rear window`,
      semanticRole: 'vehicle_window',
      sourcePartKind: 'window_strip',
      position: [cabinX - cabinLength * 0.33, cabinY + cabinHeight * 0.02, 0],
      rotation: [0, Math.PI / 2, 0],
      length: cabinWidth * 0.58,
      width: cabinHeight * 0.38,
      thickness: 0.018,
      cornerRadius: cabinHeight * 0.05,
      material: glassMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} side window left`,
      semanticRole: 'vehicle_window',
      sourcePartKind: 'window_strip',
      position: [cabinX, cabinY + cabinHeight * 0.02, -cabinWidth * 0.51],
      rotation: [Math.PI / 2, 0, 0],
      length: cabinLength * 0.72,
      width: cabinHeight * 0.36,
      thickness: 0.018,
      cornerRadius: cabinHeight * 0.05,
      material: glassMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} side window right`,
      semanticRole: 'vehicle_window',
      sourcePartKind: 'window_strip',
      position: [cabinX, cabinY + cabinHeight * 0.02, cabinWidth * 0.51],
      rotation: [Math.PI / 2, 0, 0],
      length: cabinLength * 0.72,
      width: cabinHeight * 0.36,
      thickness: 0.018,
      cornerRadius: cabinHeight * 0.05,
      material: glassMat,
    },
    ...[-axleX, axleX].flatMap((x) =>
      [-wheelZ, wheelZ].flatMap((z): PrimitiveShapeInput[] => [
        {
          kind: 'torus',
          name: `${name} vehicle tire`,
          semanticRole: 'vehicle_tire',
          sourcePartKind: 'wheel_set',
          position: [x, wheelY, z],
          axis: 'z',
          majorRadius: wheelRadius,
          tubeRadius: wheelRadius * 0.24,
          radialSegments: 12,
          tubularSegments: 24,
          material: darkMat,
        },
        {
          kind: 'cylinder',
          name: `${name} vehicle wheel hub`,
          semanticRole: 'wheel_hub',
          sourcePartKind: 'wheel_set',
          position: [x, wheelY, z + (z > 0 ? 0.012 : -0.012)],
          axis: 'z',
          radius: wheelRadius * 0.38,
          height: wheelRadius * 0.14,
          radialSegments: 16,
          material: hubMat,
        },
        {
          kind: 'torus',
          name: `${name} vehicle wheel arch`,
          semanticRole: 'vehicle_body_detail',
          sourcePartKind: 'body_shell',
          position: [x, wheelY + wheelRadius * 0.24, z * 0.98],
          axis: 'z',
          majorRadius: wheelRadius * 1.1,
          tubeRadius: wheelRadius * 0.07,
          arc: Math.PI,
          radialSegments: 8,
          tubularSegments: 18,
          material: bodyMat,
        },
      ]),
    ),
    {
      kind: 'sphere',
      name: `${name} left headlight`,
      semanticRole: 'headlight',
      sourcePartKind: 'light_pair',
      position: [length * 0.49, bumperY + bodyHeight * 0.26, -width * 0.28],
      radius: Math.max(0.035, width * 0.035),
      material: lightMat,
    },
    {
      kind: 'sphere',
      name: `${name} left tail light`,
      semanticRole: 'taillight',
      sourcePartKind: 'light_pair',
      position: [-length * 0.49, bumperY + bodyHeight * 0.23, -width * 0.3],
      radius: Math.max(0.03, width * 0.03),
      material: tailLightMat,
    },
    {
      kind: 'sphere',
      name: `${name} right tail light`,
      semanticRole: 'taillight',
      sourcePartKind: 'light_pair',
      position: [-length * 0.49, bumperY + bodyHeight * 0.23, width * 0.3],
      radius: Math.max(0.03, width * 0.03),
      material: tailLightMat,
    },
    {
      kind: 'sphere',
      name: `${name} right headlight`,
      semanticRole: 'headlight',
      sourcePartKind: 'light_pair',
      position: [length * 0.49, bumperY + bodyHeight * 0.26, width * 0.28],
      radius: Math.max(0.035, width * 0.035),
      material: lightMat,
    },
    {
      kind: 'box',
      name: `${name} front bumper bar`,
      semanticRole: 'front_bumper',
      sourcePartKind: 'bar_pair',
      position: [length * 0.51, bumperY, 0],
      length: length * 0.035,
      width: width * 0.82,
      height: bodyHeight * 0.14,
      material: darkMat,
    },
    {
      kind: 'box',
      name: `${name} rear bumper bar`,
      semanticRole: 'rear_bumper',
      sourcePartKind: 'bar_pair',
      position: [-length * 0.51, bumperY, 0],
      length: length * 0.035,
      width: width * 0.82,
      height: bodyHeight * 0.14,
      material: darkMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} left rocker sill`,
      semanticRole: 'vehicle_body_detail',
      sourcePartKind: 'body_shell',
      position: [0, bodyY - bodyHeight * 0.25, -width * 0.515],
      rotation: [Math.PI / 2, 0, 0],
      length: length * 0.72,
      width: bodyHeight * 0.12,
      thickness: 0.018,
      material: darkMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} right rocker sill`,
      semanticRole: 'vehicle_body_detail',
      sourcePartKind: 'body_shell',
      position: [0, bodyY - bodyHeight * 0.25, width * 0.515],
      rotation: [Math.PI / 2, 0, 0],
      length: length * 0.72,
      width: bodyHeight * 0.12,
      thickness: 0.018,
      material: darkMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} hood seam`,
      semanticRole: 'vehicle_body_detail',
      sourcePartKind: 'body_shell',
      position: [length * 0.25, seamY, 0],
      rotation: [0, 0, 0],
      length: length * 0.28,
      width: width * 0.62,
      thickness: 0.01,
      cornerRadius: Math.min(width, length) * 0.01,
      material: darkMat,
    },
    {
      kind: 'rounded-panel',
      name: `${name} trunk seam`,
      semanticRole: 'vehicle_body_detail',
      sourcePartKind: 'body_shell',
      position: [-length * 0.32, seamY - bodyHeight * 0.025, 0],
      rotation: [0, 0, 0],
      length: length * 0.2,
      width: width * 0.62,
      thickness: 0.01,
      cornerRadius: Math.min(width, length) * 0.01,
      material: darkMat,
    },
    {
      kind: 'box',
      name: `${name} left mirror`,
      semanticRole: 'side_mirror',
      sourcePartKind: 'body_shell',
      position: [cabinX + cabinLength * 0.28, cabinY + cabinHeight * 0.03, -width * 0.46],
      length: length * 0.035,
      width: width * 0.08,
      height: cabinHeight * 0.08,
      material: darkMat,
    },
    {
      kind: 'box',
      name: `${name} right mirror`,
      semanticRole: 'side_mirror',
      sourcePartKind: 'body_shell',
      position: [cabinX + cabinLength * 0.28, cabinY + cabinHeight * 0.03, width * 0.46],
      length: length * 0.035,
      width: width * 0.08,
      height: cabinHeight * 0.08,
      material: darkMat,
    },
  ]
}

function composeFanAssembly(input: AssemblyComposeInput, constraints: UserGeometryConstraints) {
  const height =
    constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? 1.35
  const radius = constraints.width?.value ? constraints.width.value / 2 : 0.36
  const baseHeight = height * 0.04
  const poleHeight = height * 0.66
  const poleTopY = baseHeight + poleHeight
  const motorRadius = radius * 0.18
  const headCenterY = poleTopY + motorRadius
  return composePartPrimitives(
    partInput(input, constraints, [
      {
        id: 'fan_base',
        kind: 'circular_base',
        radius: radius * 0.55,
        height: baseHeight,
        position: [0, baseHeight / 2, 0],
      },
      {
        id: 'fan_pole',
        kind: 'vertical_pole',
        height: poleHeight,
        radius: radius * 0.045,
        position: [0, baseHeight + poleHeight / 2, 0],
      },
      {
        id: 'fan_motor',
        kind: 'motor_housing',
        radius: motorRadius,
        depth: radius * 0.32,
        position: [0, headCenterY, -radius * 0.06],
      },
      {
        id: 'fan_blades',
        kind: 'radial_blades',
        count: 3,
        bladeRadius: radius * 0.76,
        bladeWidth: radius * 0.18,
        position: [0, headCenterY, 0],
      },
      {
        id: 'fan_grill',
        kind: 'protective_grill',
        radius: radius,
        ringCount: 5,
        spokeCount: 24,
        position: [0, headCenterY, 0],
      },
    ]),
  )
}

function composePumpAssembly(input: AssemblyComposeInput, constraints: UserGeometryConstraints) {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 1.4
  const width = constraints.width?.value ?? length * 0.42
  const height = constraints.height?.value ?? length * 0.45
  return composePartPrimitives(
    partInput(input, constraints, [
      { kind: 'skid_base', id: 'base', length, width, height: height * 0.12 },
      {
        kind: 'ribbed_motor_body',
        id: 'motor',
        length: length * 0.42,
        width: width * 0.58,
        height: height * 0.48,
        alignAbove: 'base',
        side: 'left',
      },
      {
        kind: 'volute_casing',
        id: 'volute',
        radius: height * 0.23,
        alignAbove: 'base',
        side: 'right',
      },
      {
        kind: 'inlet_port',
        id: 'inlet',
        connectTo: 'volute',
        connectPoint: 'inlet',
        childPoint: 'back',
      },
      {
        kind: 'outlet_port',
        id: 'outlet',
        connectTo: 'volute',
        connectPoint: 'outlet',
        childPoint: 'back',
      },
      { kind: 'flange_ring', connectTo: 'inlet', connectPoint: 'open', childPoint: 'back' },
      { kind: 'flange_ring', connectTo: 'outlet', connectPoint: 'open', childPoint: 'back' },
      { kind: 'control_box', alignAbove: 'motor' },
      { kind: 'nameplate' },
    ]),
  )
}

function composeOutdoorAcAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 0.9
  const width =
    constraints.width?.value ?? numberValue(input.width, input.params?.width) ?? length * 0.42
  const height =
    constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? length * 0.75
  const color = colorValue(input, constraints, '#e5e7eb')
  const mat = materialFromColor(color)
  const fanCenter: Vec3 = [length * 0.18, height * 0.55, width * 0.54]
  const bladeLength = Math.min(length, height) * 0.28
  const bladeWidth = Math.min(length, height) * 0.055
  const bladeMat = materialFromColor('#475569')
  return [
    {
      kind: 'box',
      name: `${assemblyName(input, 'outdoor AC')} enclosure`,
      semanticRole: 'rounded_machine_body',
      sourcePartKind: 'structure.enclosure',
      position: [0, height / 2, 0],
      length,
      width,
      height,
      cornerRadius: Math.min(length, width, height) * 0.04,
      cornerSegments: 8,
      material: mat,
    },
    {
      kind: 'torus',
      name: 'front circular grille',
      semanticRole: 'vent_grille',
      sourcePartKind: 'visual.glass_label_vent',
      position: [length * 0.18, height * 0.55, width * 0.51],
      axis: 'z',
      majorRadius: Math.min(length, height) * 0.18,
      tubeRadius: Math.min(length, height) * 0.012,
      material: materialFromColor('#111827'),
    },
    {
      kind: 'cylinder',
      name: 'fan hub',
      semanticRole: 'fan_hub',
      sourcePartKind: 'mechanical.wheel_rotor',
      position: fanCenter,
      axis: 'z',
      radius: Math.min(length, height) * 0.045,
      height: width * 0.04,
      material: materialFromColor('#334155'),
    },
    ...[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map(
      (angle): PrimitiveShapeInput => ({
        kind: 'box',
        name: 'front fan blade',
        semanticRole: 'fan_blade',
        sourcePartKind: 'mechanical.wheel_rotor',
        position: [
          fanCenter[0] + Math.cos(angle) * bladeLength * 0.28,
          fanCenter[1] + Math.sin(angle) * bladeLength * 0.28,
          fanCenter[2] + width * 0.012,
        ],
        rotation: [0, 0, angle],
        length: bladeLength,
        width: width * 0.035,
        height: bladeWidth,
        material: bladeMat,
      }),
    ),
    {
      kind: 'wedge',
      name: 'side vent slats',
      semanticRole: 'vent_slats',
      sourcePartKind: 'visual.glass_label_vent',
      position: [-length * 0.2, height * 0.48, -width * 0.52],
      length: length * 0.44,
      width: width * 0.04,
      height: height * 0.38,
      material: materialFromColor('#94a3b8'),
    },
    {
      kind: 'cylinder',
      name: 'copper pipe port',
      semanticRole: 'pipe_port',
      sourcePartKind: 'connection.pipe_port',
      position: [-length * 0.45, height * 0.35, -width * 0.55],
      axis: 'z',
      radius: height * 0.035,
      height: width * 0.18,
      material: materialFromColor('#b45309'),
    },
  ]
}

function composeConveyorAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 2.4
  const width = constraints.width?.value ?? length * 0.28
  const height =
    constraints.height?.value ??
    numberValue(input.height, input.params?.height) ??
    Math.max(0.45, length * 0.18)
  const frameMat = materialFromColor(colorValue(input, constraints, '#334155'))
  const beltMat = materialFromColor(colorValue(input, constraints, '#111827'))
  const metalMat = materialFromColor('#cbd5e1')
  const rollerCount = Math.max(6, Math.min(12, Math.round(length * 3.2)))
  return [
    {
      kind: 'box',
      name: 'belt conveyor left rail',
      semanticRole: 'conveyor_frame',
      sourcePartKind: 'material_handling.conveyor',
      position: [0, height * 0.7, -width * 0.52],
      length,
      width: width * 0.04,
      height: height * 0.08,
      material: frameMat,
    },
    {
      kind: 'box',
      name: 'belt conveyor right rail',
      semanticRole: 'conveyor_frame',
      sourcePartKind: 'material_handling.conveyor',
      position: [0, height * 0.7, width * 0.52],
      length,
      width: width * 0.04,
      height: height * 0.08,
      material: frameMat,
    },
    {
      kind: 'box',
      name: 'moving belt surface',
      semanticRole: 'belt_surface',
      sourcePartKind: 'material_handling.conveyor_belt',
      position: [0, height * 0.76, 0],
      length: length * 0.96,
      width: width * 0.86,
      height: height * 0.045,
      material: beltMat,
    },
    ...Array.from(
      { length: rollerCount },
      (_, index): PrimitiveShapeInput => ({
        kind: 'cylinder',
        name: 'conveyor roller',
        semanticRole: 'roller_array',
        sourcePartKind: 'material_handling.roller',
        position: [
          -length * 0.42 + (length * 0.84 * index) / Math.max(1, rollerCount - 1),
          height * 0.66,
          0,
        ],
        axis: 'z',
        radius: height * 0.045,
        height: width * 0.82,
        material: metalMat,
      }),
    ),
    ...[-0.42, -0.14, 0.14, 0.42].flatMap((x): PrimitiveShapeInput[] => [
      {
        kind: 'cylinder',
        name: 'conveyor support leg',
        semanticRole: 'support_leg',
        sourcePartKind: 'structure.base_frame',
        position: [length * x, height * 0.34, -width * 0.38],
        axis: 'y',
        radius: width * 0.025,
        height: height * 0.68,
        material: frameMat,
      },
      {
        kind: 'cylinder',
        name: 'conveyor support leg',
        semanticRole: 'support_leg',
        sourcePartKind: 'structure.base_frame',
        position: [length * x, height * 0.34, width * 0.38],
        axis: 'y',
        radius: width * 0.025,
        height: height * 0.68,
        material: frameMat,
      },
    ]),
    {
      kind: 'cylinder',
      name: 'belt drive motor',
      semanticRole: 'drive_motor',
      sourcePartKind: 'mechanical.motor',
      position: [length * 0.5, height * 0.72, width * 0.62],
      axis: 'x',
      radius: height * 0.12,
      height: length * 0.16,
      material: frameMat,
    },
  ]
}

type MachineToolVariant = 'cnc' | 'lathe' | 'milling' | 'grinder' | 'planer' | 'drill'

function machineToolVariant(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): MachineToolVariant {
  const text =
    `${input.family ?? ''} ${input.object ?? ''} ${input.name ?? ''} ${input.variant ?? ''} ${input.params?.variant ?? ''} ${styleText(input, constraints)}`.toLowerCase()
  if (/cnc|machining[_\s-]?center|\u6570\u63a7|\u52a0\u5de5\u4e2d\u5fc3/.test(text)) return 'cnc'
  if (/lathe|turning|\u8f66\u5e8a|\u8eca\u5e8a/.test(text)) return 'lathe'
  if (/milling|mill|\u94e3\u5e8a|\u92d1\u5e8a/.test(text)) return 'milling'
  if (/grinder|grinding|\u78e8\u5e8a/.test(text)) return 'grinder'
  if (/planer|planing|\u5228\u5e8a/.test(text)) return 'planer'
  if (/drill|drilling|\u94bb\u5e8a|\u947d\u5e8a/.test(text)) return 'drill'
  return 'cnc'
}

function composeMachineToolAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 2.2
  const width = constraints.width?.value ?? length * 0.55
  const height = constraints.height?.value ?? length * 0.72
  const color = colorValue(input, constraints, '#64748b')
  const hasExplicitBodyColor = color !== '#64748b'
  const bodyMaterial = materialFromColor(color)
  const baseMaterial = hasExplicitBodyColor ? bodyMaterial : materialFromColor('#334155')
  const metalMaterial = materialFromColor('#cbd5e1')
  const darkMaterial = materialFromColor('#111827')
  const variant = machineToolVariant(input, constraints)
  if (variant === 'lathe') {
    return [
      {
        kind: 'box',
        name: 'lathe long base',
        semanticRole: 'machine_base',
        sourcePartKind: 'machine_tool.lathe_bed',
        position: [0, height * 0.11, 0],
        length,
        width: width * 0.46,
        height: height * 0.16,
        material: baseMaterial,
      },
      {
        kind: 'box',
        name: 'lathe precision bed ways',
        semanticRole: 'machine_bed',
        sourcePartKind: 'machine_tool.lathe_bed',
        position: [0, height * 0.23, 0],
        length: length * 0.9,
        width: width * 0.32,
        height: height * 0.06,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'headstock block',
        semanticRole: 'headstock',
        sourcePartKind: 'mechanical.motion_axis',
        position: [-length * 0.36, height * 0.34, 0],
        length: length * 0.18,
        width: width * 0.52,
        height: height * 0.28,
        material: bodyMaterial,
      },
      {
        kind: 'cylinder',
        name: 'spindle chuck',
        semanticRole: 'spindle_chuck',
        sourcePartKind: 'mechanical.motion_axis',
        position: [-length * 0.24, height * 0.37, 0],
        axis: 'x',
        radius: width * 0.14,
        height: length * 0.08,
        material: darkMaterial,
      },
      {
        kind: 'box',
        name: 'tailstock',
        semanticRole: 'tailstock',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.34, height * 0.32, 0],
        length: length * 0.14,
        width: width * 0.38,
        height: height * 0.22,
        material: bodyMaterial,
      },
      {
        kind: 'box',
        name: 'cross slide tool post',
        semanticRole: 'tool_post',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.05, height * 0.34, 0],
        length: length * 0.16,
        width: width * 0.5,
        height: height * 0.12,
        material: metalMaterial,
      },
      {
        kind: 'cylinder',
        name: 'workpiece centerline',
        semanticRole: 'spindle_axis',
        sourcePartKind: 'mechanical.motion_axis',
        position: [0, height * 0.37, 0],
        axis: 'x',
        radius: width * 0.035,
        height: length * 0.52,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'lathe control panel',
        semanticRole: 'control_panel',
        sourcePartKind: 'electrical.controls',
        position: [-length * 0.47, height * 0.52, width * 0.3],
        length: length * 0.08,
        width: width * 0.04,
        height: height * 0.24,
        material: darkMaterial,
      },
    ]
  }
  if (variant === 'planer') {
    return [
      {
        kind: 'box',
        name: 'planer long machine base',
        semanticRole: 'machine_base',
        sourcePartKind: 'machine_tool.planer_bed',
        position: [0, height * 0.12, 0],
        length,
        width,
        height: height * 0.18,
        material: baseMaterial,
      },
      {
        kind: 'box',
        name: 'traveling work table',
        semanticRole: 'work_table',
        sourcePartKind: 'mechanical.motion_axis',
        position: [0, height * 0.28, 0],
        length: length * 0.76,
        width: width * 0.72,
        height: height * 0.08,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'gantry uprights',
        semanticRole: 'gantry_frame',
        sourcePartKind: 'structure.base_frame',
        position: [0, height * 0.55, 0],
        length: length * 0.16,
        width: width * 0.95,
        height: height * 0.6,
        material: bodyMaterial,
      },
      {
        kind: 'box',
        name: 'cross rail',
        semanticRole: 'cross_rail',
        sourcePartKind: 'mechanical.motion_axis',
        position: [0, height * 0.76, 0],
        length: length * 0.86,
        width: width * 0.08,
        height: height * 0.08,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'reciprocating ram',
        semanticRole: 'reciprocating_ram',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.08, height * 0.68, 0],
        length: length * 0.34,
        width: width * 0.14,
        height: height * 0.12,
        material: darkMaterial,
      },
      {
        kind: 'cylinder',
        name: 'single point tool head',
        semanticRole: 'tool_head',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.24, height * 0.55, 0],
        axis: 'y',
        radius: width * 0.045,
        height: height * 0.18,
        material: darkMaterial,
      },
      {
        kind: 'box',
        name: 'planer control panel',
        semanticRole: 'control_panel',
        sourcePartKind: 'electrical.controls',
        position: [length * 0.48, height * 0.46, width * 0.54],
        length: length * 0.1,
        width: width * 0.04,
        height: height * 0.26,
        material: darkMaterial,
      },
    ]
  }
  if (variant === 'drill') {
    return [
      {
        kind: 'box',
        name: 'drill press base',
        semanticRole: 'machine_base',
        sourcePartKind: 'structure.base_frame',
        position: [0, height * 0.05, 0],
        length: length * 0.62,
        width: width * 0.72,
        height: height * 0.1,
        material: baseMaterial,
      },
      {
        kind: 'cylinder',
        name: 'round drill column',
        semanticRole: 'machine_column',
        sourcePartKind: 'structure.base_frame',
        position: [-length * 0.18, height * 0.46, 0],
        axis: 'y',
        radius: width * 0.06,
        height: height * 0.82,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'lifting drill table',
        semanticRole: 'work_table',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.06, height * 0.36, 0],
        length: length * 0.42,
        width: width * 0.48,
        height: height * 0.06,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'radial drill head',
        semanticRole: 'spindle_head',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.12, height * 0.78, 0],
        length: length * 0.38,
        width: width * 0.3,
        height: height * 0.16,
        material: bodyMaterial,
      },
      {
        kind: 'cylinder',
        name: 'vertical drill bit',
        semanticRole: 'drill_bit',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.22, height * 0.62, 0],
        axis: 'y',
        radius: width * 0.025,
        height: height * 0.24,
        material: darkMaterial,
      },
      {
        kind: 'box',
        name: 'drill control panel',
        semanticRole: 'control_panel',
        sourcePartKind: 'electrical.controls',
        position: [length * 0.32, height * 0.78, width * 0.2],
        length: length * 0.08,
        width: width * 0.04,
        height: height * 0.16,
        material: darkMaterial,
      },
    ]
  }
  if (variant === 'grinder') {
    return [
      {
        kind: 'box',
        name: 'grinder base',
        semanticRole: 'machine_base',
        sourcePartKind: 'structure.base_frame',
        position: [0, height * 0.1, 0],
        length,
        width: width * 0.78,
        height: height * 0.2,
        material: baseMaterial,
      },
      {
        kind: 'box',
        name: 'magnetic chuck table',
        semanticRole: 'work_table',
        sourcePartKind: 'mechanical.motion_axis',
        position: [-length * 0.08, height * 0.3, 0],
        length: length * 0.64,
        width: width * 0.52,
        height: height * 0.06,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'grinder column',
        semanticRole: 'machine_column',
        sourcePartKind: 'structure.base_frame',
        position: [length * 0.24, height * 0.52, 0],
        length: length * 0.18,
        width: width * 0.45,
        height: height * 0.64,
        material: bodyMaterial,
      },
      {
        kind: 'cylinder',
        name: 'grinding wheel',
        semanticRole: 'grinding_wheel',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.08, height * 0.58, 0],
        axis: 'z',
        radius: width * 0.16,
        height: width * 0.08,
        material: darkMaterial,
      },
      {
        kind: 'box',
        name: 'wheel guard',
        semanticRole: 'wheel_guard',
        sourcePartKind: 'structure.enclosure',
        position: [length * 0.08, height * 0.62, 0],
        length: width * 0.38,
        width: width * 0.12,
        height: width * 0.24,
        material: bodyMaterial,
      },
      {
        kind: 'box',
        name: 'grinder control panel',
        semanticRole: 'control_panel',
        sourcePartKind: 'electrical.controls',
        position: [length * 0.44, height * 0.5, width * 0.42],
        length: length * 0.1,
        width: width * 0.04,
        height: height * 0.26,
        material: darkMaterial,
      },
    ]
  }
  if (variant === 'milling') {
    return [
      {
        kind: 'box',
        name: 'milling machine base',
        semanticRole: 'machine_base',
        sourcePartKind: 'structure.base_frame',
        position: [0, height * 0.1, 0],
        length: length * 0.72,
        width: width * 0.72,
        height: height * 0.2,
        material: baseMaterial,
      },
      {
        kind: 'box',
        name: 'vertical column',
        semanticRole: 'machine_column',
        sourcePartKind: 'structure.base_frame',
        position: [-length * 0.22, height * 0.48, 0],
        length: length * 0.2,
        width: width * 0.55,
        height: height * 0.72,
        material: bodyMaterial,
      },
      {
        kind: 'box',
        name: 'T slot work table',
        semanticRole: 'work_table',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.12, height * 0.34, 0],
        length: length * 0.58,
        width: width * 0.48,
        height: height * 0.07,
        material: metalMaterial,
      },
      {
        kind: 'box',
        name: 'spindle head',
        semanticRole: 'spindle_head',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.05, height * 0.68, 0],
        length: length * 0.32,
        width: width * 0.28,
        height: height * 0.16,
        material: bodyMaterial,
      },
      {
        kind: 'cylinder',
        name: 'milling cutter',
        semanticRole: 'milling_cutter',
        sourcePartKind: 'mechanical.motion_axis',
        position: [length * 0.16, height * 0.53, 0],
        axis: 'y',
        radius: width * 0.055,
        height: height * 0.16,
        material: darkMaterial,
      },
      {
        kind: 'box',
        name: 'milling control panel',
        semanticRole: 'control_panel',
        sourcePartKind: 'electrical.controls',
        position: [length * 0.38, height * 0.52, width * 0.42],
        length: length * 0.1,
        width: width * 0.04,
        height: height * 0.24,
        material: darkMaterial,
      },
    ]
  }
  return [
    {
      kind: 'box',
      name: 'machine base',
      semanticRole: 'machine_base',
      sourcePartKind: 'structure.base_frame',
      position: [0, height * 0.08, 0],
      length,
      width,
      height: height * 0.16,
      material: baseMaterial,
    },
    {
      kind: 'trapezoid-prism',
      name: `${assemblyName(input, 'machine tool')} enclosure`,
      semanticRole: 'machine_enclosure',
      sourcePartKind: 'structure.enclosure',
      position: [0, height * 0.5, 0],
      length,
      width,
      height: height * 0.72,
      topLengthScale: 0.92,
      topWidthScale: 0.9,
      material: bodyMaterial,
    },
    {
      kind: 'box',
      name: 'work bed',
      semanticRole: 'machine_bed',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 0.34, 0],
      length: length * 0.68,
      width: width * 0.62,
      height: height * 0.06,
      material: materialFromColor('#475569'),
    },
    {
      kind: 'box',
      name: 'linear rail',
      semanticRole: 'linear_rail',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 0.46, 0],
      length: length * 0.66,
      width: width * 0.05,
      height: height * 0.04,
      material: materialFromColor('#cbd5e1'),
    },
    {
      kind: 'cylinder',
      name: 'spindle head',
      semanticRole: 'spindle_head',
      sourcePartKind: 'mechanical.motion_axis',
      position: [length * 0.14, height * 0.58, 0],
      axis: 'y',
      radius: width * 0.08,
      height: height * 0.18,
      material: materialFromColor('#111827'),
    },
    {
      kind: 'rounded-panel',
      name: 'front access glass',
      semanticRole: 'glass_panel',
      sourcePartKind: 'visual.glass_label_vent',
      position: [-length * 0.18, height * 0.56, width * 0.51],
      length: length * 0.35,
      width: height * 0.28,
      thickness: width * 0.02,
      rotation: [Math.PI / 2, 0, 0],
      material: { properties: { color: '#38bdf8', opacity: 0.42, transparent: true } },
    },
    {
      kind: 'box',
      name: 'control panel',
      semanticRole: 'control_panel',
      sourcePartKind: 'electrical.controls',
      position: [length * 0.46, height * 0.56, width * 0.54],
      length: length * 0.12,
      width: width * 0.04,
      height: height * 0.28,
      material: materialFromColor('#111827'),
    },
  ]
}

function composeTankAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const text = styleText(input, constraints)
  const height = constraints.height?.value ?? numberValue(input.height, input.params?.height)
  const diameter =
    constraints.width?.value ??
    numberValue(input.diameter, input.params?.diameter, input.width, input.params?.width)
  const length =
    constraints.length?.value ??
    numberValue(input.length, input.params?.length) ??
    (height ? height * 0.45 : 1.4)
  const vertical =
    /vertical|storage|\u7acb\u5f0f|\u7acb\u7f50|\u50a8\u7f50|\u5132\u7f50/.test(text) ||
    (height != null && height >= length)
  const spherical = /spherical|sphere|ball|globular|\u7403\u7f50|\u7403\u5f62/.test(text)
  if (spherical) {
    const radius = (diameter ?? height ?? Math.max(1.2, length * 0.55)) / 2
    const legHeight = Math.max(0.25, radius * 0.55)
    const centerY = legHeight + radius * 0.85
    const shellMat = materialFromColor(colorValue(input, constraints, '#94a3b8'))
    const metalMat = materialFromColor('#64748b')
    const nozzleRadius = Math.max(0.04, radius * 0.09)
    const legRadius = Math.max(0.025, radius * 0.035)
    const legSpread = radius * 0.62
    return [
      {
        kind: 'sphere',
        name: `${assemblyName(input, 'spherical tank')} vessel shell`,
        semanticRole: 'vessel_shell',
        sourcePartKind: 'process.spherical_vessel',
        position: [0, centerY, 0],
        radius,
        widthSegments: 64,
        heightSegments: 32,
        material: shellMat,
      },
      {
        kind: 'torus',
        name: 'spherical tank equator seam',
        semanticRole: 'seam_ring',
        sourcePartKind: 'connection.seam_ring',
        position: [0, centerY, 0],
        axis: 'y',
        majorRadius: radius * 1.01,
        tubeRadius: Math.max(0.012, radius * 0.018),
        material: metalMat,
      },
      {
        kind: 'cylinder',
        name: 'top inlet nozzle',
        semanticRole: 'inlet_port',
        sourcePartKind: 'connection.pipe_port',
        position: [0, centerY + radius + nozzleRadius * 0.6, 0],
        axis: 'y',
        radius: nozzleRadius,
        height: nozzleRadius * 1.2,
        material: metalMat,
      },
      ...[-1, 1].flatMap((xSign) =>
        [-1, 1].map((zSign) => ({
          kind: 'cylinder' as const,
          name: 'spherical tank support leg',
          semanticRole: 'support_leg',
          sourcePartKind: 'structure.support_leg',
          position: [xSign * legSpread, legHeight / 2, zSign * legSpread] as [
            number,
            number,
            number,
          ],
          axis: 'y' as const,
          radius: legRadius,
          height: legHeight,
          material: metalMat,
        })),
      ),
    ]
  }
  if (vertical) {
    const h = height ?? Math.max(1.4, length * 1.8)
    const radius = (diameter ?? Math.max(0.5, h * 0.28)) / 2
    const shellMat = materialFromColor(colorValue(input, constraints, '#94a3b8'))
    const metalMat = materialFromColor('#cbd5e1')
    return [
      {
        kind: 'cylinder',
        name: `${assemblyName(input, 'storage tank')} vertical vessel shell`,
        semanticRole: 'vessel_shell',
        sourcePartKind: 'process.vertical_vessel',
        position: [0, h / 2, 0],
        axis: 'y',
        radius,
        height: h,
        radialSegments: 48,
        material: shellMat,
      },
      {
        kind: 'cylinder',
        name: 'tank support base',
        semanticRole: 'support_base',
        sourcePartKind: 'structure.base_frame',
        position: [0, h * 0.04, 0],
        axis: 'y',
        radius: radius * 1.05,
        height: h * 0.08,
        material: materialFromColor('#334155'),
      },
      {
        kind: 'cylinder',
        name: 'top inlet nozzle',
        semanticRole: 'inlet_port',
        sourcePartKind: 'connection.pipe_port',
        position: [0, h + radius * 0.18, 0],
        axis: 'y',
        radius: radius * 0.12,
        height: radius * 0.36,
        material: metalMat,
      },
      {
        kind: 'cylinder',
        name: 'side outlet nozzle',
        semanticRole: 'outlet_port',
        sourcePartKind: 'connection.pipe_port',
        position: [radius * 1.25, h * 0.28, 0],
        axis: 'x',
        radius: radius * 0.1,
        height: radius * 0.5,
        material: metalMat,
      },
      {
        kind: 'torus',
        name: 'manway flange',
        semanticRole: 'manway',
        sourcePartKind: 'connection.mounting_flange',
        position: [radius * 1.02, h * 0.62, 0],
        axis: 'x',
        majorRadius: radius * 0.22,
        tubeRadius: radius * 0.025,
        material: metalMat,
      },
      {
        kind: 'cylinder',
        name: 'level gauge',
        semanticRole: 'level_gauge',
        sourcePartKind: 'visual.gauge',
        position: [-radius * 1.05, h * 0.5, 0],
        axis: 'y',
        radius: radius * 0.025,
        height: h * 0.48,
        material: materialFromColor('#38bdf8'),
      },
    ]
  }
  return composePartPrimitives(
    partInput(input, constraints, [
      { kind: 'cylindrical_tank', length, radius: diameter ? diameter / 2 : length * 0.18 },
      { kind: 'pipe_port', id: 'nozzle', position: [length * 0.45, length * 0.2, 0] },
      { kind: 'flange_ring', connectTo: 'nozzle', connectPoint: 'open', childPoint: 'back' },
      { kind: 'leg_set', length, width: length * 0.3, height: length * 0.18 },
    ]),
  )
}

function composeDistillationTowerAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const height = constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? 8
  const diameter =
    constraints.width?.value ??
    numberValue(input.diameter, input.params?.diameter, input.width, input.params?.width) ??
    1
  const radius = diameter / 2
  const shellMat = materialFromColor(colorValue(input, constraints, '#b0c4de'))
  const darkMat = materialFromColor('#334155')
  const metalMat = materialFromColor('#cbd5e1')
  const nozzleRadius = Math.max(radius * 0.08, 0.04)
  const nozzleLength = Math.max(radius * 0.7, 0.28)
  const trayCount = height >= 6 ? 7 : 5
  const trayStart = height * 0.16
  const trayStep = (height * 0.68) / Math.max(1, trayCount - 1)
  const platformYs = [height * 0.36, height * 0.68]
  return [
    {
      kind: 'cylinder',
      name: `${assemblyName(input, 'distillation tower')} vertical column shell`,
      semanticRole: 'distillation_column_shell',
      sourcePartKind: 'process.distillation_column',
      position: [0, height / 2, 0],
      axis: 'y',
      radius,
      height,
      radialSegments: 48,
      material: shellMat,
    },
    {
      kind: 'cylinder',
      name: 'bottom support skirt',
      semanticRole: 'support_base',
      sourcePartKind: 'structure.base_frame',
      position: [0, height * 0.04, 0],
      axis: 'y',
      radius: radius * 1.04,
      height: height * 0.08,
      material: darkMat,
    },
    {
      kind: 'torus',
      name: 'top flange ring',
      semanticRole: 'top_flange',
      sourcePartKind: 'connection.mounting_flange',
      position: [0, height * 0.98, 0],
      axis: 'y',
      majorRadius: radius * 1.02,
      tubeRadius: radius * 0.035,
      material: metalMat,
    },
    {
      kind: 'torus',
      name: 'bottom flange ring',
      semanticRole: 'bottom_flange',
      sourcePartKind: 'connection.mounting_flange',
      position: [0, height * 0.12, 0],
      axis: 'y',
      majorRadius: radius * 1.02,
      tubeRadius: radius * 0.035,
      material: metalMat,
    },
    ...Array.from(
      { length: trayCount },
      (_, index): PrimitiveShapeInput => ({
        kind: 'torus',
        name: 'internal tray level marker',
        semanticRole: 'tray_level',
        sourcePartKind: 'process.tray_pack',
        position: [0, trayStart + trayStep * index, 0],
        axis: 'y',
        majorRadius: radius * 0.9,
        tubeRadius: Math.max(radius * 0.012, 0.006),
        material: materialFromColor('#64748b'),
      }),
    ),
    {
      kind: 'cylinder',
      name: 'feed inlet nozzle',
      semanticRole: 'inlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [radius + nozzleLength / 2, height * 0.42, 0],
      axis: 'x',
      radius: nozzleRadius,
      height: nozzleLength,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'side product outlet nozzle',
      semanticRole: 'outlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [-(radius + nozzleLength / 2), height * 0.72, 0],
      axis: 'x',
      radius: nozzleRadius,
      height: nozzleLength,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'overhead vapor outlet',
      semanticRole: 'overhead_vapor_outlet',
      sourcePartKind: 'connection.pipe_port',
      position: [0, height + nozzleLength * 0.35, 0],
      axis: 'y',
      radius: nozzleRadius,
      height: nozzleLength * 0.7,
      material: metalMat,
    },
    ...platformYs.map(
      (y): PrimitiveShapeInput => ({
        kind: 'torus',
        name: 'circular access platform',
        semanticRole: 'access_platform',
        sourcePartKind: 'structure.platform',
        position: [0, y, 0],
        axis: 'y',
        majorRadius: radius * 1.34,
        tubeRadius: Math.max(radius * 0.025, 0.012),
        material: darkMat,
      }),
    ),
    {
      kind: 'cylinder',
      name: 'vertical cage ladder',
      semanticRole: 'ladder',
      sourcePartKind: 'structure.ladder',
      position: [radius * 1.52, height * 0.5, 0],
      axis: 'y',
      radius: Math.max(radius * 0.025, 0.015),
      height: height * 0.86,
      material: darkMat,
    },
  ]
}

function composeReactorAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const height = constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? 2.8
  const diameter =
    constraints.width?.value ??
    numberValue(input.diameter, input.params?.diameter, input.width, input.params?.width) ??
    height * 0.42
  const radius = diameter / 2
  const shellMat = materialFromColor(colorValue(input, constraints, '#94a3b8'))
  const metalMat = materialFromColor('#cbd5e1')
  const darkMat = materialFromColor('#111827')
  return [
    {
      kind: 'cylinder',
      name: `${assemblyName(input, 'reactor')} stirred vessel shell`,
      semanticRole: 'reactor_vessel_shell',
      sourcePartKind: 'process.reactor_vessel',
      position: [0, height * 0.48, 0],
      axis: 'y',
      radius,
      height: height * 0.78,
      radialSegments: 48,
      material: shellMat,
    },
    {
      kind: 'sphere',
      name: 'reactor top dished head',
      semanticRole: 'top_head',
      sourcePartKind: 'process.vessel_head',
      position: [0, height * 0.89, 0],
      radius: 1,
      scale: [radius, radius * 0.26, radius],
      material: shellMat,
    },
    {
      kind: 'sphere',
      name: 'reactor bottom dished head',
      semanticRole: 'bottom_head',
      sourcePartKind: 'process.vessel_head',
      position: [0, height * 0.08, 0],
      radius: 1,
      scale: [radius, radius * 0.26, radius],
      material: shellMat,
    },
    {
      kind: 'cylinder',
      name: 'top agitator motor',
      semanticRole: 'agitator_motor',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 1.05, 0],
      axis: 'y',
      radius: radius * 0.22,
      height: height * 0.16,
      material: darkMat,
    },
    {
      kind: 'cylinder',
      name: 'agitator shaft',
      semanticRole: 'agitator_shaft',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 0.48, 0],
      axis: 'y',
      radius: radius * 0.035,
      height: height * 0.68,
      material: metalMat,
    },
    {
      kind: 'box',
      name: 'lower reactor impeller blade',
      semanticRole: 'reactor_impeller',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 0.28, 0],
      length: radius * 1.35,
      width: radius * 0.08,
      height: radius * 0.08,
      rotation: [0, 0, Math.PI / 10],
      material: metalMat,
    },
    {
      kind: 'box',
      name: 'upper reactor impeller blade',
      semanticRole: 'reactor_impeller',
      sourcePartKind: 'mechanical.motion_axis',
      position: [0, height * 0.52, 0],
      length: radius * 1.2,
      width: radius * 0.08,
      height: radius * 0.08,
      rotation: [0, Math.PI / 2, -Math.PI / 10],
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'feed inlet nozzle',
      semanticRole: 'inlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [radius * 1.2, height * 0.65, 0],
      axis: 'x',
      radius: radius * 0.09,
      height: radius * 0.5,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'bottom outlet nozzle',
      semanticRole: 'outlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [0, -radius * 0.12, 0],
      axis: 'y',
      radius: radius * 0.09,
      height: radius * 0.35,
      material: metalMat,
    },
    {
      kind: 'torus',
      name: 'reactor manway flange',
      semanticRole: 'manway',
      sourcePartKind: 'connection.mounting_flange',
      position: [-radius * 1.04, height * 0.62, 0],
      axis: 'x',
      majorRadius: radius * 0.22,
      tubeRadius: radius * 0.025,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'support skirt',
      semanticRole: 'support_base',
      sourcePartKind: 'structure.base_frame',
      position: [0, height * 0.04, 0],
      axis: 'y',
      radius: radius * 1.05,
      height: height * 0.08,
      material: darkMat,
    },
  ]
}

function composeCompressorAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 1.8
  const width =
    constraints.width?.value ?? numberValue(input.width, input.params?.width) ?? length * 0.42
  const height =
    constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? length * 0.45
  const bodyMat = materialFromColor(colorValue(input, constraints, '#64748b'))
  const metalMat = materialFromColor('#cbd5e1')
  return [
    {
      kind: 'box',
      name: 'compressor skid base',
      semanticRole: 'machine_base',
      sourcePartKind: 'structure.base_frame',
      position: [0, height * 0.08, 0],
      length,
      width,
      height: height * 0.16,
      material: materialFromColor('#334155'),
    },
    {
      kind: 'cylinder',
      name: 'ribbed drive motor',
      semanticRole: 'motor_body',
      sourcePartKind: 'mechanical.motor',
      position: [-length * 0.22, height * 0.38, 0],
      axis: 'x',
      radius: height * 0.18,
      height: length * 0.34,
      radialSegments: 32,
      material: bodyMat,
    },
    {
      kind: 'cylinder',
      name: 'compressor casing',
      semanticRole: 'compressor_casing',
      sourcePartKind: 'fluid.rotating_machine',
      position: [length * 0.22, height * 0.38, 0],
      axis: 'x',
      radius: height * 0.2,
      height: length * 0.28,
      radialSegments: 32,
      material: bodyMat,
    },
    {
      kind: 'cylinder',
      name: 'coupling guard',
      semanticRole: 'coupling_guard',
      sourcePartKind: 'mechanical.guard',
      position: [0, height * 0.38, 0],
      axis: 'x',
      radius: height * 0.13,
      height: length * 0.14,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'suction inlet port',
      semanticRole: 'inlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [length * 0.22, height * 0.38, width * 0.38],
      axis: 'z',
      radius: height * 0.07,
      height: width * 0.34,
      material: metalMat,
    },
    {
      kind: 'cylinder',
      name: 'discharge outlet port',
      semanticRole: 'outlet_port',
      sourcePartKind: 'connection.pipe_port',
      position: [length * 0.36, height * 0.62, 0],
      axis: 'y',
      radius: height * 0.06,
      height: height * 0.28,
      material: metalMat,
    },
    {
      kind: 'box',
      name: 'compressor control panel',
      semanticRole: 'control_panel',
      sourcePartKind: 'electrical.controls',
      position: [-length * 0.46, height * 0.42, width * 0.34],
      length: length * 0.1,
      width: width * 0.04,
      height: height * 0.32,
      material: materialFromColor('#111827'),
    },
  ]
}

function composeGrateCoolerAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
): PrimitiveShapeInput[] {
  const length = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 4.8
  const width =
    constraints.width?.value ?? numberValue(input.width, input.params?.width) ?? length * 0.34
  const height =
    constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? length * 0.22
  const bodyMat = materialFromColor(colorValue(input, constraints, '#64748b'))
  const darkMat = materialFromColor('#111827')
  const metalMat = materialFromColor('#cbd5e1')
  return [
    {
      kind: 'box',
      name: 'grate cooler housing',
      semanticRole: 'cooler_housing',
      sourcePartKind: 'structure.enclosure',
      position: [0, height * 0.52, 0],
      length,
      width,
      height: height * 0.72,
      cornerRadius: Math.min(length, width, height) * 0.03,
      material: bodyMat,
    },
    {
      kind: 'box',
      name: 'inclined grate bed',
      semanticRole: 'cooler_grate_bed',
      sourcePartKind: 'material_handling.grate_bed',
      position: [0, height * 0.48, 0],
      length: length * 0.82,
      width: width * 0.72,
      height: height * 0.06,
      rotation: [0, 0, -0.08],
      material: metalMat,
    },
    {
      kind: 'box',
      name: 'hot clinker inlet hood',
      semanticRole: 'inlet_chute',
      sourcePartKind: 'connection.chute',
      position: [-length * 0.44, height * 0.78, 0],
      length: length * 0.12,
      width: width * 0.62,
      height: height * 0.32,
      material: darkMat,
    },
    {
      kind: 'box',
      name: 'cooled clinker outlet chute',
      semanticRole: 'outlet_chute',
      sourcePartKind: 'connection.chute',
      position: [length * 0.46, height * 0.28, 0],
      length: length * 0.12,
      width: width * 0.62,
      height: height * 0.2,
      material: darkMat,
    },
    ...[-0.28, 0, 0.28].map(
      (x): PrimitiveShapeInput => ({
        kind: 'box',
        name: 'under grate cooling air box',
        semanticRole: 'cooling_air_box',
        sourcePartKind: 'process.cooling_air',
        position: [length * x, height * 0.14, -width * 0.48],
        length: width * 0.18,
        width: width * 0.16,
        height: height * 0.18,
        material: darkMat,
      }),
    ),
    ...[-0.3, 0, 0.3].map(
      (x): PrimitiveShapeInput => ({
        kind: 'box',
        name: 'grate segment line',
        semanticRole: 'grate_segment',
        sourcePartKind: 'material_handling.grate_bed',
        position: [length * x, height * 0.54, 0],
        length: length * 0.02,
        width: width * 0.72,
        height: height * 0.03,
        material: darkMat,
      }),
    ),
    {
      kind: 'box',
      name: 'grate cooler drive unit',
      semanticRole: 'drive_motor',
      sourcePartKind: 'mechanical.motor',
      position: [length * 0.35, height * 0.32, width * 0.55],
      length: length * 0.14,
      width: width * 0.16,
      height: height * 0.18,
      material: darkMat,
    },
  ]
}

function composeElectricalAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
) {
  const height = constraints.height?.value ?? numberValue(input.height, input.params?.height) ?? 1.6
  const length =
    constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? height * 0.62
  const width = constraints.width?.value ?? height * 0.28
  return composePartPrimitives(
    partInput(input, constraints, [
      { kind: 'electrical_cabinet', length, width, height },
      { kind: 'control_box', position: [length * 0.2, height * 0.62, width * 0.53] },
      { kind: 'cable_tray', alignBeside: 0, side: 'right', height: height * 0.62 },
      { kind: 'nameplate' },
      { kind: 'warning_label' },
    ]),
  )
}

function composeRobotArmAssembly(
  input: AssemblyComposeInput,
  constraints: UserGeometryConstraints,
) {
  const text = styleText(input, constraints)
  const isFanuc = /fanuc|m-710/i.test(`${text} ${input.object ?? ''} ${input.name ?? ''}`)
  const reach = constraints.length?.value ?? numberValue(input.length, input.params?.length) ?? 2.05
  const primaryColor =
    constraints.primaryColor?.value ??
    stringValue(input.primaryColor, input.color, input.params?.primaryColor, input.params?.color) ??
    (isFanuc || /white|白|白色/.test(text) ? '#f8fafc' : '#64748b')
  const secondaryColor =
    stringValue(input.secondaryColor, input.params?.secondaryColor, input.params?.accentColor) ??
    (isFanuc || /yellow|黄|黃色|黄色/.test(text) ? '#facc15' : primaryColor)
  const axisCount =
    numberValue(input.axisCount, input.params?.axisCount) ??
    (/six|6.?axis|六轴|六軸/.test(text) ? 6 : 3)
  return composeRobotArmPrimitives({
    name: assemblyName(input, isFanuc ? 'FANUC robot arm' : 'industrial robot arm'),
    style: isFanuc ? 'fanuc' : 'industrial',
    pose: 'work-ready',
    axisCount,
    baseShape: 'round',
    endEffector: stringValue(input.endEffector, input.params?.endEffector) ?? 'tool-flange',
    reach,
    detail: 'high',
    primaryColor,
    secondaryColor,
    darkColor: stringValue(input.darkColor, input.params?.darkColor) ?? '#111827',
    metalColor: stringValue(input.metalColor, input.params?.metalColor) ?? '#cbd5e1',
    position: input.position,
  })
}

export function planAssemblyParts(input: AssemblyComposeInput = {}): AssemblyPartPlanItem[] {
  const constraints = withInputConstraints(input)
  switch (familyFor(input, constraints)) {
    case 'vehicle':
      return [
        { role: 'body', capability: 'structure.enclosure', partKind: 'body_shell' },
        { role: 'wheels', capability: 'mechanical.wheel_rotor', partKind: 'wheel_set', count: 4 },
        { role: 'glass', capability: 'visual.glass_label_vent', partKind: 'window_strip' },
        { role: 'lights', capability: 'electrical.controls', partKind: 'headlights', count: 4 },
        { role: 'bumpers', capability: 'structure.base_frame', partKind: 'bumper', count: 2 },
      ]
    case 'outdoor_ac':
      return [
        { role: 'enclosure', capability: 'structure.enclosure', partKind: 'rounded_machine_body' },
        { role: 'grille', capability: 'visual.glass_label_vent', partKind: 'vent_grill' },
        { role: 'fan', capability: 'mechanical.wheel_rotor', partKind: 'radial_blades' },
        { role: 'ports', capability: 'connection.pipe_port', partKind: 'pipe_port' },
      ]
    case 'machine_tool':
      return [
        { role: 'enclosure', capability: 'structure.enclosure', partKind: 'rounded_machine_body' },
        { role: 'linear_axis', capability: 'mechanical.motion_axis', partKind: 'pipe_rack' },
        { role: 'spindle', capability: 'mechanical.motion_axis', partKind: 'ribbed_motor_body' },
        { role: 'controls', capability: 'electrical.controls', partKind: 'control_box' },
      ]
    case 'distillation_tower':
      return [
        {
          role: 'vertical_column_shell',
          capability: 'process.vertical_vessel',
          partKind: 'distillation_column_shell',
        },
        { role: 'tray_pack', capability: 'process.internals', partKind: 'tray_level', count: 7 },
        { role: 'ports', capability: 'connection.pipe_port', partKind: 'pipe_port', count: 3 },
        {
          role: 'platforms',
          capability: 'structure.platform',
          partKind: 'access_platform',
          count: 2,
        },
        { role: 'ladder', capability: 'structure.ladder', partKind: 'ladder' },
      ]
    case 'reactor':
      return [
        {
          role: 'reactor_vessel',
          capability: 'process.vertical_vessel',
          partKind: 'reactor_vessel_shell',
        },
        { role: 'agitator', capability: 'mechanical.motion_axis', partKind: 'agitator_shaft' },
        { role: 'ports', capability: 'connection.pipe_port', partKind: 'pipe_port', count: 2 },
      ]
    case 'compressor':
      return [
        { role: 'skid', capability: 'structure.base_frame', partKind: 'skid_base' },
        { role: 'motor', capability: 'mechanical.motion_axis', partKind: 'ribbed_motor_body' },
        { role: 'compressor_casing', capability: 'fluid.flow_body', partKind: 'compressor_casing' },
        { role: 'ports', capability: 'connection.pipe_port', partKind: 'pipe_port', count: 2 },
      ]
    case 'grate_cooler':
      return [
        { role: 'housing', capability: 'structure.enclosure', partKind: 'cooler_housing' },
        {
          role: 'grate_bed',
          capability: 'material_handling.conveyor',
          partKind: 'cooler_grate_bed',
        },
        {
          role: 'cooling_fans',
          capability: 'mechanical.wheel_rotor',
          partKind: 'cooling_fan',
          count: 3,
        },
      ]
    case 'robot_arm':
      return [
        { role: 'base', capability: 'structure.base_frame', partKind: 'robot_base' },
        {
          role: 'joints',
          capability: 'mechanical.motion_axis',
          partKind: 'robot_joints',
          count: 6,
        },
        { role: 'links', capability: 'structure.enclosure', partKind: 'robot_links' },
        { role: 'tool_flange', capability: 'connection.mounting_flange', partKind: 'tool_flange' },
      ]
    default:
      return []
  }
}

export function getAssemblyGeometryBrief(
  input: AssemblyComposeInput = {},
): PrimitiveGeometryBrief | undefined {
  const constraints = withInputConstraints(input)
  const family = familyFor(input, constraints)
  if (family === 'unknown') return undefined
  const roles = assemblyRequiredRoles(family)
  return {
    category: family,
    units: 'm',
    coordinateConvention: '+X length, +Y up, +Z width; y=0 is ground/base',
    expectedDimensions: {
      length: constraints.length?.value,
      width: constraints.width?.value,
      height: constraints.height?.value,
    },
    requiredRoles: roles,
    validationTargets: [
      'hard user constraints override defaults',
      'generic reusable parts, not whole-object recipes',
    ],
  }
}

function assemblyRequiredRoles(family: AssemblyObjectFamily): string[] {
  switch (family) {
    case 'vehicle':
      return ['body_shell', 'wheel_set', 'window_strip', 'light_pair', 'bar_pair']
    case 'outdoor_ac':
      return ['rounded_machine_body', 'fan_blade', 'pipe_port']
    case 'machine_tool':
      return ['machine_base', 'control_panel']
    case 'distillation_tower':
      return [
        'distillation_column_shell',
        'tray_level',
        'inlet_port',
        'outlet_port',
        'access_platform',
        'ladder',
      ]
    case 'reactor':
      return [
        'reactor_vessel_shell',
        'agitator_motor',
        'agitator_shaft',
        'reactor_impeller',
        'inlet_port',
        'outlet_port',
      ]
    case 'compressor':
      return [
        'machine_base',
        'motor_body',
        'compressor_casing',
        'inlet_port',
        'outlet_port',
        'control_panel',
      ]
    case 'grate_cooler':
      return [
        'cooler_housing',
        'cooler_grate_bed',
        'cooling_air_box',
        'inlet_chute',
        'outlet_chute',
      ]
    case 'fan':
      return ['motor_housing', 'radial_blades', 'protective_grill']
    case 'pump':
      return ['volute_casing', 'inlet_port', 'outlet_port']
    case 'conveyor':
      return ['conveyor_frame', 'roller_array', 'belt_surface']
    case 'tank':
      return []
    case 'electrical':
      return ['electrical_cabinet', 'control_box']
    case 'robot_arm':
      return [
        'robot_base',
        'base_joint',
        'shoulder_joint',
        'upper_arm',
        'elbow_joint',
        'forearm',
        'wrist_joint',
        'end_effector',
      ]
    default:
      return []
  }
}

export function composeAssemblyPrimitives(input: AssemblyComposeInput = {}): PrimitiveShapeInput[] {
  const constraints = withInputConstraints(input)
  const family = familyFor(input, constraints)
  switch (family) {
    case 'vehicle':
      return composeVehicleAssembly(input, constraints)
    case 'fan':
      return composeFanAssembly(input, constraints)
    case 'pump':
      return composePumpAssembly(input, constraints)
    case 'conveyor':
      return composeConveyorAssembly(input, constraints)
    case 'machine_tool':
      return composeMachineToolAssembly(input, constraints)
    case 'distillation_tower':
      return composeDistillationTowerAssembly(input, constraints)
    case 'reactor':
      return composeReactorAssembly(input, constraints)
    case 'compressor':
      return composeCompressorAssembly(input, constraints)
    case 'grate_cooler':
      return composeGrateCoolerAssembly(input, constraints)
    case 'outdoor_ac':
      return composeOutdoorAcAssembly(input, constraints)
    case 'tank':
      return composeTankAssembly(input, constraints)
    case 'electrical':
      return composeElectricalAssembly(input, constraints)
    case 'robot_arm':
      return composeRobotArmAssembly(input, constraints)
    default:
      return family === 'unknown' ? [] : composeRegistryFamilyAssembly(input, constraints, family)
  }
}
